#pragma once

#include <string>

// ─── StopOrder ────────────────────────────────────────────────────────────────
// Represents a stop order loaded from PostgreSQL or received via Redis.

struct StopOrder {
    std::string order_id;
    std::string user_id;
    std::string symbol;
    std::string side;        // "buy"  | "sell"
    std::string type;        // "stop_limit" | "stop_market"
    double      stop_price  = 0.0;
    double      limit_price = 0.0;   // 0 for stop_market
    double      quantity    = 0.0;
    long long   expires_at_ms = 0;   // unix ms; 0 = never expires
};

// ─── Heap comparators ─────────────────────────────────────────────────────────

// Stop-buy min-heap: lowest stop_price pops first (triggers when price >= stop_price)
struct StopBuyCmp {
    bool operator()(const StopOrder& a, const StopOrder& b) const {
        return a.stop_price > b.stop_price;
    }
};

// Stop-sell max-heap: highest stop_price pops first (triggers when price <= stop_price)
struct StopSellCmp {
    bool operator()(const StopOrder& a, const StopOrder& b) const {
        return a.stop_price < b.stop_price;
    }
};
