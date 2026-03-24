#pragma once

#include "order_client.hpp"

#include <atomic>
#include <cstdint>
#include <random>
#include <string>
#include <thread>
#include <vector>

struct redisContext;  // forward-declare; avoids pulling hiredis into every TU

// ─── Data types ───────────────────────────────────────────────────────────────

struct StockConfig {
    std::string symbol;
    double initial_price = 100.0;
    double drift         = 0.0001;   // μ (annualised)
    double volatility    = 0.02;     // σ (annualised)
};

struct Level {
    double price;
    long   size;
};

struct Book {
    std::vector<Level> asks;        // asks[0] = best ask (lowest price)
    std::vector<Level> bids;        // bids[0] = best bid (highest price)
    double    mid;
    double    spread;
    double    spread_pct;
    uint64_t  tick;
    long long timestamp_ms;
};

// ─── GBMGenerator ─────────────────────────────────────────────────────────────

/**
 * One thread per stock symbol.  Each tick (TPS = 100 ticks/sec):
 *   1. Advance mid price via the exact GBM solution:
 *        S(t+dt) = S(t) * exp( (μ - σ²/2)*dt  +  σ*√dt*Z )
 *   2. Build a 10-level L2 order book using lognormal level spacing and
 *      exponential size decay — identical to the logic in gbm.cpp.txt.
 *   3. Publish the book snapshot as JSON to Redis channel market_data:{symbol}.
 *   4. Place a small batch of limit orders derived from book levels into the
 *      matching engine to keep it liquid.
 */
class GBMGenerator {
public:
    GBMGenerator(StockConfig  config,
                 OrderClient& order_client,
                 std::string  redis_host,
                 int          redis_port);

    void start();
    void stop();

private:
    // ── configuration ──────────────────────────────────────────────────────
    StockConfig  config_;
    OrderClient& order_client_;
    std::string  redis_host_;
    int          redis_port_;

    // ── state ──────────────────────────────────────────────────────────────
    double   current_price_;
    uint64_t tick_count_ = 0;

    // ── threading ──────────────────────────────────────────────────────────
    std::thread       thread_;
    std::atomic<bool> running_{true};

    // ── Redis (one connection per generator thread — no mutex needed) ───────
    redisContext* redis_ctx_ = nullptr;

    // ── RNG ────────────────────────────────────────────────────────────────
    std::mt19937_64 rng_;
    std::normal_distribution<double>       normal_{0.0, 1.0};
    std::uniform_real_distribution<double> qty_dist_{1.0, 20.0};
    std::uniform_int_distribution<int>     levels_to_place_{1, 3};

    // ── GBM / timing constants ─────────────────────────────────────────────
    static constexpr int    TPS          = 100;
    static constexpr double ANNUAL_STEPS = 252.0 * 6.5 * 3600.0;

    // ── Book geometry (from gbm.cpp.txt) ───────────────────────────────────
    static constexpr int    LEVELS           = 10;
    static constexpr double HALF_SPREAD_FRAC = 5e-4;   // 0.05 % of mid
    static constexpr double LOG_STEP         = 0.30;   // log-space level gap
    static constexpr double BASE_SIZE        = 1000.0;
    static constexpr double SIZE_DECAY       = 0.30;
    static constexpr double SIZE_NOISE_FRAC  = 0.10;

    // ── private methods ────────────────────────────────────────────────────
    void run();
    void next_price();
    std::vector<Level> generate_levels(double mid, int side);
    Book   build_book();
    void   publish_book(const Book& book);
    void   place_orders(const Book& book, int n);
    bool   connect_redis();
    void   ensure_redis();

    static long long   now_ms();
    static std::string make_order_id();
};
