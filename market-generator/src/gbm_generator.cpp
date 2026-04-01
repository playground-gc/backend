#include "gbm_generator.hpp"

#include <algorithm>    // std::clamp, std::min, std::max
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
                             int          redis_port,
                             int          tps)
    : config_(std::move(config)),
      order_client_(order_client),
      redis_host_(std::move(redis_host)),
      redis_port_(redis_port),
      tps_(tps > 0 ? tps : 10),
      tick_ms_(1000 / (tps > 0 ? tps : 10)),
      ticks_per_year_(ANNUAL_STEPS * static_cast<double>(tps > 0 ? tps : 10)),
      rng_(std::random_device{}())
{
    // Seed simulation state.
    double baseline_sigma_tick  = config_.volatility / std::sqrt(ticks_per_year_);
    sim_.realised_vol           = baseline_sigma_tick;   // F2: seed EMA at baseline per-tick vol
    sim_.anchor_price           = config_.initial_price; // F3: anchor starts at initial price
    sim_.price_ema              = config_.initial_price;
    sim_.hidden_drift           = 0.0;                   // F6: start with zero hidden drift
    sim_.volume_factor          = 1.0;                   // F9: start at long-run mean
}

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

// ─── Main loop (F1–F9 prescribed order of operations) ─────────────────────────

