#pragma once

#include "matching_engine.hpp"
#include "lf_queue.hpp"
#include "lob_types.hpp"

#include <atomic>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>

#include <nlohmann/json.hpp>

/**
 * TCP server: accepts connections on ENGINE_PORT.
 * Each client connection gets its own thread.
 * Reads newline-delimited JSON messages and dispatches to:
 *   1. MatchingEngine  — legacy per-symbol worker path (Redis publishing)
 *   2. LFQueue<LOBOrder> — high-performance LOB engine path (Capitol Architecture)
 *
 * The TCP server assigns each unique user_id a monotonically increasing
 * short integer trader_id (0-based) and each order a unique integer system_id.
 */
class TCPServer {
public:
    TCPServer(int port, MatchingEngine& engine,
              LFQueue<LOBOrder>* lob_queue = nullptr);
    ~TCPServer();

    void start();   // blocks on accept loop
    void stop();

private:
    int port_;
    int server_fd_ = -1;
    MatchingEngine&      engine_;
    LFQueue<LOBOrder>*   lob_queue_;   // nullable — if null, LOB path is skipped
    std::atomic<bool>    running_{true};

    // ── ID assignment for the LOB path ────────────────────────────────────────
    std::atomic<int>       next_system_id_{1};     // monotonically increasing order ID
    std::atomic<short int> next_trader_id_{0};     // monotonically increasing trader ID
    std::unordered_map<std::string, short int> trader_id_map_;
    std::mutex trader_id_mtx_;

    short int getOrAssignTraderId(const std::string& user_id);

    void handle_client(int client_fd, const std::string& client_addr);
    void process_message(const std::string& json_msg);

    Order  parse_order  (const nlohmann::json& j);
    // Returns a LOBOrder for the high-performance path.
    // system_id is auto-assigned; trader_id mapped from user_id.
    LOBOrder parse_lob_order(const nlohmann::json& j, int system_id,
                             short int trader_id);
};
