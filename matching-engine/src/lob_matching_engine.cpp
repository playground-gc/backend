#include "lob_matching_engine.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <iostream>
#include <thread>

// ─── Constructor ──────────────────────────────────────────────────────────────

LOBMatchingEngine::LOBMatchingEngine(
    size_t                       max_price_ticks,
    size_t                       max_entries_per_price,
    LFQueue<LOBOrder>*           lob_order_queue,
    LFQueue<LOBAcknowledgement>* lob_ack_queue,
    LFQueue<BroadcastElement>*   broadcast_queue,
    LFQueue<LogElement>*         logger_queue)
    : LobOrderQueue_         (lob_order_queue)
    , LobAckQueue_           (lob_ack_queue)
    , BroadcastQueue_        (broadcast_queue)
    , MatchingEngineLogger_  (logger_queue)
    , BuyOrderBook_          (max_price_ticks, max_entries_per_price)
    , SellOrderBook_         (max_price_ticks, max_entries_per_price)
{
    Queue_Wait_Time_                   .reserve(11000);
    Matching_Engine_Processing_Time_   .reserve(11000);
    Tick_To_Trade_Time_                .reserve(11000);
    Matching_Engine_Throughput_        .reserve(11000);
}

// ─── matchingEngineLoop ───────────────────────────────────────────────────────

void LOBMatchingEngine::matchingEngineLoop(std::atomic<bool>& start,
                                           std::atomic<bool>& terminate) noexcept {
    // Phase 1 — spin until start signal (keeps CPU hot at max frequency)
    while (!start.load(std::memory_order_acquire)) {
        if (terminate.load(std::memory_order_acquire)) return;
    }

    // Phase 2 — processing loop
    while (!terminate.load(std::memory_order_acquire)) {
        readOrder();
    }

    // Phase 3 — drain queues then print benchmarks
    std::this_thread::sleep_for(std::chrono::seconds(3));
    printBenchmarks();
}

// ─── readOrder ────────────────────────────────────────────────────────────────

void LOBMatchingEngine::readOrder() noexcept {
    LOBOrder* order = LobOrderQueue_->getNextRead();
    if (UNLIKELY(order == nullptr)) return;

    compiler_barrier();
    const uint64_t arrived_at_lob = now_cycles();
    compiler_barrier();

    // Throughput measurement (skip very first iteration)
    Queue_Wait_Time_.push_back(arrived_at_lob - order->out_cycle_count);
    if (LIKELY(last_read_cycle_ != 0))
        Matching_Engine_Throughput_.push_back(arrived_at_lob - last_read_cycle_);
    last_read_cycle_ = arrived_at_lob;

    // Log: order arrived at ME
    logEvent(3, arrived_at_lob, *order);

    const bool is_buy = (order->order_type == 'b');
    uint64_t done_at  = 0;

    switch (order->req_type) {
        case 'c': done_at = createOrderHandler(*order, is_buy); break;
        case 'u': done_at = updateHandler     (*order, is_buy); break;
        case 'd': done_at = deleteHandler     (*order, is_buy); break;
        default: break;
    }

    if (done_at == 0) {
        compiler_barrier();
        done_at = now_cycles();
        compiler_barrier();
    }

    Matching_Engine_Processing_Time_.push_back(done_at - arrived_at_lob);
    Tick_To_Trade_Time_             .push_back(done_at - order->arrived_cycle_count);

    LobOrderQueue_->updateRead();
}

// ─── createOrderHandler ───────────────────────────────────────────────────────

uint64_t LOBMatchingEngine::createOrderHandler(LOBOrder& order, bool is_buy) noexcept {
    // Aggressive matching first — may partially or fully fill the order
    aggressiveMatch(order, is_buy);

    // Add remainder to own book
    if (order.quantity > 0) {
        if (is_buy) BuyOrderBook_ .createOrder(order);
        else        SellOrderBook_.createOrder(order);

        const char side = is_buy ? 'B' : 'S';

        logEvent(5, now_cycles(), order);
        sendIncrementalChange(order.system_id, order.price, order.quantity, 'N', side);

        if (order.trader_id == 1)
            acknowledgeBackToOrderGateway(order.system_id, order.price,
                                          order.quantity, 'N', side);
    }

    compiler_barrier();
    uint64_t ts = now_cycles();
    compiler_barrier();
    return ts;
}

// ─── aggressiveMatch ─────────────────────────────────────────────────────────