void GBMGenerator::run() {
    connect_redis();
    double   mid      = config_.initial_price;
    double   prev_mid = config_.initial_price;
    uint64_t tick     = 0;

    std::cout << "[GBM:" << config_.symbol << "] started  price=" << mid << "\n";

    // Seed initial price into Redis so dependent services can start immediately.
    if (redis_ctx_) {
        std::string price_key = "price:" + config_.symbol;
        auto* r1 = static_cast<redisReply*>(
            redisCommand(redis_ctx_, "HSET %s price %f", price_key.c_str(), mid));
        if (r1) freeReplyObject(r1);
        auto* r2 = static_cast<redisReply*>(
            redisCommand(redis_ctx_, "HSET %s timestamp %lld", price_key.c_str(), now_ms()));
        if (r2) freeReplyObject(r2);
        auto* r3 = static_cast<redisReply*>(
            redisCommand(redis_ctx_, "HSET %s volume %f", price_key.c_str(), 0.0));
        if (r3) freeReplyObject(r3);
        std::cout << "[GBM:" << config_.symbol << "] Seeded initial price " << mid << "\n";
    }

    while (running_) {
        // ----------------------------------------------------------------
        // Step 1: advance tick counter
        // ----------------------------------------------------------------
        ++tick;

        // ----------------------------------------------------------------
        // Step 2: F1 — regime update (rare Markov switch)
        // ----------------------------------------------------------------
        update_regime();

        // ----------------------------------------------------------------
        // Step 3: F2 — compute effective per-tick sigma (GARCH blend)
        // ----------------------------------------------------------------
        double reg_sigma_ann  = regime_sigma_annual(sim_.current_regime);
        double eff_sigma_tick = compute_effective_sigma_tick(reg_sigma_ann);

        // ----------------------------------------------------------------
        // Step 4: F4 — read DELAYED imbalance (before book generation)
        // ----------------------------------------------------------------
        double delayed_imb = read_delayed_imbalance(IMBALANCE_LAG);

        // ----------------------------------------------------------------
        // Step 5: assemble per-tick drift_term
        //   = regime_mu_tick           (F1)
        //   + hidden_drift/tpy         (F6)
        //   + imbalance_impact*sigma*imb  (F4)
        //   − 0.5*sigma²              (Itô correction)
        // ----------------------------------------------------------------
        double reg_drift_ann  = regime_drift_annual(sim_.current_regime);
        double reg_mu_tick    = reg_drift_ann / ticks_per_year_;
        double hidden_contrib = sim_.hidden_drift / ticks_per_year_;
        double imb_adjust     = IMBALANCE_IMPACT * eff_sigma_tick * delayed_imb;
        double eff_mu_tick    = reg_mu_tick + hidden_contrib + imb_adjust;
        double drift_term     = eff_mu_tick - 0.5 * eff_sigma_tick * eff_sigma_tick;

        // ----------------------------------------------------------------
        // Step 6: CORE GBM step (primary price driver — never bypassed)
        // ----------------------------------------------------------------
        prev_mid = mid;
        mid      = gbm_step(mid, drift_term, eff_sigma_tick);

        // ----------------------------------------------------------------
        // Step 7: F3 — anchoring correction (tiny post-GBM pull)
        // ----------------------------------------------------------------
        mid += ANCHOR_STRENGTH * (sim_.anchor_price - mid);

        // ----------------------------------------------------------------
        // Step 8: sanity guard — reset on NaN/inf/negative
        // ----------------------------------------------------------------
        if (!std::isfinite(mid) || mid < 1.0)
            mid = config_.initial_price;

        // ----------------------------------------------------------------
        // Step 9: F2 — update realised vol EMA
        // ----------------------------------------------------------------
        double abs_return = std::abs(std::log(mid / prev_mid));
        update_realised_vol(abs_return);

        // ----------------------------------------------------------------
        // Step 10: F6 — evolve hidden drift (OU step)
        // ----------------------------------------------------------------
        update_hidden_drift();

        // ----------------------------------------------------------------
        // Step 10b: F9 — evolve volume factor (OU step)
        // ----------------------------------------------------------------
        update_volume_factor();

        // ----------------------------------------------------------------
        // Step 11: F3 — update anchor EMA + periodic anchor reset
        // ----------------------------------------------------------------
        update_anchor(mid, tick);

        // ----------------------------------------------------------------
        // Step 12: volume multiplier (normalised by effective sigma)
        // ----------------------------------------------------------------
        double vol_mult = 1.0 + VOL_SENSITIVITY * abs_return / eff_sigma_tick;

        // ----------------------------------------------------------------
        // Step 13: F5 — per-regime bid/ask size biases
        // ----------------------------------------------------------------
        auto [bid_bias, ask_bias] = regime_bias(sim_.current_regime);

        // ----------------------------------------------------------------
        // Step 14: F8 — dynamic spread (widens when vol spikes)
        //   vol_ratio ~0.8 typical (EMA of |Z| ≈ 0.8 × sigma_tick);
        //   spread stays at base when vol_ratio ≤ 1, widens above.
        // ----------------------------------------------------------------
        double vol_ratio       = (eff_sigma_tick > 0.0)
                                 ? sim_.realised_vol / eff_sigma_tick : 1.0;
        double dyn_spread_frac = HALF_SPREAD_FRAC
                                 * (1.0 + SPREAD_VOL_SENSITIVITY
                                          * std::max(0.0, vol_ratio - 1.0));
        dyn_spread_frac = std::min(dyn_spread_frac, HALF_SPREAD_FRAC * 3.0);

        // ----------------------------------------------------------------
        // Steps 15+16: generate book with all features applied
        // ----------------------------------------------------------------
        Book book = build_book(mid, tick, vol_mult, bid_bias, ask_bias,
                               sim_.volume_factor, dyn_spread_frac);

        // ----------------------------------------------------------------
        // Step 17: F4 — compute imbalance from generated book and write
        //          to circular buffer for future ticks.
        //   imbalance ∈ [-1,+1]: positive = bids thicker = buy pressure
        // ----------------------------------------------------------------
        double total_bid_vol = 0.0, total_ask_vol = 0.0;
        for (const auto& lv : book.bids) total_bid_vol += static_cast<double>(lv.size);
        for (const auto& lv : book.asks) total_ask_vol += static_cast<double>(lv.size);
        double imbalance = (total_bid_vol - total_ask_vol)
                         / (total_bid_vol + total_ask_vol + 1e-9);
        write_imbalance(imbalance);

        // ----------------------------------------------------------------
        // Step 18: publish to Redis + refresh price hash
        // ----------------------------------------------------------------
        ensure_redis();
        publish_book(book);

        if (redis_ctx_) {
            std::string price_key = "price:" + config_.symbol;
            auto* r = static_cast<redisReply*>(
                redisCommand(redis_ctx_, "HSET %s price %f", price_key.c_str(),
                             std::round(mid * 100.0) / 100.0));
            if (r) freeReplyObject(r);
        }

        // ----------------------------------------------------------------
        // Step 19: place orders in the matching engine to keep it liquid
        // ----------------------------------------------------------------
        place_orders(book, levels_to_place_(rng_));

        // ----------------------------------------------------------------
        // Step 20: sleep to maintain target tick rate
        // ----------------------------------------------------------------
        std::this_thread::sleep_for(std::chrono::milliseconds(tick_ms_));
    }

    std::cout << "[GBM:" << config_.symbol << "] stopped\n";
}

