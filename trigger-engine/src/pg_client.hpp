#pragma once

#include "stop_order.hpp"

#include <string>
#include <vector>

// Forward declare libpq connection type
struct pg_conn;
typedef struct pg_conn PGconn;

// ─── PgClient ─────────────────────────────────────────────────────────────────
// Synchronous libpq wrapper for trigger engine DB operations.
// All methods are blocking and safe to call from a single thread.

class PgClient {
public:
    explicit PgClient(const std::string& conn_str);
    ~PgClient();

    // Connect; throws std::runtime_error on failure
    void connect();

    // Load all orders with status='pending_trigger' from the database
    std::vector<StopOrder> load_pending_orders();

    // Load order_ids of expired pending_trigger orders (expires_at < NOW())
    std::vector<std::string> load_expired_order_ids();

    // UPDATE orders SET status='triggered' WHERE id=$1
    void mark_triggered(const std::string& order_id);

    // UPDATE orders SET status='cancelled' WHERE id=$1
    void mark_cancelled(const std::string& order_id);

private:
    std::string conn_str_;
    PGconn*     conn_ = nullptr;

    void ensure_connected();
    void exec_status(const std::string& order_id, const std::string& status);

    // Parse ISO-8601 timestamp string from PostgreSQL into unix milliseconds
    static long long parse_expires_at(const char* ts_str);
};
