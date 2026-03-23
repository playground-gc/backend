#pragma once

#include "order_client.hpp"

#include <atomic>
#include <random>
#include <string>
#include <thread>
#include <vector>

struct StockConfig {
    std::string symbol;
    double initial_price = 100.0;
    double drift         = 0.0001;    // μ (annualized)
    double volatility    = 0.02;      // σ (annualized)
};

/**
 * GBMGenerator runs one thread per stock symbol.
 * Each tick:
 *   1. Advance GBM price: S(t+dt) = S(t) * exp((μ - σ²/2)*dt + σ*√dt*Z)
 *   2. Place 3–6 random limit orders around the new mid price
 *   3. Sleep to achieve ~50–100 orders/sec
 */
class GBMGenerator {
public:
    GBMGenerator(StockConfig config, OrderClient& client);

    void start();
    void stop();

private:
    StockConfig    config_;
    OrderClient&   client_;
    std::thread    thread_;
    std::atomic<bool> running_{true};

    double current_price_;

    // RNG – seeded uniquely per instance
    std::mt19937_64 rng_;
    std::normal_distribution<double> normal_{0.0, 1.0};
    std::uniform_real_distribution<double> qty_dist_{1.0, 20.0};
    std::uniform_int_distribution<int>     batch_dist_{3, 6};
    std::uniform_int_distribution<int>     rate_dist_{50, 100};

    // dt is per-order time step (annualized)
    // ANNUAL_STEPS ≈ 252 trading days × 6.5 hours × 3600 seconds
    static constexpr double ANNUAL_STEPS = 252.0 * 6.5 * 3600.0;

    void run();
    double next_price();
    void place_orders_around(double mid_price, int count);

    static std::string make_order_id();
};
