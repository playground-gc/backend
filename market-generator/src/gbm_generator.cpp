#include "gbm_generator.hpp"

#include <atomic>
#include <chrono>
#include <cmath>
#include <iostream>
#include <sstream>

#include <nlohmann/json.hpp>

using json = nlohmann::json;

static long long now_ms_gbm() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

// ─── Constructor ─────────────────────────────────────────────────────────────

GBMGenerator::GBMGenerator(StockConfig config, OrderClient& client)
    : config_(std::move(config)),
      client_(client),
      current_price_(config_.initial_price),
      rng_(std::random_device{}()) {}

// ─── start / stop ────────────────────────────────────────────────────────────

void GBMGenerator::start() {
    thread_ = std::thread(&GBMGenerator::run, this);
}

void GBMGenerator::stop() {
    running_ = false;
    if (thread_.joinable()) thread_.join();
}

// ─── run ─────────────────────────────────────────────────────────────────────

void GBMGenerator::run() {
    std::cout << "[GBM:" << config_.symbol << "] Started at price "
              << current_price_ << "\n";

    while (running_) {
        int orders_per_sec = rate_dist_(rng_);  // 50–100
        int batch_size     = batch_dist_(rng_);  // 3–6 orders per tick

        // Advance GBM price
        double mid = next_price();

        // Place bid/ask orders around mid
        place_orders_around(mid, batch_size);

        // Sleep to maintain target rate
        // tick_interval_ms = 1000 * batch_size / orders_per_sec
        int sleep_ms = (1000 * batch_size) / orders_per_sec;
        std::this_thread::sleep_for(std::chrono::milliseconds(sleep_ms));
    }

    std::cout << "[GBM:" << config_.symbol << "] Stopped\n";
}

// ─── next_price (GBM Euler-Maruyama) ─────────────────────────────────────────

double GBMGenerator::next_price() {
    // dt for one tick: average 75 orders/sec, batch of ~4.5 orders
    // We use a small dt to keep price movement realistic
    double dt = 1.0 / (75.0 * ANNUAL_STEPS);

    double drift_term = (config_.drift - 0.5 * config_.volatility * config_.volatility) * dt;
    double diffusion_term = config_.volatility * std::sqrt(dt) * normal_(rng_);

    current_price_ *= std::exp(drift_term + diffusion_term);

    // Safety: price can't go below $0.01
    if (current_price_ < 0.01) current_price_ = 0.01;

    return current_price_;
}

// ─── place_orders_around ─────────────────────────────────────────────────────

void GBMGenerator::place_orders_around(double mid_price, int count) {
    // Place half on bid side, half on ask side
    int bids = count / 2;
    int asks = count - bids;

    // Bid prices: [mid * 0.995 .. mid * 0.9998]
    std::uniform_real_distribution<double> bid_offset(0.0002, 0.005);
    // Ask prices: [mid * 1.0002 .. mid * 1.005]
    std::uniform_real_distribution<double> ask_offset(0.0002, 0.005);

    long long ts = now_ms_gbm();

    for (int i = 0; i < bids; ++i) {
        double price = mid_price * (1.0 - bid_offset(rng_));
        double qty   = std::round(qty_dist_(rng_) * 100.0) / 100.0;

        json order;
        order["action"]   = "place";
        order["order_id"] = make_order_id();
        order["user_id"]  = "market-generator";
        order["symbol"]   = config_.symbol;
        order["type"]     = "limit";
        order["side"]     = "buy";
        order["price"]    = std::round(price * 100.0) / 100.0;
        order["quantity"] = qty;
        order["timestamp"] = ts;

        client_.send(order.dump());
    }

    for (int i = 0; i < asks; ++i) {
        double price = mid_price * (1.0 + ask_offset(rng_));
        double qty   = std::round(qty_dist_(rng_) * 100.0) / 100.0;

        json order;
        order["action"]   = "place";
        order["order_id"] = make_order_id();
        order["user_id"]  = "market-generator";
        order["symbol"]   = config_.symbol;
        order["type"]     = "limit";
        order["side"]     = "sell";
        order["price"]    = std::round(price * 100.0) / 100.0;
        order["quantity"] = qty;
        order["timestamp"] = ts;

        client_.send(order.dump());
    }
}

// ─── make_order_id ───────────────────────────────────────────────────────────

std::string GBMGenerator::make_order_id() {
    static std::atomic<uint64_t> ctr{0};
    std::ostringstream oss;
    oss << "GEN-" << now_ms_gbm() << "-" << ctr.fetch_add(1);
    return oss.str();
}
