#include "tcp_server.hpp"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <chrono>
#include <iostream>
#include <stdexcept>
#include <string>

#include <nlohmann/json.hpp>
#include <x86intrin.h>

using json = nlohmann::json;

static long long now_ms_tcp() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

static uint64_t rdtsc_now() noexcept {
    unsigned int aux;
    _mm_lfence();
    uint64_t ts = __rdtscp(&aux);
    _mm_lfence();
    return ts;
}

// ─── Constructor / Destructor ─────────────────────────────────────────────────

TCPServer::TCPServer(int port, MatchingEngine& engine,
                     LFQueue<LOBOrder>* lob_queue)
    : port_(port), engine_(engine), lob_queue_(lob_queue) {}

TCPServer::~TCPServer() {
    stop();
}

// ─── Trader ID assignment ─────────────────────────────────────────────────────

short int TCPServer::getOrAssignTraderId(const std::string& user_id) {
    std::lock_guard<std::mutex> lock(trader_id_mtx_);
    auto it = trader_id_map_.find(user_id);
    if (it != trader_id_map_.end()) return it->second;
    short int id = next_trader_id_.fetch_add(1, std::memory_order_relaxed);
    trader_id_map_[user_id] = id;
    return id;
}

// ─── start ───────────────────────────────────────────────────────────────────

