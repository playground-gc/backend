#pragma once

#include "order_book.hpp"
#include "redis_publisher.hpp"

#include <atomic>
#include <condition_variable>
#include <functional>
#include <memory>
#include <mutex>
#include <queue>
#include <string>
#include <thread>
#include <unordered_map>
#include <variant>

// ─── Task types dispatched to per-symbol worker threads ──────────────────────

struct PlaceTask  { Order order; };
struct CancelTask { std::string order_id; std::string symbol; std::string user_id; };

using EngineTask = std::variant<PlaceTask, CancelTask>;

// ─── MatchingEngine ───────────────────────────────────────────────────────────

class MatchingEngine {
public:
    explicit MatchingEngine(RedisPublisher& publisher);
    ~MatchingEngine();

    void add_symbol(const std::string& symbol);

    // Thread-safe: enqueue a place order task for the symbol's worker
    void submit_order(Order order);

    // Thread-safe: enqueue a cancel task
    void cancel_order(const std::string& order_id,
                      const std::string& symbol,
                      const std::string& user_id = "");

    void shutdown();

private:
    struct SymbolWorker {
        std::unique_ptr<OrderBook> book;
        std::queue<EngineTask>     task_queue;
        std::mutex                 queue_mtx;
        std::condition_variable    cv;
        std::thread                thread;
        std::atomic<bool>          running{true};
    };

    RedisPublisher& publisher_;
    std::unordered_map<std::string, std::unique_ptr<SymbolWorker>> workers_;
    std::mutex workers_mtx_;

    void worker_loop(SymbolWorker& w, const std::string& symbol);
    void process_task(SymbolWorker& w, EngineTask& task, const std::string& symbol);

    void publish_trades(const std::vector<Trade>& trades, const std::string& symbol);
    void publish_snapshot(OrderBook& book, const std::string& symbol);

    // Serialize Trade to JSON string
    std::string trade_to_json(const Trade& t);
    // Serialize orderbook snapshot to JSON string
    std::string snapshot_to_json(const std::string& symbol,
                                 const std::vector<std::pair<double,double>>& bids,
                                 const std::vector<std::pair<double,double>>& asks);
};
