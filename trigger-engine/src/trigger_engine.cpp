#include "trigger_engine.hpp"

#include <nlohmann/json.hpp>

#include <chrono>
#include <ctime>
#include <iostream>
#include <mutex>
#include <sstream>
#include <thread>

using json = nlohmann::json;

// ─── Helpers ──────────────────────────────────────────────────────────────────

long long TriggerEngine::now_ms() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

// ─── Constructor ──────────────────────────────────────────────────────────────

TriggerEngine::TriggerEngine(PgClient& pg, EngineClient& eng, RedisSub& redis)
    : pg_(pg), eng_(eng), redis_(redis) {}

// ─── initialize ──────────────────────────────────────────────────────────────

void TriggerEngine::initialize(const std::vector<std::string>& symbols) {
    symbols_ = symbols;

    // Create empty SymbolState for every known symbol
    for (const auto& sym : symbols_) {
        states_[sym];  // default-constructed
    }

    // Load all pending_trigger orders from PostgreSQL
    auto orders = pg_.load_pending_orders();
    int  loaded = 0;

    for (auto& o : orders) {
        auto it = states_.find(o.symbol);
        if (it == states_.end()) {
            std::cerr << "[TriggerEngine] Unknown symbol in DB: " << o.symbol << " – skipping\n";
            continue;
        }
        SymbolState& s = it->second;
        if (o.side == "buy") {
            s.stop_buys.push(o);
        } else {
            s.stop_sells.push(o);
        }
        ++loaded;
    }

    std::cout << "[TriggerEngine] Initialized: " << loaded
              << " orders across " << symbols_.size() << " symbols\n";
}

// ─── run ─────────────────────────────────────────────────────────────────────

void TriggerEngine::run() {
    running_ = true;

    // Wire Redis callbacks (called from Redis subscriber thread)
    redis_.set_price_tick_cb([this](const std::string& sym, double price) {
        on_price_tick(sym, price);
    });
    redis_.set_new_order_cb([this](const std::string& j) {
        on_new_stop_order(j);
    });
    redis_.set_cancel_order_cb([this](const std::string& j) {
        on_cancel_stop_order(j);
    });

    redis_.start(symbols_);

    // Start expiry sweep background thread
    expiry_thread_ = std::thread(&TriggerEngine::expiry_sweep_loop, this);

    std::cout << "[TriggerEngine] Running\n";
}

// ─── shutdown ─────────────────────────────────────────────────────────────────

void TriggerEngine::shutdown() {
    running_ = false;
    redis_.stop();
    if (expiry_thread_.joinable()) expiry_thread_.join();
    std::cout << "[TriggerEngine] Shutdown complete\n";
}

// ─── on_price_tick ────────────────────────────────────────────────────────────

void TriggerEngine::on_price_tick(const std::string& symbol, double price) {
    auto it = states_.find(symbol);
    if (it == states_.end()) return;

    SymbolState& s = it->second;
    s.last_price = price;

    // ── Stop-sells: trigger when price <= stop_price ──────────────────────────
    // Max-heap: top has the highest stop_price; if even the highest doesn't
    // trigger, nothing else will.
    while (!s.stop_sells.empty()) {
        const StopOrder& top = s.stop_sells.top();
        if (top.stop_price < price) break;  // no more triggers at this price

        StopOrder o = s.stop_sells.top();
        s.stop_sells.pop();

        {
            std::lock_guard<std::mutex> lk(cancelled_mtx_);
            if (cancelled_ids_.count(o.order_id)) continue;
        }
        if (triggered_ids_.count(o.order_id)) continue;

        // Check expiry
        if (o.expires_at_ms > 0 && now_ms() > o.expires_at_ms) {
            pg_.mark_cancelled(o.order_id);
            std::lock_guard<std::mutex> lk(cancelled_mtx_);
            cancelled_ids_.insert(o.order_id);
            std::cout << "[TriggerEngine] Expired stop-sell " << o.order_id << "\n";
            continue;
        }

        dispatch(o);
    }

    // ── Stop-buys: trigger when price >= stop_price ───────────────────────────
    // Min-heap: top has the lowest stop_price; if even the lowest doesn't
    // trigger, nothing else will.
    while (!s.stop_buys.empty()) {
        const StopOrder& top = s.stop_buys.top();
        if (top.stop_price > price) break;  // no more triggers at this price

        StopOrder o = s.stop_buys.top();
        s.stop_buys.pop();

        {
            std::lock_guard<std::mutex> lk(cancelled_mtx_);
            if (cancelled_ids_.count(o.order_id)) continue;
        }
        if (triggered_ids_.count(o.order_id)) continue;

        // Check expiry
        if (o.expires_at_ms > 0 && now_ms() > o.expires_at_ms) {
            pg_.mark_cancelled(o.order_id);
            std::lock_guard<std::mutex> lk(cancelled_mtx_);
            cancelled_ids_.insert(o.order_id);
            std::cout << "[TriggerEngine] Expired stop-buy " << o.order_id << "\n";
            continue;
        }

        dispatch(o);
    }
}

// ─── on_new_stop_order ────────────────────────────────────────────────────────

