#pragma once

#include <atomic>
#include <mutex>
#include <string>

/**
 * Persistent TCP client to the matching engine.
 * Shared by all GBMGenerator threads – thread-safe send.
 * Auto-reconnects on failure.
 */
class OrderClient {
public:
    OrderClient(const std::string& host, int port);
    ~OrderClient();

    // Connect with retry backoff. Returns true on success.
    bool connect(int max_attempts = 10);

    // Thread-safe: serialize json + "\n" and send.
    void send(const std::string& json_msg);

    void disconnect();
    bool is_connected() const { return connected_; }

private:
    std::string host_;
    int port_;
    int sockfd_ = -1;
    std::mutex send_mtx_;
    std::atomic<bool> connected_{false};

    bool try_connect();
    void reconnect_if_needed();
};
