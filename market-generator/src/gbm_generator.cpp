#include "gbm_generator.hpp"

#include <atomic>
#include <chrono>
#include <cmath>
#include <iostream>
#include <sstream>

#include <hiredis/hiredis.h>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

// ─── Constructor ──────────────────────────────────────────────────────────────

GBMGenerator::GBMGenerator(StockConfig  config,
                             OrderClient& order_client,
                             std::string  redis_host,
                             int          redis_port)
    : config_(std::move(config)),
      order_client_(order_client),
      redis_host_(std::move(redis_host)),
      redis_port_(redis_port),
      current_price_(config_.initial_price),
      rng_(std::random_device{}())
{}

// ─── start / stop ─────────────────────────────────────────────────────────────

void GBMGenerator::start() {
    thread_ = std::thread(&GBMGenerator::run, this);
}

void GBMGenerator::stop() {
    running_ = false;
    if (thread_.joinable()) thread_.join();
    if (redis_ctx_) {
        redisFree(redis_ctx_);
        redis_ctx_ = nullptr;
    }
}

// ─── Main loop ────────────────────────────────────────────────────────────────

void GBMGenerator::run() {
    connect_redis();
    std::cout << "[GBM:" << config_.symbol << "] started  price="
              << current_price_ << "\n";

    constexpr int SLEEP_MS = 1000 / TPS;  // 10 ms per tick

    while (running_) {
        ++tick_count_;

        // 1. Advance GBM price
        next_price();

        // 2. Build L2 book (lognormal spacing + exponential size decay)
        Book book = build_book();

        // 3. Publish snapshot to Redis → websocket-service fans it out
        ensure_redis();
        publish_book(book);

        // 4. Place orders in the matching engine so it stays liquid
        place_orders(book, levels_to_place_(rng_));

        std::this_thread::sleep_for(std::chrono::milliseconds(SLEEP_MS));
    }

    std::cout << "[GBM:" << config_.symbol << "] stopped\n";
}

// ─── GBM price step ───────────────────────────────────────────────────────────
// Exact solution:  S(t+dt) = S(t) * exp( (μ - σ²/2)*dt  +  σ*√dt*Z )

void GBMGenerator::next_price() {
    double dt         = 1.0 / (static_cast<double>(TPS) * ANNUAL_STEPS);
    double drift_term = (config_.drift - 0.5 * config_.volatility * config_.volatility) * dt;
    double diff_term  = config_.volatility * std::sqrt(dt) * normal_(rng_);

    current_price_ *= std::exp(drift_term + diff_term);

    // Guard against NaN / zero / price collapse
    if (!std::isfinite(current_price_) || current_price_ < 0.01)
        current_price_ = config_.initial_price;
}

// ─── generate_levels ──────────────────────────────────────────────────────────
// Mirrors generate_levels() from gbm.cpp.txt exactly.
//   side = +1 → asks (above mid)
//   side = -1 → bids (below mid)
// Lognormal spacing: offset_k = half_spread * mid * exp(k * LOG_STEP)
// Exponential size decay: sz_k = BASE_SIZE * exp(-SIZE_DECAY*k) * (1 + noise)

std::vector<Level> GBMGenerator::generate_levels(double mid, int side) {
    std::vector<Level> levels;
    levels.reserve(LEVELS);

    double base_offset = HALF_SPREAD_FRAC * mid;

    for (int k = 0; k < LEVELS; ++k) {
        double offset_k = base_offset * std::exp(static_cast<double>(k) * LOG_STEP);
        double price_k  = mid + side * offset_k;

        double Z_k    = normal_(rng_);
        double raw_sz = BASE_SIZE
                      * std::exp(-SIZE_DECAY * static_cast<double>(k))
                      * (1.0 + SIZE_NOISE_FRAC * Z_k);
        long sz_k = std::max(1L, static_cast<long>(raw_sz));

        levels.push_back({std::round(price_k * 100.0) / 100.0, sz_k});
    }
    return levels;
}

// ─── build_book ───────────────────────────────────────────────────────────────

Book GBMGenerator::build_book() {
    Book book;
    book.mid          = current_price_;
    book.tick         = tick_count_;
    book.timestamp_ms = now_ms();
    book.asks         = generate_levels(book.mid, +1);
    book.bids         = generate_levels(book.mid, -1);
    book.spread       = book.asks[0].price - book.bids[0].price;
    book.spread_pct   = (book.spread / book.mid) * 100.0;
    return book;
}