// ─── GBM core ─────────────────────────────────────────────────────────────────
// Exact solution: S(t+dt) = S(t) * exp( drift_term + sigma_tick * Z )

double GBMGenerator::gbm_step(double mid, double drift_term, double sigma_tick) {
    double Z = normal_(rng_);
    return mid * std::exp(drift_term + sigma_tick * Z);
}

// ─── generate_levels (F5 + F7 + F8 + F9) ─────────────────────────────────────
// side = +1 → asks (above mid)   side = -1 → bids (below mid)

std::vector<Level> GBMGenerator::generate_levels(double mid, int side,
                                                  double vol_mult,
                                                  double side_bias,
                                                  double volume_factor,
                                                  double dynamic_spread_frac) {
    std::vector<Level> levels;
    levels.reserve(LEVELS);

    double base_offset = dynamic_spread_frac * mid;   // F8: dynamic spread

    for (int k = 0; k < LEVELS; ++k) {
        double offset_k = base_offset * std::exp(static_cast<double>(k) * LOG_STEP);
        double price_k  = mid + side * offset_k;

        // F7: blend Gaussian noise with Pareto-distributed multiplier.
        double Z_k = normal_(rng_);
        double U   = udist_(rng_);
        // Pareto(1, alpha) via inversion: X = 1 / U^(1/alpha), clamped to [1, 20]
        double pareto_mult = std::min(1.0 / std::pow(U, 1.0 / SIZE_PARETO_ALPHA), 20.0);

        double exp_component    = std::exp(-SIZE_DECAY * static_cast<double>(k))
                                  * (1.0 + SIZE_NOISE_FRAC * Z_k);
        double pareto_component = std::exp(-SIZE_DECAY * static_cast<double>(k))
                                  * pareto_mult;
        double blended = (1.0 - SIZE_PARETO_BLEND) * exp_component
                       + SIZE_PARETO_BLEND * pareto_component;

        double raw_sz = BASE_SIZE * vol_mult * side_bias * volume_factor * blended;  // F5+F9
        long   sz_k   = std::max(1L, static_cast<long>(raw_sz));

        levels.push_back({std::round(price_k * 100.0) / 100.0, sz_k});
    }
    return levels;
}

// ─── build_book ───────────────────────────────────────────────────────────────

Book GBMGenerator::build_book(double mid, uint64_t tick,
                               double vol_mult,
                               double bid_bias, double ask_bias,
                               double volume_factor, double dyn_spread_frac) {
    Book book;
    book.mid          = mid;
    book.tick         = tick;
    book.timestamp_ms = now_ms();
    book.asks = generate_levels(mid, +1, vol_mult, ask_bias, volume_factor, dyn_spread_frac);
    book.bids = generate_levels(mid, -1, vol_mult, bid_bias, volume_factor, dyn_spread_frac);
    book.spread     = book.asks[0].price - book.bids[0].price;
    book.spread_pct = (book.spread / book.mid) * 100.0;
    return book;
}

// ─── F1: Regime ───────────────────────────────────────────────────────────────

void GBMGenerator::update_regime() {
    if (udist_(rng_) < REGIME_SWITCH_PROB) {
        int cur = static_cast<int>(sim_.current_regime);
        int a   = (cur + 1) % 3;
        int b   = (cur + 2) % 3;
        sim_.current_regime = static_cast<Regime>((udist_(rng_) < 0.5) ? a : b);
    }
}

double GBMGenerator::regime_sigma_annual(Regime r) const {
    switch (r) {
        case Regime::BULL:    return REGIME_BULL_VOL;
        case Regime::BEAR:    return REGIME_BEAR_VOL;
        case Regime::NEUTRAL: return REGIME_NEUTRAL_VOL;
    }
    return REGIME_NEUTRAL_VOL;
}

double GBMGenerator::regime_drift_annual(Regime r) const {
    switch (r) {
        case Regime::BULL:    return REGIME_BULL_DRIFT;
        case Regime::BEAR:    return REGIME_BEAR_DRIFT;
        case Regime::NEUTRAL: return REGIME_NEUTRAL_DRIFT;
    }
    return REGIME_NEUTRAL_DRIFT;
}

