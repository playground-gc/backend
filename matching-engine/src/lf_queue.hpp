#pragma once

#include <atomic>
#include <vector>
#include <cstddef>

// ─── Lock-free single-producer single-consumer ring buffer ────────────────────
// Fixed-size, power-of-two capacity. One slot is always reserved to distinguish
// full from empty. Uses lazy caching of the remote index to minimise
// cross-core cache-line bouncing.

template <typename T>
class LFQueue {
public:
    explicit LFQueue(size_t requested_capacity) {
        // Internal capacity = next power-of-two of (requested * 5) + 1 spare slot
        size_t n = requested_capacity * 5;
        size_t cap = 1;
        while (cap <= n) cap <<= 1;   // round up to next power of 2
        capacity_mask_ = cap - 1;
        store_.resize(cap);
    }

    // ── Writer side ───────────────────────────────────────────────────────────

    // Returns pointer to the next writable slot, or nullptr if the queue is full.
    T* getNextWrite() noexcept {
        const size_t write = next_index_to_write_.load(std::memory_order_relaxed);
        const size_t next  = (write + 1) & capacity_mask_;

        if (next == lazy_read_) {
            // Cache says full — refresh from actual read index
            lazy_read_ = next_index_to_read_.load(std::memory_order_acquire);
            if (next == lazy_read_) return nullptr;   // still full
        }
        return &store_[write];
    }

    // Advances the write index. Call AFTER writing to the slot returned by getNextWrite().
    void updateWrite() noexcept {
        const size_t write = next_index_to_write_.load(std::memory_order_relaxed);
        next_index_to_write_.store((write + 1) & capacity_mask_,
                                   std::memory_order_release);
    }

    // ── Reader side ───────────────────────────────────────────────────────────

    // Returns pointer to the next readable slot, or nullptr if the queue is empty.
    T* getNextRead() noexcept {
        const size_t read = next_index_to_read_.load(std::memory_order_relaxed);

        if (read == lazy_write_) {
            // Cache says empty — refresh from actual write index
            lazy_write_ = next_index_to_write_.load(std::memory_order_acquire);
            if (read == lazy_write_) return nullptr;  // still empty
        }
        return &store_[read];
    }

    // Advances the read index. Call AFTER consuming the slot returned by getNextRead().
    void updateRead() noexcept {
        const size_t read = next_index_to_read_.load(std::memory_order_relaxed);
        next_index_to_read_.store((read + 1) & capacity_mask_,
                                  std::memory_order_release);
    }

private:
    size_t capacity_mask_ = 0;
    std::vector<T> store_;

    alignas(64) std::atomic<size_t> next_index_to_read_{0};
    alignas(64) size_t              lazy_write_{0};
    alignas(64) std::atomic<size_t> next_index_to_write_{0};
    alignas(64) size_t              lazy_read_{0};
};
