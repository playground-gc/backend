#pragma once

#include "order_client.hpp"

#include <array>
#include <atomic>
#include <cstdint>
#include <random>
#include <string>
#include <thread>
#include <utility>
#include <vector>

struct redisContext;  // forward-declare; avoids pulling hiredis into every TU

// ─── Data types ───────────────────────────────────────────────────────────────

struct StockConfig {
    std::string symbol;
    double initial_price = 50000.0;   // s0
    double drift         = 0.001;     // μ (annualised)
    double volatility    = 0.20;      // σ (annualised)
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

// F1: market regime
enum class Regime { NEUTRAL, BULL, BEAR };

// All mutable per-tick simulation state (F1–F9)
struct SimState {
    // F1 – regime
    Regime current_regime = Regime::NEUTRAL;

    // F2 – realised vol EMA (seeded at baseline sigma_tick in constructor)
    double realised_vol = 0.0;

    // F3 – price anchoring
    double   anchor_price       = 0.0;
    double   price_ema          = 0.0;
    uint64_t anchor_last_update = 0;

    // F4 – order-flow imbalance circular buffer (must be > IMBALANCE_LAG)
    static constexpr int IMB_BUF = 64;
    std::array<double, IMB_BUF> imbalance_buffer{};
    int imbalance_write_idx = 0;

    // F6 – hidden drift OU process
    double hidden_drift = 0.0;

    // F9 – volume clustering OU process
    double volume_factor = 1.0;
};

// ─── GBMGenerator ─────────────────────────────────────────────────────────────

/**
 * One thread per stock symbol.  Each tick implements the full F1–F9
 * microstructure pipeline from gbm.cpp(1).txt:
 *
 *   F1  Hidden Markov regime switching  (BULL / BEAR / NEUTRAL)
 *   F2  GARCH-like volatility clustering (EMA of realised vol)
 *   F3  Soft price anchoring             (slow mean reversion to VWAP proxy)
 *   F4  Order-flow imbalance → delayed price impact (lag buffer)
 *   F5  Asymmetric book depth per regime (bid/ask size biases)
 *   F6  Slowly varying hidden drift      (Ornstein-Uhlenbeck process)
 *   F7  Power-law order sizes            (Pareto blend, α ≈ 1.3)
 *   F8  Dynamic spread widening          (widens with realised vol)
 *   F9  Volume clustering                (OU process for common volume factor)
 *
 * The GBM step is the PRIMARY price driver; all post-GBM corrections are
 * constrained to be small relative to per-tick GBM noise (< 0.1 × sigma_tick).
 *
 * The book snapshot is published as JSON to Redis channel market_data:{symbol}
 * and a small batch of limit orders is placed in the matching engine each tick.
 */
class GBMGenerator {
public:
    GBMGenerator(StockConfig  config,
                 OrderClient& order_client,
                 std::string  redis_host,
                 int          redis_port,
                 int          tps = 10);

    void start();
    void stop();

private:
    // ── Configuration ──────────────────────────────────────────────────────
    StockConfig  config_;
    OrderClient& order_client_;
    std::string  redis_host_;
    int          redis_port_;
    int          tps_;
    int          tick_ms_;

    // ── Derived constant (ticks per trading year) ──────────────────────────
    double ticks_per_year_;

    // ── Simulation state ────────────────────────────────────────────────────
    SimState sim_;

    // ── Threading ───────────────────────────────────────────────────────────
    std::thread       thread_;
    std::atomic<bool> running_{true};

    // ── Redis (one connection per generator thread — no mutex needed) ───────
    redisContext* redis_ctx_ = nullptr;

    // ── RNG ─────────────────────────────────────────────────────────────────
    std::mt19937_64                        rng_;
    std::normal_distribution<double>       normal_{0.0, 1.0};
    std::uniform_real_distribution<double> udist_{0.0, 1.0};
    std::uniform_int_distribution<int>     levels_to_place_{1, 3};

    // ── Annualisation ───────────────────────────────────────────────────────
    static constexpr double ANNUAL_STEPS = 252.0 * 6.5 * 3600.0;  // trading-seconds per year

    // ── Book geometry ───────────────────────────────────────────────────────
    static constexpr int    LEVELS           = 10;
    static constexpr double HALF_SPREAD_FRAC = 2e-6;    // BASE half-spread as fraction of mid
    static constexpr double LOG_STEP         = 0.30;    // log-space increment between adjacent levels
    static constexpr double BASE_SIZE        = 30.0;    // size at best level (k=0)
    static constexpr double SIZE_DECAY       = 0.30;    // exponential decay rate across levels
    static constexpr double SIZE_NOISE_FRAC  = 0.35;    // fractional Gaussian noise on sizes
    static constexpr double VOL_SENSITIVITY  = 6.0;     // volMult = 1 + VOL_SENSITIVITY*|logRet|/sigma_tick