std::pair<double, double> GBMGenerator::regime_bias(Regime r) const {
    switch (r) {
        case Regime::BULL: return {REGIME_BID_BIAS_BULL, REGIME_ASK_BIAS_BULL};
        case Regime::BEAR: return {REGIME_BID_BIAS_BEAR, REGIME_ASK_BIAS_BEAR};
        case Regime::NEUTRAL: break;
    }
    return {1.0, 1.0};
}

// ─── F2: GARCH-like volatility clustering ─────────────────────────────────────

double GBMGenerator::compute_effective_sigma_tick(double reg_sigma_annual) const {
    double realised_annual = sim_.realised_vol * std::sqrt(ticks_per_year_);
    double eff = (1.0 - VOL_CLUSTER_WEIGHT) * reg_sigma_annual
               + VOL_CLUSTER_WEIGHT * realised_annual;
    eff = std::clamp(eff, 0.01, 1.0);   // safety bounds
    return eff / std::sqrt(ticks_per_year_);
}

void GBMGenerator::update_realised_vol(double abs_log_ret) {
    sim_.realised_vol = (1.0 - VOL_EMA_ALPHA) * sim_.realised_vol
                      + VOL_EMA_ALPHA * abs_log_ret;
}

// ─── F3: Price anchoring (slow mean reversion to VWAP proxy) ──────────────────

void GBMGenerator::update_anchor(double mid, uint64_t tick) {
    sim_.price_ema = (1.0 - ANCHOR_EMA_ALPHA) * sim_.price_ema
                   + ANCHOR_EMA_ALPHA * mid;

    if (tick > 0 && tick % static_cast<uint64_t>(ANCHOR_UPDATE_INTERVAL) == 0) {
        sim_.anchor_price       = sim_.price_ema;
        sim_.anchor_last_update = tick;
    }
}

// ─── F4: Imbalance circular buffer ────────────────────────────────────────────

void GBMGenerator::write_imbalance(double imbalance) {
    sim_.imbalance_buffer[static_cast<std::size_t>(sim_.imbalance_write_idx)] = imbalance;
    sim_.imbalance_write_idx = (sim_.imbalance_write_idx + 1) % SimState::IMB_BUF;
}

double GBMGenerator::read_delayed_imbalance(int lag) const {
    // Points to the value written `lag` ticks ago.
    int idx = (sim_.imbalance_write_idx - lag + SimState::IMB_BUF) % SimState::IMB_BUF;
    return sim_.imbalance_buffer[static_cast<std::size_t>(idx)];
}

// ─── F6: Hidden drift Ornstein-Uhlenbeck ──────────────────────────────────────

void GBMGenerator::update_hidden_drift() {
    double dW = normal_(rng_);
    sim_.hidden_drift += -HIDDEN_DRIFT_REVERT * sim_.hidden_drift
                       + (HIDDEN_DRIFT_VOL / std::sqrt(ticks_per_year_)) * dW;
    sim_.hidden_drift = std::clamp(sim_.hidden_drift,
                                   -HIDDEN_DRIFT_MAX, HIDDEN_DRIFT_MAX);
}

// ─── F9: Volume clustering Ornstein-Uhlenbeck ─────────────────────────────────

void GBMGenerator::update_volume_factor() {
    double dW = normal_(rng_);
    sim_.volume_factor += -VOLUME_REVERT * (sim_.volume_factor - VOLUME_MEAN)
                        + VOLUME_NOISE * dW;
    sim_.volume_factor = std::clamp(sim_.volume_factor, 0.3, 3.0);
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
        // Lost connection — ensure_redis() will reconnect on the next tick.
        redisFree(redis_ctx_);
        redis_ctx_ = nullptr;
    }
}

// ─── place_orders — keep the matching engine liquid ───────────────────────────
// Prices come directly from book levels, making them realistic.

void GBMGenerator::place_orders(const Book& book, int n) {
    long long ts = now_ms();
    n = std::min(n, LEVELS);

    for (int i = 0; i < n; ++i) {
        // Bid
        {
            int qty = static_cast<int>(1.0 + udist_(rng_) * 19.0);
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
            int qty = static_cast<int>(1.0 + udist_(rng_) * 19.0);
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
