#pragma once

#include <string>

// ─── EngineClient ─────────────────────────────────────────────────────────────
// Synchronous TCP client that forwards triggered orders to the matching engine.
// Sends newline-delimited JSON — the same protocol used by the API gateway.

class EngineClient {
public:
    EngineClient(const std::string& host, int port);
    ~EngineClient();

    // Connect to matching engine; blocks until successful (with backoff)
    void connect();

    // Send a JSON order string. Retries once on send failure (reconnects).
    // Returns true on success.
    bool send_order(const std::string& json_str);

private:
    std::string host_;
    int         port_;
    int         sock_fd_ = -1;

    bool do_connect();
    void close_socket();
};
