#pragma once

#include "lf_queue.hpp"
#include "limited_order_book.hpp"
#include "lob_types.hpp"

#include <atomic>
#include <cstdint>
#include <vector>

// ─── Cycle-accurate timestamp ─────────────────────────────────────────────────
#include <x86intrin.h>

inline uint64_t now_cycles() noexcept {
    unsigned int aux;
    _mm_lfence();
    uint64_t ts = __rdtscp(&aux);
    _mm_lfence();
    return ts;
}

// Compiler barrier: prevents reordering of now_cycles() calls across measured work.
#define compiler_barrier() asm volatile("" ::: "memory")

#ifndef LIKELY
#define LIKELY(x)   __builtin_expect(!!(x), 1)
#define UNLIKELY(x) __builtin_expect(!!(x), 0)
#endif

// ─── LOBMatchingEngine ────────────────────────────────────────────────────────
// Price/time priority limit order book matching engine.
// Runs on a single dedicated CPU core in a tight busy-wait loop.
// All communication is through lock-free SPSC ring buffers (LFQueue).

class LOBMatchingEngine {
public:
    LOBMatchingEngine(
        size_t                        max_price_ticks,
        size_t                        max_entries_per_price,
        LFQueue<LOBOrder>*            lob_order_queue,
        LFQueue<LOBAcknowledgement>*  lob_ack_queue,
        LFQueue<BroadcastElement>*    broadcast_queue,
        LFQueue<LogElement>*          logger_queue
    );

    // Entry point — designed to run on a pinned thread.
    // Busy-spins on 'start' then processes orders until 'terminate'.
    void matchingEngineLoop(std::atomic<bool>& start,
                            std::atomic<bool>& terminate) noexcept;

private:
    // ── Queues ────────────────────────────────────────────────────────────────
    LFQueue<LOBOrder>*           LobOrderQueue_;
    LFQueue<LOBAcknowledgement>* LobAckQueue_;
    LFQueue<BroadcastElement>*   BroadcastQueue_;
    LFQueue<LogElement>*         MatchingEngineLogger_;

    // ── Order books ───────────────────────────────────────────────────────────
    LimitedOrderBook<true>  BuyOrderBook_;
    LimitedOrderBook<false> SellOrderBook_;

    // ── Benchmark vectors (pre-reserved) ──────────────────────────────────────
    std::vector<uint64_t> Queue_Wait_Time_;
    std::vector<uint64_t> Matching_Engine_Processing_Time_;
    std::vector<uint64_t> Tick_To_Trade_Time_;
    std::vector<uint64_t> Matching_Engine_Throughput_;
    uint64_t last_read_cycle_ = 0;

    // ── Core loop ─────────────────────────────────────────────────────────────
    void readOrder() noexcept;

    // ── Handlers ──────────────────────────────────────────────────────────────
    uint64_t createOrderHandler(LOBOrder& order, bool is_buy) noexcept;
    uint64_t updateHandler     (LOBOrder& order, bool is_buy) noexcept;
    uint64_t deleteHandler     (LOBOrder& order, bool is_buy) noexcept;

    // Aggressive matching — may sweep multiple price levels.
    void aggressiveMatch(LOBOrder& order, bool is_buy) noexcept;

    // ── Output helpers ────────────────────────────────────────────────────────
    void acknowledgeBackToOrderGateway(int sys_id, float px, int qty,
                                       char status, char side) noexcept;
    void sendIncrementalChange(int sys_id, float px, int qty,
                               char type, char side) noexcept;
    void logEvent(int identifier, uint64_t ts, const LOBOrder& order) noexcept;
    void logEvent(int identifier, uint64_t ts, const BroadcastElement& be) noexcept;

    // ── Benchmarks ────────────────────────────────────────────────────────────
    void printBenchmarks() const;
};