void LOBMatchingEngine::aggressiveMatch(LOBOrder& order, bool is_buy) noexcept {
    if (is_buy) {
        // ── BUY order attacks the SELL book ───────────────────────────────────
        while (order.quantity > 0) {
            const size_t best_ask_idx = SellOrderBook_.getOptimumPriceIndex();
            const size_t bid_idx      = LimitedOrderBook<true>::priceIndex(order.price);

            if (bid_idx < best_ask_idx) break;   // spread not crossed

            std::vector<LOBOrder>& level = SellOrderBook_.getLevel(best_ask_idx);
            if (level.empty()) break;

            bool wash = false;
            for (auto& passive : level) {
                if (order.quantity == 0) break;
                if (UNLIKELY(passive.quantity == 0)) continue;   // tombstone

                // Self-trade prevention
                if (UNLIKELY(passive.trader_id == order.trader_id)) {
                    wash = true;
                    order.quantity = 0;
                    if (order.trader_id == 1)
                        acknowledgeBackToOrderGateway(order.system_id, order.price,
                                                      0, 'K', 'B');
                    break;
                }

                const int trade_qty = std::min(order.quantity, passive.quantity);
                const float trade_price = passive.price;

                order.quantity   -= trade_qty;
                passive.quantity -= trade_qty;

                logEvent(4, now_cycles(), order);

                if (order.trader_id == 1) {
                    acknowledgeBackToOrderGateway(order.system_id, trade_price,
                                                  trade_qty, 'T', 'B');
                    acknowledgeBackToOrderGateway(passive.system_id, trade_price,
                                                  trade_qty, 'T', 'S');
                }

                if (passive.quantity == 0)
                    SellOrderBook_.deleteOrder(passive.system_id);
            }
            if (wash) break;
        }
    } else {
        // ── SELL order attacks the BUY book ──────────────────────────────────
        while (order.quantity > 0) {
            const size_t best_bid_idx = BuyOrderBook_.getOptimumPriceIndex();
            const size_t ask_idx      = LimitedOrderBook<false>::priceIndex(order.price);

            if (ask_idx > best_bid_idx) break;   // spread not crossed

            std::vector<LOBOrder>& level = BuyOrderBook_.getLevel(best_bid_idx);
            if (level.empty()) break;

            bool wash = false;
            for (auto& passive : level) {
                if (order.quantity == 0) break;
                if (UNLIKELY(passive.quantity == 0)) continue;

                if (UNLIKELY(passive.trader_id == order.trader_id)) {
                    wash = true;
                    order.quantity = 0;
                    if (order.trader_id == 1)
                        acknowledgeBackToOrderGateway(order.system_id, order.price,
                                                      0, 'K', 'S');
                    break;
                }

                const int trade_qty = std::min(order.quantity, passive.quantity);
                const float trade_price = passive.price;

                order.quantity   -= trade_qty;
                passive.quantity -= trade_qty;

                logEvent(4, now_cycles(), order);

                if (order.trader_id == 1) {
                    acknowledgeBackToOrderGateway(order.system_id, trade_price,
                                                  trade_qty, 'T', 'S');
                    acknowledgeBackToOrderGateway(passive.system_id, trade_price,
                                                  trade_qty, 'T', 'B');
                }

                if (passive.quantity == 0)
                    BuyOrderBook_.deleteOrder(passive.system_id);
            }
            if (wash) break;
        }
    }
}

// ─── updateHandler ────────────────────────────────────────────────────────────

uint64_t LOBMatchingEngine::updateHandler(LOBOrder& order, bool is_buy) noexcept {
    LOBOrder* entry = is_buy
        ? BuyOrderBook_ .peekLOBEntry(order.system_id)
        : SellOrderBook_.peekLOBEntry(order.system_id);

    if (entry == nullptr) {
        compiler_barrier();
        uint64_t ts = now_cycles();
        compiler_barrier();
        return ts;
    }

    const bool price_change    = (entry->price    != order.price);
    const bool quantity_change = (entry->quantity != order.quantity);

    if (price_change) {
        // Delete old, then re-create at new price (triggers aggressive matching)
        LOBOrder old = *entry;
        deleteHandler(old, is_buy);
        createOrderHandler(order, is_buy);
    } else if (quantity_change) {
        if (is_buy) BuyOrderBook_ .updateOrderQuantity(order);
        else        SellOrderBook_.updateOrderQuantity(order);

        const char side = is_buy ? 'B' : 'S';
        logEvent(7, now_cycles(), order);
        sendIncrementalChange(order.system_id, order.price, order.quantity, 'U', side);

        if (order.trader_id == 1)
            acknowledgeBackToOrderGateway(order.system_id, order.price,
                                          order.quantity, 'U', side);
    }

    compiler_barrier();
    uint64_t ts = now_cycles();
    compiler_barrier();
    return ts;
}

// ─── deleteHandler ────────────────────────────────────────────────────────────

uint64_t LOBMatchingEngine::deleteHandler(LOBOrder& order, bool is_buy) noexcept {
    if (is_buy) BuyOrderBook_ .deleteOrder(order.system_id);
    else        SellOrderBook_.deleteOrder(order.system_id);

    const char side = is_buy ? 'B' : 'S';
    logEvent(6, now_cycles(), order);
    sendIncrementalChange(order.system_id, order.price, 0, 'D', side);

    if (order.trader_id == 1)
        acknowledgeBackToOrderGateway(order.system_id, order.price, 0, 'C', side);

    compiler_barrier();
    uint64_t ts = now_cycles();
    compiler_barrier();
    return ts;
}

