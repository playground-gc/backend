#pragma once

#include <cstdint>
#include <variant>

// ─── LOBOrder ─────────────────────────────────────────────────────────────────
// 32 bytes, cache-line friendly. Internal order representation.

struct LOBOrder {
    // 8 bytes
    uint64_t arrived_cycle_count;   // TSC stamp when order arrived at system boundary

    // 8 bytes
    int   system_id;                // unique system-assigned integer ID
    float price;                    // order price; index = static_cast<size_t>(price * 10)

    // 8 bytes
    int       quantity;             // order quantity
    short int trader_id;            // trader identifier, 0-based
    char      order_type;           // 'b' = buy, 's' = sell
    char      req_type;             // 'c' = create, 'u' = update, 'd' = delete

    // 8 bytes
    uint64_t out_cycle_count;       // TSC stamp when pushed into the input queue
};
static_assert(sizeof(LOBOrder) == 32, "LOBOrder must be exactly 32 bytes");

// ─── LOBAcknowledgement ───────────────────────────────────────────────────────
// Private confirmation routed back to the originating trader.
//
// status codes:
//   'N' = New Order Accepted  (qty = initial size)
//   'U' = Update Accepted     (qty = new balance)
//   'C' = Cancel Accepted     (qty = 0)
//   'T' = Trade / Fill        (qty = executed amount)
//   'R' = Rejected            (qty = 0)
//   'K' = Killed (wash trade) (qty = 0)

struct LOBAcknowledgement {
    int   system_id;
    float price;
    int   quantity;
    char  side;    // 'B' = buy, 'S' = sell
    char  status;
};

// ─── BroadcastElement ────────────────────────────────────────────────────────
// Incremental public market-data update.
//
// type codes:
//   'N' = new order added to book
//   'U' = order quantity updated
//   'D' = order deleted / cancelled
//   'T' = trade executed

struct BroadcastElement {
    int   system_id;
    float price;
    int   quantity;
    char  side;   // 'B' or 'S'
    char  type;
};

// ─── Placeholder types used only as log-variant arms ─────────────────────────
// UserOrder and UserAcknowledgement belong to the order-gateway layer;
// the matching engine only needs them to instantiate the variant type.

struct UserOrder         {};
struct UserAcknowledgement {};

// ─── LogElement ──────────────────────────────────────────────────────────────
// Event record written to the background logger queue.
//
// log_identifier values used by the matching engine:
//   3  = order arrived at ME          (logData = LOBOrder)
//   4  = order aggressive matched     (logData = LOBOrder)
//   5  = order created in LOB         (logData = LOBOrder)
//   6  = order deleted from LOB       (logData = LOBOrder)
//   7  = order quantity updated       (logData = LOBOrder)
//  11  = incremental broadcast sent   (logData = BroadcastElement)

struct LogElement {
    int      log_identifier;
    uint64_t time_stamp;
    std::variant<BroadcastElement, LOBOrder, UserOrder,
                 LOBAcknowledgement, UserAcknowledgement> logData;
};