// ─── publish_book → Redis channel market_data:{symbol} ───────────────────────

void GBMGenerator::publish_book(const Book& book) {
    if (!redis_ctx_) return;

    json asks = json::array();
    for (const auto& lvl : book.asks)
        asks.push_back({{"price", lvl.price}, {"size", lvl.size}});

    json bids = json::array();
    for (const auto& lvl : book.bids)
        bids.push_back({{"price", lvl.price}, {"size", lvl.size}});

    json j;
    j["type"]       = "market_data";
    j["symbol"]     = config_.symbol;
    j["tick"]       = book.tick;
    j["ts"]         = book.timestamp_ms;
    j["mid"]        = std::round(book.mid * 100.0) / 100.0;
    j["spread"]     = std::round(book.spread * 100.0) / 100.0;
    j["spread_pct"] = std::round(book.spread_pct * 10000.0) / 10000.0;
    j["asks"]       = std::move(asks);
    j["bids"]       = std::move(bids);

    std::string channel = "market_data:" + config_.symbol;
    std::string payload = j.dump();

    auto* reply = static_cast<redisReply*>(
        redisCommand(redis_ctx_, "PUBLISH %s %s",
                     channel.c_str(), payload.c_str()));
    if (reply) {
        freeReplyObject(reply);
    } else {
        // Lost connection — ensure_redis() will reconnect on the next tick
        redisFree(redis_ctx_);
        redis_ctx_ = nullptr;
    }
}

// ─── place_orders – keep the matching engine liquid ───────────────────────────
// Prices come directly from the book levels, making them realistic.

void GBMGenerator::place_orders(const Book& book, int n) {
    long long ts = now_ms();
    n = std::min(n, LEVELS);

    for (int i = 0; i < n; ++i) {
        // Bid
        {
            double qty = std::round(qty_dist_(rng_) * 100.0) / 100.0;
            json order;
            order["action"]    = "place";
            order["order_id"]  = make_order_id();
            order["user_id"]   = "market-generator";
            order["symbol"]    = config_.symbol;
            order["type"]      = "limit";
            order["side"]      = "buy";
            order["price"]     = book.bids[i].price;
            order["quantity"]  = qty;
            order["timestamp"] = ts;
            order_client_.send(order.dump());
        }
        // Ask
        {
            double qty = std::round(qty_dist_(rng_) * 100.0) / 100.0;
            json order;
            order["action"]    = "place";
            order["order_id"]  = make_order_id();
            order["user_id"]   = "market-generator";
            order["symbol"]    = config_.symbol;
            order["type"]      = "limit";
            order["side"]      = "sell";
            order["price"]     = book.asks[i].price;
            order["quantity"]  = qty;
            order["timestamp"] = ts;
            order_client_.send(order.dump());
        }
    }
}

// ─── Redis connection ─────────────────────────────────────────────────────────

bool GBMGenerator::connect_redis() {
    if (redis_ctx_) {
        redisFree(redis_ctx_);
        redis_ctx_ = nullptr;
    }

    redis_ctx_ = redisConnect(redis_host_.c_str(), redis_port_);
    if (!redis_ctx_ || redis_ctx_->err) {
        std::cerr << "[GBM:" << config_.symbol << "] Redis connect failed: "
                  << (redis_ctx_ ? redis_ctx_->errstr : "OOM") << "\n";
        if (redis_ctx_) { redisFree(redis_ctx_); redis_ctx_ = nullptr; }
        return false;
    }
    std::cout << "[GBM:" << config_.symbol << "] Redis connected ("
              << redis_host_ << ":" << redis_port_ << ")\n";
    return true;
}

void GBMGenerator::ensure_redis() {
    if (!redis_ctx_) connect_redis();
}

// ─── Utilities ────────────────────────────────────────────────────────────────

long long GBMGenerator::now_ms() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch()).count();
}

std::string GBMGenerator::make_order_id() {
    static std::atomic<uint64_t> ctr{0};
    std::ostringstream oss;
    oss << "GEN-" << now_ms() << "-" << ctr.fetch_add(1);
    return oss.str();
}
