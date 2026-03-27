#pragma once

#include "stop_order.hpp"
#include "pg_client.hpp"
#include "engine_client.hpp"
#include "redis_sub.hpp"

#include <atomic>
#include <chrono>
#include <mutex>
#include <queue>
#include <string>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <vector>

// ─── SymbolState ─────────────────────────────────────────────────────────────

struct SymbolState {
    // Stop-buy min-heap: lowest stop_price at top → triggers when price >= stop_price
    std::priority_queue<StopOrder, std::vector<StopOrder>, StopBuyCmp>  stop_buys;
    // Stop-sell max-heap: highest stop_price at top → triggers when price <= stop_price
    std::priority_queue<StopOrder, std::vector<StopOrder>, StopSellCmp> stop_sells;
    double last_price = 0.0;
};

// ─── TriggerEngine ───────────────────────────────────────────────────────────

class TriggerEngine {
public:
    TriggerEngine(PgClient& pg, EngineClient& eng, RedisSub& redis);

    // Load all pending_trigger orders from DB into in-memory heaps
    void initialize(const std::vector<std::string>& symbols);

    // Register callbacks on RedisSub and start listener + expiry sweeper
    void run();

    // Called from Redis subscriber thread
    void on_price_tick(const std::string& symbol, double price);
    void on_new_stop_order(const std::string& json);
    void on_cancel_stop_order(const std::string& json);

    void shutdown();

private:
    PgClient&    pg_;
    EngineClient& eng_;
    RedisSub&    redis_;

    std::vector<std::string> symbols_;

    // Per-symbol heap state — accessed only from the Redis subscriber thread
    std::unordered_map<std::string, SymbolState> states_;

    // Idempotency: order IDs already dispatched to the matching engine
    std::unordered_set<std::string> triggered_ids_;

    // Orders cancelled while in the heap (lazy deletion)
    // Protected by cancelled_mtx_ — accessed from both subscriber and sweeper threads.
    std::unordered_set<std::string> cancelled_ids_;
    std::mutex                      cancelled_mtx_;

    std::thread       expiry_thread_;
    std::atomic<bool> running_{false};

    // Dispatch a triggered stop order to the matching engine
    void dispatch(const StopOrder& order);

    // Build the JSON message to send to the matching engine
    std::string build_engine_json(const StopOrder& order) const;

    // Publish a trigger notification for the frontend
    void publish_trigger_notification(const StopOrder& order);

    // Background thread: sweep expired orders every 60s
    void expiry_sweep_loop();

    static long long now_ms();
};
