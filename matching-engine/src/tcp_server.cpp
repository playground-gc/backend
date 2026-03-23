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

using json = nlohmann::json;

static long long now_ms_tcp() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

// ─── Constructor / Destructor ─────────────────────────────────────────────────

TCPServer::TCPServer(int port, MatchingEngine& engine)
    : port_(port), engine_(engine) {}

TCPServer::~TCPServer() {
    stop();
    // Client threads are detached; they exit on their own once running_ is false.
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

// ─── stop ────────────────────────────────────────────────────────────────────

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

        // Process all complete newline-delimited messages in buffer
        size_t pos;
        while ((pos = buffer.find('\n')) != std::string::npos) {
            std::string msg = buffer.substr(0, pos);
            buffer.erase(0, pos + 1);
            if (!msg.empty() && msg.back() == '\r') msg.pop_back();
            if (!msg.empty()) {
                process_message(msg);
            }
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
            engine_.cancel_order(
                j.at("order_id").get<std::string>(),
                j.at("symbol").get<std::string>(),
                j.value("user_id", ""));
        } else {
            Order o = parse_order(j);
            engine_.submit_order(std::move(o));
        }
    } catch (const std::exception& ex) {
        std::cerr << "[TCPServer] Bad message: " << ex.what()
                  << " | msg=" << json_msg.substr(0, 200) << "\n";
    }
}

// ─── parse_order ─────────────────────────────────────────────────────────────

Order TCPServer::parse_order(const json& j) {
    Order o;
    o.id       = j.at("order_id").get<std::string>();
    o.user_id  = j.at("user_id").get<std::string>();
    o.symbol   = j.at("symbol").get<std::string>();
    o.quantity = j.at("quantity").get<double>();
    o.timestamp = j.value("timestamp", now_ms_tcp());

    std::string type = j.value("type", "limit");
    o.type = (type == "market") ? Order::Type::MARKET : Order::Type::LIMIT;

    std::string side = j.at("side").get<std::string>();
    o.side = (side == "sell") ? Order::Side::SELL : Order::Side::BUY;

    if (o.type == Order::Type::LIMIT) {
        o.price = j.at("price").get<double>();
    }

    return o;
}
