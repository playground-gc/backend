#pragma once

#include "matching_engine.hpp"

#include <atomic>
#include <string>
#include <thread>

#include <nlohmann/json.hpp>

/**
 * TCP server: accepts connections on ENGINE_PORT.
 * Each client connection gets its own thread.
 * Reads newline-delimited JSON messages and dispatches to MatchingEngine.
 */
class TCPServer {
public:
    TCPServer(int port, MatchingEngine& engine);
    ~TCPServer();

    void start();   // blocks on accept loop
    void stop();

private:
    int port_;
    int server_fd_ = -1;
    MatchingEngine& engine_;
    std::atomic<bool> running_{true};

    void handle_client(int client_fd, const std::string& client_addr);
    void process_message(const std::string& json_msg);

    Order parse_order(const nlohmann::json& j);
};
