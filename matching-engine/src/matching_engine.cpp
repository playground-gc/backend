#include "matching_engine.hpp"

#include <chrono>
#include <iostream>
#include <sstream>

#include <nlohmann/json.hpp>

using json = nlohmann::json;

static long long now_ms_me() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

// ─── Constructor / Destructor ─────────────────────────────────────────────────

MatchingEngine::MatchingEngine(RedisPublisher& publisher)
    : publisher_(publisher) {}

MatchingEngine::~MatchingEngine() {
    shutdown();
}

// ─── add_symbol ───────────────────────────────────────────────────────────────

void MatchingEngine::add_symbol(const std::string& symbol) {
    std::lock_guard<std::mutex> lock(workers_mtx_);
    if (workers_.count(symbol)) return;

    auto w = std::make_unique<SymbolWorker>();
    w->book = std::make_unique<OrderBook>(symbol);
    w->thread = std::thread(&MatchingEngine::worker_loop, this,
                            std::ref(*w), symbol);
    workers_[symbol] = std::move(w);
    std::cout << "[ME] Added symbol: " << symbol << "\n";
}

// ─── submit_order ─────────────────────────────────────────────────────────────

void MatchingEngine::submit_order(Order order) {
    std::lock_guard<std::mutex> lock(workers_mtx_);
    auto it = workers_.find(order.symbol);
    if (it == workers_.end()) {
        std::cerr << "[ME] Unknown symbol: " << order.symbol << "\n";
        return;
    }
    SymbolWorker& w = *it->second;
    {
        std::lock_guard<std::mutex> qlock(w.queue_mtx);
        w.task_queue.push(PlaceTask{std::move(order)});
    }
    w.cv.notify_one();
}

// ─── cancel_order ─────────────────────────────────────────────────────────────

void MatchingEngine::cancel_order(const std::string& order_id,
                                   const std::string& symbol,
                                   const std::string& user_id) {
    std::lock_guard<std::mutex> lock(workers_mtx_);
    auto it = workers_.find(symbol);
    if (it == workers_.end()) return;
    SymbolWorker& w = *it->second;
    {
        std::lock_guard<std::mutex> qlock(w.queue_mtx);
        w.task_queue.push(CancelTask{order_id, symbol, user_id});
    }
    w.cv.notify_one();
}

// ─── shutdown ─────────────────────────────────────────────────────────────────

void MatchingEngine::shutdown() {
    std::lock_guard<std::mutex> lock(workers_mtx_);
    for (auto& [sym, w] : workers_) {
        w->running = false;
        w->cv.notify_all();
    }
    for (auto& [sym, w] : workers_) {
        if (w->thread.joinable()) w->thread.join();
    }
    workers_.clear();
}

// ─── worker_loop ─────────────────────────────────────────────────────────────

void MatchingEngine::worker_loop(SymbolWorker& w, const std::string& symbol) {
    std::cout << "[ME] Worker started for " << symbol << "\n";

    while (w.running) {
        std::unique_lock<std::mutex> lock(w.queue_mtx);
        w.cv.wait(lock, [&] { return !w.task_queue.empty() || !w.running; });

        while (!w.task_queue.empty()) {
            EngineTask task = std::move(w.task_queue.front());
            w.task_queue.pop();
            lock.unlock();

            process_task(w, task, symbol);

            lock.lock();
        }
    }
    std::cout << "[ME] Worker stopped for " << symbol << "\n";
}

// ─── process_task ─────────────────────────────────────────────────────────────

void MatchingEngine::process_task(SymbolWorker& w, EngineTask& task,
                                   const std::string& symbol) {
    if (std::holds_alternative<PlaceTask>(task)) {
        auto& pt = std::get<PlaceTask>(task);
        std::vector<Trade> trades = w.book->place_order(std::move(pt.order));

        if (!trades.empty()) {
            publish_trades(trades, symbol);
        }
        publish_snapshot(*w.book, symbol);
    } else {
        auto& ct = std::get<CancelTask>(task);
        bool cancelled = w.book->cancel_order(ct.order_id);
        if (cancelled) {
            publish_snapshot(*w.book, symbol);
        }
    }
}

// ─── publish_trades ───────────────────────────────────────────────────────────

void MatchingEngine::publish_trades(const std::vector<Trade>& trades,
                                     const std::string& symbol) {
    for (const auto& t : trades) {
        std::string msg = trade_to_json(t);

        // 1. Pub/Sub for WebSocket service
        publisher_.publish("trades:" + symbol, msg);

        // 2. Stream for candle service (durable)
        publisher_.xadd("stream:trades", "data", msg);

        // 3. Latest price hash
        publisher_.hset("price:" + symbol, "price",     std::to_string(t.price));
        publisher_.hset("price:" + symbol, "timestamp", std::to_string(t.timestamp));
        publisher_.hset("price:" + symbol, "volume",    std::to_string(t.quantity));
    }
}

// ─── publish_snapshot ─────────────────────────────────────────────────────────

void MatchingEngine::publish_snapshot(OrderBook& book, const std::string& symbol) {
    thread_local uint64_t last_snapshot_time = 0;
    uint64_t now = now_ms_me();
    if (now - last_snapshot_time < 100) {
        return; // throttle snapshot publishing to 10 FPS
    }
    last_snapshot_time = now;

    auto [bids, asks] = book.snapshot(20);
    std::string snap = snapshot_to_json(symbol, bids, asks);

    // Cache with 5s TTL for API gateway
    publisher_.setex("orderbook:snapshot:" + symbol, 5, snap);

    // Pub/Sub for WebSocket service
    publisher_.publish("orderbook:" + symbol, snap);
}

// ─── JSON serialization ───────────────────────────────────────────────────────

std::string MatchingEngine::trade_to_json(const Trade& t) {
    json j;
    j["event"]         = "trade";
    j["trade_id"]      = t.trade_id;
    j["symbol"]        = t.symbol;
    j["price"]         = t.price;
    j["quantity"]      = t.quantity;
    j["buy_order_id"]  = t.buy_order_id;
    j["sell_order_id"] = t.sell_order_id;
    j["buyer_id"]      = t.buyer_id;
    j["seller_id"]     = t.seller_id;
    j["timestamp"]     = t.timestamp;
    return j.dump();
}

std::string MatchingEngine::snapshot_to_json(
    const std::string& symbol,
    const std::vector<std::pair<double,double>>& bids,
    const std::vector<std::pair<double,double>>& asks) {

    json j;
    j["event"]     = "orderbook";
    j["symbol"]    = symbol;
    j["timestamp"] = now_ms_me();

    json bids_arr = json::array();
    for (auto& [p, q] : bids) bids_arr.push_back({p, q});
    j["bids"] = bids_arr;

    json asks_arr = json::array();
    for (auto& [p, q] : asks) asks_arr.push_back({p, q});
    j["asks"] = asks_arr;

    return j.dump();
}
