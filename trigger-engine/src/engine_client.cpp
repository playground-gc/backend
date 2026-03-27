#include "engine_client.hpp"

#include <arpa/inet.h>
#include <netdb.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <chrono>
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <thread>

// ─── Constructor / Destructor ─────────────────────────────────────────────────

EngineClient::EngineClient(const std::string& host, int port)
    : host_(host), port_(port) {}

EngineClient::~EngineClient() {
    close_socket();
}

void EngineClient::close_socket() {
    if (sock_fd_ >= 0) {
        ::close(sock_fd_);
        sock_fd_ = -1;
    }
}

// ─── do_connect ──────────────────────────────────────────────────────────────

bool EngineClient::do_connect() {
    close_socket();

    // Resolve hostname (supports both IP and DNS names like "matching-engine")
    struct addrinfo hints{}, *res = nullptr;
    hints.ai_family   = AF_INET;
    hints.ai_socktype = SOCK_STREAM;

    std::string port_str = std::to_string(port_);
    int rc = getaddrinfo(host_.c_str(), port_str.c_str(), &hints, &res);
    if (rc != 0 || !res) {
        std::cerr << "[EngineClient] getaddrinfo failed: " << gai_strerror(rc) << "\n";
        return false;
    }

    sock_fd_ = ::socket(AF_INET, SOCK_STREAM, 0);
    if (sock_fd_ < 0) {
        freeaddrinfo(res);
        return false;
    }

    if (::connect(sock_fd_, res->ai_addr, res->ai_addrlen) < 0) {
        freeaddrinfo(res);
        close_socket();
        return false;
    }

    freeaddrinfo(res);
    std::cout << "[EngineClient] Connected to " << host_ << ":" << port_ << "\n";
    return true;
}

// ─── connect (with exponential backoff) ───────────────────────────────────────

void EngineClient::connect() {
    int delay_s = 1;
    while (!do_connect()) {
        std::cerr << "[EngineClient] Retrying in " << delay_s << "s...\n";
        std::this_thread::sleep_for(std::chrono::seconds(delay_s));
        delay_s = std::min(delay_s * 2, 30);
    }
}

// ─── send_order ───────────────────────────────────────────────────────────────

bool EngineClient::send_order(const std::string& json_str) {
    std::string msg = json_str + "\n";

    auto try_send = [&]() -> bool {
        if (sock_fd_ < 0) return false;
        ssize_t sent = ::send(sock_fd_, msg.c_str(), msg.size(), MSG_NOSIGNAL);
        return sent == static_cast<ssize_t>(msg.size());
    };

    if (try_send()) return true;

    // Retry once after reconnect
    std::cerr << "[EngineClient] Send failed, reconnecting...\n";
    if (do_connect()) {
        if (try_send()) return true;
    }

    std::cerr << "[EngineClient] Failed to send order after reconnect\n";
    return false;
}