void TCPServer::start() {
    server_fd_ = socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd_ < 0) throw std::runtime_error("socket() failed");

    int opt = 1;
    setsockopt(server_fd_, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    sockaddr_in addr{};
    addr.sin_family      = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port        = htons(static_cast<uint16_t>(port_));

    if (bind(server_fd_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0)
        throw std::runtime_error("bind() failed on port " + std::to_string(port_));

    if (listen(server_fd_, 128) < 0)
        throw std::runtime_error("listen() failed");

    std::cout << "[TCPServer] Listening on port " << port_ << "\n";

    while (running_) {
        sockaddr_in client_addr{};
        socklen_t addr_len = sizeof(client_addr);
        int client_fd = accept(server_fd_,
                               reinterpret_cast<sockaddr*>(&client_addr),
                               &addr_len);
        if (client_fd < 0) {
            if (!running_) break;
            continue;
        }

        char ip_buf[INET_ADDRSTRLEN] = {};
        inet_ntop(AF_INET, &client_addr.sin_addr, ip_buf, sizeof(ip_buf));
        std::string client_ip = std::string(ip_buf) + ":" +
                                std::to_string(ntohs(client_addr.sin_port));

        std::cout << "[TCPServer] Client connected: " << client_ip << "\n";
        std::thread(&TCPServer::handle_client, this, client_fd, client_ip).detach();
    }
}

// ─── stop ─────────────────────────────────────────────────────────────────────

void TCPServer::stop() {
    running_ = false;
    if (server_fd_ >= 0) {
        close(server_fd_);
        server_fd_ = -1;
    }
}

// ─── handle_client ────────────────────────────────────────────────────────────

void TCPServer::handle_client(int client_fd, const std::string& client_addr) {
    std::string buffer;
    char chunk[4096];

    while (running_) {
        ssize_t n = recv(client_fd, chunk, sizeof(chunk) - 1, 0);
        if (n <= 0) break;

        chunk[n] = '\0';
        buffer.append(chunk, static_cast<size_t>(n));

        size_t pos;
        while ((pos = buffer.find('\n')) != std::string::npos) {
            std::string msg = buffer.substr(0, pos);
            buffer.erase(0, pos + 1);
            if (!msg.empty() && msg.back() == '\r') msg.pop_back();
            if (!msg.empty()) process_message(msg);
        }
    }

    close(client_fd);
    std::cout << "[TCPServer] Client disconnected: " << client_addr << "\n";
}

// ─── process_message ─────────────────────────────────────────────────────────

void TCPServer::process_message(const std::string& json_msg) {
    try {
        json j = json::parse(json_msg);
        std::string action = j.value("action", "place");

        if (action == "cancel") {
            const std::string order_id = j.at("order_id").get<std::string>();
            const std::string symbol   = j.at("symbol").get<std::string>();
            const std::string user_id  = j.value("user_id", "");

            // Legacy path
            engine_.cancel_order(order_id, symbol, user_id);

            // LOB path: push a delete request if we have a system_id mapping.
            // For cancels we emit a LOBOrder with req_type='d'.
            // The system_id is stored in the order_id field (if the order was
            // originally placed via the LOB path it will be an integer string).
            if (lob_queue_ != nullptr) {
                try {
                    int sys_id = std::stoi(order_id);
                    short int tid = getOrAssignTraderId(user_id);
                    uint64_t now = rdtsc_now();

                    LOBOrder lob{};
                    lob.arrived_cycle_count = now;
                    lob.system_id  = sys_id;
                    lob.price      = 0.0f;   // price not needed for delete
                    lob.quantity   = 0;
                    lob.trader_id  = tid;
                    lob.order_type = 'b';    // side not needed for delete (LUT lookup)
                    lob.req_type   = 'd';
                    lob.out_cycle_count = now;

                    LOBOrder* slot = lob_queue_->getNextWrite();
                    if (slot) { *slot = lob; lob_queue_->updateWrite(); }
                } catch (...) {
                    // order_id is not an integer — not a LOB path order, skip
                }
            }
        } else {
            Order o = parse_order(j);

            // Legacy path
            engine_.submit_order(o);

            // LOB path
            if (lob_queue_ != nullptr) {
                int sys_id = next_system_id_.fetch_add(1, std::memory_order_relaxed);
                short int tid = getOrAssignTraderId(o.user_id);

                LOBOrder lob = parse_lob_order(j, sys_id, tid);

                LOBOrder* slot = lob_queue_->getNextWrite();
                if (slot) { *slot = lob; lob_queue_->updateWrite(); }
            }
        }
    } catch (const std::exception& ex) {
        std::cerr << "[TCPServer] Bad message: " << ex.what()
                  << " | msg=" << json_msg.substr(0, 200) << "\n";
    }
}

// ─── parse_order (legacy) ─────────────────────────────────────────────────────

Order TCPServer::parse_order(const json& j) {
    Order o;
    o.id        = j.at("order_id").get<std::string>();
    o.user_id   = j.at("user_id").get<std::string>();
    o.symbol    = j.at("symbol").get<std::string>();
    o.quantity  = j.at("quantity").get<double>();
    o.timestamp = j.value("timestamp", now_ms_tcp());

    std::string type = j.value("type", "limit");
    o.type = (type == "market") ? Order::Type::MARKET : Order::Type::LIMIT;

    std::string side = j.at("side").get<std::string>();
    o.side = (side == "sell") ? Order::Side::SELL : Order::Side::BUY;

    if (o.type == Order::Type::LIMIT)
        o.price = j.at("price").get<double>();

    return o;
}

// ─── parse_lob_order ─────────────────────────────────────────────────────────

LOBOrder TCPServer::parse_lob_order(const json& j, int system_id,
                                     short int trader_id) {
    LOBOrder lob{};

    uint64_t now = rdtsc_now();
    lob.arrived_cycle_count = now;
    lob.out_cycle_count     = now;

    lob.system_id  = system_id;
    lob.trader_id  = trader_id;

    std::string side = j.at("side").get<std::string>();
    lob.order_type = (side == "sell") ? 's' : 'b';

    std::string type = j.value("type", "limit");
    // LOB engine handles limit orders (price/time priority).
    // Market orders from the LOB perspective get a far-reaching price
    // so they sweep all available levels.
    if (type == "market") {
        lob.price = (lob.order_type == 'b')
                    ? 9999.9f   // aggressive buy — above all asks
                    : 0.1f;     // aggressive sell — below all bids
    } else {
        lob.price = static_cast<float>(j.at("price").get<double>());
    }

    lob.quantity = static_cast<int>(j.at("quantity").get<double>());
    lob.req_type = 'c';   // new order = create

    return lob;
}
