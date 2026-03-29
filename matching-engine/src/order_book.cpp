#include "order_book.hpp"

#include <algorithm>
#include <chrono>
#include <iostream>
#include <stdexcept>

static long long now_ms() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

// ─── Helpers to generate UUIDs (simple timestamp+counter version) ─────────────
#include <atomic>
#include <sstream>
#include <iomanip>
static std::string make_trade_id() {
    static std::atomic<uint64_t> counter{0};
    std::ostringstream oss;
    oss << "T-" << now_ms() << "-" << counter.fetch_add(1);
    return oss.str();
}

// ─── Constructor ─────────────────────────────────────────────────────────────

OrderBook::OrderBook(const std::string& symbol) : symbol_(symbol) {}

// ─── place_order ─────────────────────────────────────────────────────────────

std::vector<Trade> OrderBook::place_order(Order order) {
    std::unique_lock<std::mutex> lock(mtx_);

    std::vector<Trade> trades;
    if (order.type == Order::Type::MARKET) {
        trades = match_market_order(order);
    } else {
        trades = match_limit_order(order);
        // If not fully filled, rest on the book
        if (order.status != Order::Status::FILLED &&
            order.status != Order::Status::CANCELLED) {
            if (order.side == Order::Side::BUY) {
                bids_[order.price].push(order);
                order_index_[order.id] = {"buy", order.price};
            } else {
                asks_[order.price].push(order);
                order_index_[order.id] = {"sell", order.price};
            }
        }
    }
    return trades;
}

// ─── cancel_order ────────────────────────────────────────────────────────────

bool OrderBook::cancel_order(const std::string& order_id) {
    std::unique_lock<std::mutex> lock(mtx_);

    auto it = order_index_.find(order_id);
    if (it == order_index_.end()) return false;

    const std::string& side = it->second.side;
    double price = it->second.price;

    auto cancel_from_queue = [&](auto& book) -> bool {
        auto level_it = book.find(price);
        if (level_it == book.end()) return false;

        std::queue<Order>& q = level_it->second;
        std::queue<Order> new_q;
        bool found = false;
        while (!q.empty()) {
            Order o = std::move(q.front());
            q.pop();
            if (o.id == order_id) {
                found = true;
            } else {
                new_q.push(std::move(o));
            }
        }
        if (new_q.empty()) {
            book.erase(level_it);
        } else {
            level_it->second = std::move(new_q);
        }
        return found;
    };

    bool removed = false;
    if (side == "buy") {
        removed = cancel_from_queue(bids_);
    } else {
        removed = cancel_from_queue(asks_);
    }

    if (removed) {
        order_index_.erase(it);
    }
    return removed;
}

// ─── snapshot ────────────────────────────────────────────────────────────────

std::pair<std::vector<std::pair<double, double>>,
          std::vector<std::pair<double, double>>>
OrderBook::snapshot(int depth) const {
    std::unique_lock<std::mutex> lock(mtx_);

    std::vector<std::pair<double, double>> bids_out, asks_out;

    int count = 0;
    for (auto& [price, q] : bids_) {
        if (count++ >= depth) break;
        double total_qty = 0.0;
        // Sum quantities in queue (non-destructive)
        std::queue<Order> tmp = q;
        while (!tmp.empty()) {
            total_qty += tmp.front().quantity - tmp.front().filled_qty;
            tmp.pop();
        }
        if (total_qty > 0) bids_out.push_back({price, total_qty});
    }

    count = 0;
    for (auto& [price, q] : asks_) {
        if (count++ >= depth) break;
        double total_qty = 0.0;
        std::queue<Order> tmp = q;
        while (!tmp.empty()) {
            total_qty += tmp.front().quantity - tmp.front().filled_qty;
            tmp.pop();
        }
        if (total_qty > 0) asks_out.push_back({price, total_qty});
    }

    return {bids_out, asks_out};
}

// ─── match_limit_order ───────────────────────────────────────────────────────

