#pragma once

#include "lob_types.hpp"

#include <cstddef>
#include <vector>

#ifndef LIKELY
#define LIKELY(x)   __builtin_expect(!!(x), 1)
#define UNLIKELY(x) __builtin_expect(!!(x), 0)
#endif

// ─── LimitedOrderBook<IsBuy> ──────────────────────────────────────────────────
// Array-indexed, price/time priority order book.
//
// Price → index conversion:  idx = static_cast<size_t>(price * 10)
// This gives O(1) access with $0.10 tick granularity.
//
// IsBuy == true  → bid book;  optimum_price = highest occupied bid index
// IsBuy == false → ask book;  optimum_price = lowest  occupied ask index
//
// Lazy deletion: cancelled/fully-filled orders have quantity set to 0
// (tombstone) without being erased from the vector. This avoids expensive
// index invalidation. Tombstones are skipped during matching.

template <bool IsBuy>
class LimitedOrderBook {
public:
    LimitedOrderBook(size_t max_price_ticks, size_t max_entries_per_price)
        : max_price_limit_(max_price_ticks) {
        store_.resize(max_price_ticks + 1);
        for (auto& row : store_)
            row.reserve(max_entries_per_price);

        active_counts_.resize(max_price_ticks + 1, 0);

        // LUT supports up to 10 million unique system IDs
        LUT_.resize(10'000'000, {-1, -1});

        if constexpr (IsBuy) optimum_price_ = 0;
        else                 optimum_price_ = max_price_ticks;
    }

    // ── createOrder ──────────────────────────────────────────────────────────
    void createOrder(LOBOrder& order) noexcept {
        const size_t idx = priceIndex(order.price);

        // Update best-price pointer
        if constexpr (IsBuy) {
            if (idx > optimum_price_) optimum_price_ = idx;
        } else {
            if (idx < optimum_price_) optimum_price_ = idx;
        }

        store_[idx].push_back(order);
        LUT_[order.system_id] = {static_cast<int>(idx),
                                 static_cast<int>(store_[idx].size() - 1)};
        ++active_counts_[idx];
    }

    // ── deleteOrder ──────────────────────────────────────────────────────────
    // Lazy deletion: tombstones the entry (qty = 0), updates LUT, decrements
    // active count, and glides the optimum pointer if the best level just emptied.
    void deleteOrder(int system_id) noexcept {
        auto& [price_row, order_col] = LUT_[system_id];
        if (LIKELY(price_row != -1)) {
            store_[price_row][order_col].quantity = 0;
            LUT_[system_id] = {-1, -1};
            --active_counts_[price_row];

            if (UNLIKELY(active_counts_[price_row] == 0 &&
                         static_cast<size_t>(price_row) == optimum_price_)) {
                glideOptimum();
            }
        }
    }

    // ── updateOrderQuantity ───────────────────────────────────────────────────
    // Quantity decrease → in-place (keeps time priority).
    // Quantity increase → tombstone old, push_back new (loses time priority).
    void updateOrderQuantity(LOBOrder& data) noexcept {
        auto& [price_row, order_col] = LUT_[data.system_id];
        LOBOrder& entry = store_[price_row][order_col];

        if (data.quantity < entry.quantity) {
            entry.quantity = data.quantity;
        } else {
            // Increase → lose time priority
            entry.quantity = 0;    // tombstone old
            store_[price_row].push_back(data);
            LUT_[data.system_id] = {price_row,
                                    static_cast<int>(store_[price_row].size() - 1)};
        }
    }

    // ── peekLOBEntry ─────────────────────────────────────────────────────────
    // Returns in-place pointer for the update handler to read current state.
    // Returns nullptr if the system_id is not in the book.
    LOBOrder* peekLOBEntry(int system_id) noexcept {
        auto& [price_row, order_col] = LUT_[system_id];
        if (price_row == -1) return nullptr;
        return &store_[price_row][order_col];
    }

    // ── getLevel ─────────────────────────────────────────────────────────────
    // Returns a reference to the FIFO queue at the given price index.
    std::vector<LOBOrder>& getLevel(size_t price_index) noexcept {
        if (UNLIKELY(price_index > max_price_limit_))
            return empty_level_;
        return store_[price_index];
    }

    // ── getOptimumPriceIndex ──────────────────────────────────────────────────
    size_t getOptimumPriceIndex() const noexcept {
        return optimum_price_;
    }

    // ── static price-index helper ─────────────────────────────────────────────
    static size_t priceIndex(float price) noexcept {
        return static_cast<size_t>(price * 10.0f);
    }

private:
    // ── glideOptimum ─────────────────────────────────────────────────────────
    // Called only when the current best level just became empty after a delete.
    void glideOptimum() noexcept {
        if constexpr (IsBuy) {
            while (optimum_price_ > 0 &&
                   active_counts_[optimum_price_] == 0)
                --optimum_price_;
        } else {
            while (optimum_price_ < max_price_limit_ &&
                   active_counts_[optimum_price_] == 0)
                ++optimum_price_;
        }
    }

    size_t optimum_price_;
    std::vector<std::vector<LOBOrder>> store_;      // store_[price_idx] = FIFO queue
    std::vector<std::pair<int,int>>    LUT_;        // LUT_[system_id] = {price_row, col}
    std::vector<int>                   active_counts_;
    std::vector<LOBOrder>              empty_level_;
    size_t                             max_price_limit_;
};