    // ── F1: Regime parameters ───────────────────────────────────────────────
    static constexpr double REGIME_SWITCH_PROB   = 0.0002;  // per-tick prob (~50 s at 100 tps)
    static constexpr double REGIME_BULL_DRIFT    =  0.10;   // annualised drift in BULL
    static constexpr double REGIME_BEAR_DRIFT    = -0.10;   // annualised drift in BEAR
    static constexpr double REGIME_NEUTRAL_DRIFT =  0.001;  // annualised drift in NEUTRAL
    static constexpr double REGIME_BULL_VOL      =  0.22;   // annualised vol in BULL
    static constexpr double REGIME_BEAR_VOL      =  0.25;   // annualised vol in BEAR
    static constexpr double REGIME_NEUTRAL_VOL   =  0.15;   // annualised vol in NEUTRAL

    // ── F2: Volatility clustering (GARCH-like) ──────────────────────────────
    static constexpr double VOL_EMA_ALPHA      = 0.005;  // EMA decay (~200-tick half-life)
    static constexpr double VOL_CLUSTER_WEIGHT = 0.40;   // blend weight toward realised vol

    // ── F3: Price anchoring (soft mean reversion) ───────────────────────────
    static constexpr int    ANCHOR_UPDATE_INTERVAL = 36000;   // ticks between anchor resets
    static constexpr double ANCHOR_EMA_ALPHA       = 0.0001;  // very slow EMA for anchor price
    static constexpr double ANCHOR_STRENGTH        = 0.00002; // per-tick pull toward anchor

    // ── F4: Order-flow imbalance → delayed price impact ─────────────────────
    static constexpr double IMBALANCE_IMPACT = 0.15;  // strength in units of sigma_tick
    static constexpr int    IMBALANCE_LAG    = 10;    // ticks of delay before impact

    // ── F5: Asymmetric book depth per regime ────────────────────────────────
    static constexpr double REGIME_BID_BIAS_BULL = 1.15;
    static constexpr double REGIME_ASK_BIAS_BULL = 0.88;
    static constexpr double REGIME_BID_BIAS_BEAR = 0.88;
    static constexpr double REGIME_ASK_BIAS_BEAR = 1.15;

    // ── F6: Hidden drift Ornstein-Uhlenbeck ─────────────────────────────────
    static constexpr double HIDDEN_DRIFT_VOL    = 0.02;   // annualised vol of the drift walk
    static constexpr double HIDDEN_DRIFT_REVERT = 0.001;  // OU mean-reversion speed per tick
    static constexpr double HIDDEN_DRIFT_MAX    = 0.30;   // annualised magnitude clamp

    // ── F7: Power-law order sizes (Pareto blend) ────────────────────────────
    static constexpr double SIZE_PARETO_ALPHA = 1.3;   // Pareto exponent
    static constexpr double SIZE_PARETO_BLEND = 0.55;  // blend weight toward Pareto

    // ── F8: Dynamic spread widening with volatility ──────────────────────────
    static constexpr double SPREAD_VOL_SENSITIVITY = 0.50;

    // ── F9: Volume clustering (OU) ───────────────────────────────────────────
    static constexpr double VOLUME_MEAN   = 1.0;
    static constexpr double VOLUME_REVERT = 0.001;
    static constexpr double VOLUME_NOISE  = 0.02;

    // ── Main loop ────────────────────────────────────────────────────────────
    void run();

    // ── GBM core ─────────────────────────────────────────────────────────────
    double gbm_step(double mid, double drift_term, double sigma_tick);
    std::vector<Level> generate_levels(double mid, int side,
                                       double vol_mult, double side_bias,
                                       double volume_factor,
                                       double dynamic_spread_frac);
    Book build_book(double mid, uint64_t tick,
                    double vol_mult,
                    double bid_bias, double ask_bias,
                    double volume_factor, double dyn_spread_frac);

    // ── I/O ──────────────────────────────────────────────────────────────────
    void publish_book(const Book& book);
    void place_orders(const Book& book, int n);

    // ── F1: Regime ────────────────────────────────────────────────────────────
    void update_regime();
    double regime_sigma_annual(Regime r) const;
    double regime_drift_annual(Regime r) const;
    std::pair<double, double> regime_bias(Regime r) const;

    // ── F2: GARCH ─────────────────────────────────────────────────────────────
    double compute_effective_sigma_tick(double reg_sigma_annual) const;
    void   update_realised_vol(double abs_log_ret);

    // ── F3: Anchoring ─────────────────────────────────────────────────────────
    void update_anchor(double mid, uint64_t tick);

    // ── F4: Imbalance lag ─────────────────────────────────────────────────────
    void   write_imbalance(double imbalance);
    double read_delayed_imbalance(int lag) const;

    // ── F6: Hidden drift OU ───────────────────────────────────────────────────
    void update_hidden_drift();

    // ── F9: Volume OU ─────────────────────────────────────────────────────────
    void update_volume_factor();

    // ── Redis ─────────────────────────────────────────────────────────────────
    bool connect_redis();
    void ensure_redis();

    // ── Utilities ─────────────────────────────────────────────────────────────
    static long long   now_ms();
    static std::string make_order_id();
};