std::vector<Trade> OrderBook::match_limit_order(Order& aggressor) {
    std::vector<Trade> trades;
    double remaining = aggressor.quantity - aggressor.filled_qty;

    if (aggressor.side == Order::Side::BUY) {
        // Match against asks: lowest ask first, while ask_price <= aggressor.price
        for (auto ask_it = asks_.begin();
             ask_it != asks_.end() && remaining > 0.0 &&
             ask_it->first <= aggressor.price;) {

            std::queue<Order>& q = ask_it->second;
            while (!q.empty() && remaining > 0.0) {
                Order& resting = q.front();
                double resting_avail = resting.quantity - resting.filled_qty;
                double exec_qty = std::min(remaining, resting_avail);

                Trade t = make_trade(resting, aggressor, ask_it->first, exec_qty);
                trades.push_back(t);

                resting.filled_qty += exec_qty;
                aggressor.filled_qty += exec_qty;
                remaining -= exec_qty;

                if (resting.filled_qty >= resting.quantity) {
                    order_index_.erase(resting.id);
                    q.pop();
                } else {
                    resting.status = Order::Status::PARTIAL;
                }
            }

            if (q.empty()) {
                ask_it = asks_.erase(ask_it);
            } else {
                ++ask_it;
            }
        }
    } else {
        // SELL: match against bids: highest bid first, while bid_price >= aggressor.price
        for (auto bid_it = bids_.begin();
             bid_it != bids_.end() && remaining > 0.0 &&
             bid_it->first >= aggressor.price;) {

            std::queue<Order>& q = bid_it->second;
            while (!q.empty() && remaining > 0.0) {
                Order& resting = q.front();
                double resting_avail = resting.quantity - resting.filled_qty;
                double exec_qty = std::min(remaining, resting_avail);

                Trade t = make_trade(resting, aggressor, bid_it->first, exec_qty);
                trades.push_back(t);

                resting.filled_qty += exec_qty;
                aggressor.filled_qty += exec_qty;
                remaining -= exec_qty;

                if (resting.filled_qty >= resting.quantity) {
                    order_index_.erase(resting.id);
                    q.pop();
                } else {
                    resting.status = Order::Status::PARTIAL;
                }
            }

            if (q.empty()) {
                bid_it = bids_.erase(bid_it);
            } else {
                ++bid_it;
            }
        }
    }

    if (aggressor.filled_qty >= aggressor.quantity) {
        aggressor.status = Order::Status::FILLED;
    } else if (aggressor.filled_qty > 0) {
        aggressor.status = Order::Status::PARTIAL;
    }

    return trades;
}

// ─── match_market_order ──────────────────────────────────────────────────────

std::vector<Trade> OrderBook::match_market_order(Order& aggressor) {
    std::vector<Trade> trades;
    double remaining = aggressor.quantity;

    if (aggressor.side == Order::Side::BUY) {
        for (auto ask_it = asks_.begin();
             ask_it != asks_.end() && remaining > 0.0;) {

            std::queue<Order>& q = ask_it->second;
            while (!q.empty() && remaining > 0.0) {
                Order& resting = q.front();
                double resting_avail = resting.quantity - resting.filled_qty;
                double exec_qty = std::min(remaining, resting_avail);

                Trade t = make_trade(resting, aggressor, ask_it->first, exec_qty);
                trades.push_back(t);

                resting.filled_qty += exec_qty;
                aggressor.filled_qty += exec_qty;
                remaining -= exec_qty;

                if (resting.filled_qty >= resting.quantity) {
                    order_index_.erase(resting.id);
                    q.pop();
                } else {
                    resting.status = Order::Status::PARTIAL;
                }
            }

            if (q.empty()) {
                ask_it = asks_.erase(ask_it);
            } else {
                ++ask_it;
            }
        }
    } else {
        for (auto bid_it = bids_.begin();
             bid_it != bids_.end() && remaining > 0.0;) {

            std::queue<Order>& q = bid_it->second;
            while (!q.empty() && remaining > 0.0) {
                Order& resting = q.front();
                double resting_avail = resting.quantity - resting.filled_qty;
                double exec_qty = std::min(remaining, resting_avail);

                Trade t = make_trade(resting, aggressor, bid_it->first, exec_qty);
                trades.push_back(t);

                resting.filled_qty += exec_qty;
                aggressor.filled_qty += exec_qty;
                remaining -= exec_qty;

                if (resting.filled_qty >= resting.quantity) {
                    order_index_.erase(resting.id);
                    q.pop();
                } else {
                    resting.status = Order::Status::PARTIAL;
                }
            }

            if (q.empty()) {
                bid_it = bids_.erase(bid_it);
            } else {
                ++bid_it;
            }
        }
    }

    aggressor.status = (aggressor.filled_qty >= aggressor.quantity)
                           ? Order::Status::FILLED
                           : Order::Status::PARTIAL;
    return trades;
}

// ─── make_trade ──────────────────────────────────────────────────────────────

Trade OrderBook::make_trade(Order& resting, Order& aggressor,
                            double exec_price, double exec_qty) {
    Trade t;
    t.trade_id = make_trade_id();
    t.symbol   = symbol_;
    t.price    = exec_price;
    t.quantity = exec_qty;
    t.timestamp = now_ms();

    if (aggressor.side == Order::Side::BUY) {
        t.buy_order_id  = aggressor.id;
        t.sell_order_id = resting.id;
        t.buyer_id      = aggressor.user_id;
        t.seller_id     = resting.user_id;
    } else {
        t.buy_order_id  = resting.id;
        t.sell_order_id = aggressor.id;
        t.buyer_id      = resting.user_id;
        t.seller_id     = aggressor.user_id;
    }
    return t;
}
