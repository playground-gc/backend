#include "order_client.hpp"

#include <arpa/inet.h>
#include <netdb.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <chrono>
#include <iostream>
#include <stdexcept>
#include <thread>

OrderClient::OrderClient(const std::string& host, int port)
    : host_(host), port_(port) {}

OrderClient::~OrderClient() {
    disconnect();
}

bool OrderClient::try_connect() {
    if (sockfd_ >= 0) {
        close(sockfd_);
        sockfd_ = -1;
    }

    sockfd_ = socket(AF_INET, SOCK_STREAM, 0);
    if (sockfd_ < 0) return false;

    // Resolve hostname
    struct addrinfo hints{}, *res = nullptr;
    hints.ai_family   = AF_INET;
    hints.ai_socktype = SOCK_STREAM;
    std::string port_str = std::to_string(port_);

    if (getaddrinfo(host_.c_str(), port_str.c_str(), &hints, &res) != 0) {
        close(sockfd_);
        sockfd_ = -1;
        return false;
    }

    bool ok = (::connect(sockfd_, res->ai_addr, res->ai_addrlen) == 0);
    freeaddrinfo(res);

    if (!ok) {
        close(sockfd_);
        sockfd_ = -1;
        return false;
    }
    return true;
}

bool OrderClient::connect(int max_attempts) {
    for (int attempt = 1; attempt <= max_attempts; ++attempt) {
        std::cout << "[OrderClient] Connecting to " << host_ << ":" << port_
                  << " (attempt " << attempt << "/" << max_attempts << ")\n";
        if (try_connect()) {
            connected_ = true;
            std::cout << "[OrderClient] Connected\n";
            return true;
        }
        std::this_thread::sleep_for(std::chrono::seconds(attempt));
    }
    return false;
}

void OrderClient::disconnect() {
    connected_ = false;
    if (sockfd_ >= 0) {
        close(sockfd_);
        sockfd_ = -1;
    }
}

void OrderClient::reconnect_if_needed() {
    if (!connected_) {
        for (int i = 0; i < 5; ++i) {
            if (try_connect()) { connected_ = true; return; }
            std::this_thread::sleep_for(std::chrono::seconds(2));
        }
    }
}

void OrderClient::send(const std::string& json_msg) {
    std::lock_guard<std::mutex> lock(send_mtx_);
    reconnect_if_needed();
    if (!connected_) return;

    std::string payload = json_msg + "\n";
    ssize_t sent = ::send(sockfd_, payload.data(), payload.size(), MSG_NOSIGNAL);
    if (sent < 0) {
        connected_ = false;
        std::cerr << "[OrderClient] send failed, will reconnect\n";
    }
}