// ─── acknowledgeBackToOrderGateway ────────────────────────────────────────────

void LOBMatchingEngine::acknowledgeBackToOrderGateway(int sys_id, float px,
                                                       int qty, char status,
                                                       char side) noexcept {
    LOBAcknowledgement ack{sys_id, px, qty, side, status};

    LOBAcknowledgement* slot = LobAckQueue_->getNextWrite();
    if (UNLIKELY(slot == nullptr))
        slot = LobAckQueue_->getNextWrite();  // one retry
    if (UNLIKELY(slot == nullptr)) return;   // still full — drop

    *slot = ack;
    LobAckQueue_->updateWrite();
}

// ─── sendIncrementalChange ────────────────────────────────────────────────────

void LOBMatchingEngine::sendIncrementalChange(int sys_id, float px, int qty,
                                               char type, char side) noexcept {
    BroadcastElement be{sys_id, px, qty, side, type};

    BroadcastElement* slot = BroadcastQueue_->getNextWrite();
    if (UNLIKELY(slot == nullptr))
        slot = BroadcastQueue_->getNextWrite();
    if (UNLIKELY(slot == nullptr)) return;

    *slot = be;
    BroadcastQueue_->updateWrite();

    logEvent(11, now_cycles(), be);
}

// ─── logEvent (LOBOrder) ─────────────────────────────────────────────────────

void LOBMatchingEngine::logEvent(int id, uint64_t ts,
                                  const LOBOrder& order) noexcept {
    LogElement* slot = MatchingEngineLogger_->getNextWrite();
    if (UNLIKELY(slot == nullptr)) return;  // logger queue full — drop log
    slot->log_identifier = id;
    slot->time_stamp     = ts;
    slot->logData        = order;
    MatchingEngineLogger_->updateWrite();
}

// ─── logEvent (BroadcastElement) ─────────────────────────────────────────────

void LOBMatchingEngine::logEvent(int id, uint64_t ts,
                                  const BroadcastElement& be) noexcept {
    LogElement* slot = MatchingEngineLogger_->getNextWrite();
    if (UNLIKELY(slot == nullptr)) return;
    slot->log_identifier = id;
    slot->time_stamp     = ts;
    slot->logData        = be;
    MatchingEngineLogger_->updateWrite();
}

// ─── printBenchmarks ─────────────────────────────────────────────────────────

void LOBMatchingEngine::printBenchmarks() const {
    // Calibrate cycles-per-nanosecond by spinning for 50ms
    auto wall0 = std::chrono::steady_clock::now();
    compiler_barrier();
    uint64_t cyc0 = now_cycles();
    compiler_barrier();

    volatile uint64_t spin = 0;
    while (std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now() - wall0).count() < 50)
        ++spin;

    compiler_barrier();
    uint64_t cyc1 = now_cycles();
    compiler_barrier();
    auto wall1 = std::chrono::steady_clock::now();

    const double elapsed_ns =
        static_cast<double>(std::chrono::duration_cast<std::chrono::nanoseconds>(
                                wall1 - wall0).count());
    const double cyc_per_ns = static_cast<double>(cyc1 - cyc0) / elapsed_ns;

    auto print_percentiles = [&](const char* name,
                                 std::vector<uint64_t> v) {
        if (v.empty()) { std::cout << name << ": no data\n"; return; }
        std::sort(v.begin(), v.end());
        auto pct = [&](double p) -> uint64_t {
            size_t i = static_cast<size_t>(p * static_cast<double>(v.size() - 1));
            return v[i];
        };
        auto ns = [&](uint64_t c) -> double {
            return static_cast<double>(c) / cyc_per_ns;
        };
        std::cout << name
                  << "  p50=" << pct(0.50) << "cy (" << ns(pct(0.50)) << "ns)"
                  << "  p75=" << pct(0.75) << "cy (" << ns(pct(0.75)) << "ns)"
                  << "  p90=" << pct(0.90) << "cy (" << ns(pct(0.90)) << "ns)"
                  << "  p99=" << pct(0.99) << "cy (" << ns(pct(0.99)) << "ns)\n";
    };

    std::cout << "\n=== LOB Matching Engine Benchmarks ===\n";
    print_percentiles("[Queue Wait Time]            ", Queue_Wait_Time_);
    print_percentiles("[ME Processing Time]         ", Matching_Engine_Processing_Time_);
    print_percentiles("[Tick-To-Trade Time]         ", Tick_To_Trade_Time_);
    print_percentiles("[ME Throughput (inter-order)]", Matching_Engine_Throughput_);
    std::cout << "=======================================\n";
}