void TriggerEngine::on_new_stop_order(const std::string& json_str) {
    try {
        auto j = json::parse(json_str);

        StopOrder o;
        o.order_id    = j.at("order_id").get<std::string>();
        o.user_id     = j.at("user_id").get<std::string>();
        o.symbol      = j.at("symbol").get<std::string>();
        o.side        = j.at("side").get<std::string>();
        o.type        = j.at("type").get<std::string>();
        o.stop_price  = j.at("stop_price").get<double>();
        o.limit_price = j.value("limit_price", 0.0);
        o.quantity    = j.at("quantity").get<double>();

        // Parse expires_at ISO string (e.g. "2026-04-27T12:00:00+00:00") → unix ms
        if (j.contains("expires_at") && !j["expires_at"].is_null()) {
            std::string ea = j["expires_at"].get<std::string>();
            struct tm t{};
            char* end = strptime(ea.c_str(), "%Y-%m-%dT%H:%M:%S", &t);
            if (end) {
                time_t epoch = timegm(&t);
                if (epoch != (time_t)-1) {
                    o.expires_at_ms = static_cast<long long>(epoch) * 1000LL;
                }
            }
        }

        auto sit = states_.find(o.symbol);
        if (sit == states_.end()) {
            std::cerr << "[TriggerEngine] New stop order for unknown symbol: " << o.symbol << "\n";
            return;
        }

        SymbolState& s = sit->second;
        if (o.side == "buy") {
            s.stop_buys.push(o);
        } else {
            s.stop_sells.push(o);
        }

        std::cout << "[TriggerEngine] Added " << o.type << " " << o.side
                  << " @ stop=" << o.stop_price << " for " << o.symbol
                  << " (order=" << o.order_id << ")\n";

        // Check immediately if already triggered at current price
        if (s.last_price > 0.0) {
            on_price_tick(o.symbol, s.last_price);
        }

    } catch (const std::exception& ex) {
        std::cerr << "[TriggerEngine] on_new_stop_order parse error: " << ex.what() << "\n";
    }
}

// ─── on_cancel_stop_order ────────────────────────────────────────────────────

void TriggerEngine::on_cancel_stop_order(const std::string& json_str) {
    try {
        auto j = json::parse(json_str);
        std::string order_id = j.at("order_id").get<std::string>();
        {
            std::lock_guard<std::mutex> lk(cancelled_mtx_);
            cancelled_ids_.insert(order_id);
        }
        std::cout << "[TriggerEngine] Marked order " << order_id << " as cancelled\n";
    } catch (const std::exception& ex) {
        std::cerr << "[TriggerEngine] on_cancel_stop_order parse error: " << ex.what() << "\n";
    }
}

// ─── dispatch ────────────────────────────────────────────────────────────────

void TriggerEngine::dispatch(const StopOrder& order) {
    // Mark as triggered immediately (idempotency guard)
    triggered_ids_.insert(order.order_id);

    std::string msg = build_engine_json(order);

    bool ok = eng_.send_order(msg);
    if (!ok) {
        // Remove from triggered set so next price tick can retry
        triggered_ids_.erase(order.order_id);
        std::cerr << "[TriggerEngine] Failed to forward order " << order.order_id
                  << " to engine – will retry on next tick\n";
        // Re-insert into heap for next tick
        auto& s = states_[order.symbol];
        if (order.side == "buy") s.stop_buys.push(order);
        else                     s.stop_sells.push(order);
        return;
    }

    // Update DB status
    pg_.mark_triggered(order.order_id);

    // Notify frontend via Redis
    publish_trigger_notification(order);

    std::cout << "[TriggerEngine] Triggered " << order.type << " " << order.side
              << " " << order.quantity << "x" << order.symbol
              << " @ stop=" << order.stop_price
              << " (order=" << order.order_id << ")\n";
}

// ─── build_engine_json ────────────────────────────────────────────────────────

std::string TriggerEngine::build_engine_json(const StopOrder& order) const {
    json j;
    j["action"]    = "place";
    j["order_id"]  = order.order_id;
    j["user_id"]   = order.user_id;
    j["symbol"]    = order.symbol;
    j["side"]      = order.side;
    j["quantity"]  = order.quantity;
    j["timestamp"] = now_ms();

    if (order.type == "stop_limit") {
        j["type"]  = "limit";
        j["price"] = order.limit_price;
    } else {
        j["type"]  = "market";
    }

    return j.dump();
}

// ─── publish_trigger_notification ────────────────────────────────────────────

void TriggerEngine::publish_trigger_notification(const StopOrder& order) {
    json j;
    j["type"]         = "stop_triggered";
    j["order_id"]     = order.order_id;
    j["symbol"]       = order.symbol;
    j["side"]         = order.side;
    j["order_type"]   = order.type;
    j["stop_price"]   = order.stop_price;
    j["triggered_at"] = now_ms();
    j["status"]       = "triggered";

    std::string channel = "stop_triggered:" + order.user_id;
    redis_.publish(channel, j.dump());
}

// ─── expiry_sweep_loop ────────────────────────────────────────────────────────

void TriggerEngine::expiry_sweep_loop() {
    while (running_) {
        // Sleep 60s in small increments to allow clean shutdown
        for (int i = 0; i < 60 && running_; ++i) {
            std::this_thread::sleep_for(std::chrono::seconds(1));
        }
        if (!running_) break;

        try {
            auto expired_ids = pg_.load_expired_order_ids();
            for (const auto& oid : expired_ids) {
                bool already_done = false;
                {
                    std::lock_guard<std::mutex> lk(cancelled_mtx_);
                    already_done = cancelled_ids_.count(oid) > 0;
                }
                if (!already_done && !triggered_ids_.count(oid)) {
                    pg_.mark_cancelled(oid);
                    std::lock_guard<std::mutex> lk(cancelled_mtx_);
                    cancelled_ids_.insert(oid);
                    std::cout << "[TriggerEngine] Sweep: expired order " << oid << "\n";
                }
            }
        } catch (const std::exception& ex) {
            std::cerr << "[TriggerEngine] Expiry sweep error: " << ex.what() << "\n";
        }
    }
}
