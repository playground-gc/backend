#include "pg_client.hpp"

#include <libpq-fe.h>

#include <chrono>
#include <cstring>
#include <ctime>
#include <iostream>
#include <stdexcept>
#include <sstream>

// ─── Constructor / Destructor ─────────────────────────────────────────────────

PgClient::PgClient(const std::string& conn_str)
    : conn_str_(conn_str) {}

PgClient::~PgClient() {
    if (conn_) {
        PQfinish(conn_);
        conn_ = nullptr;
    }
}

// ─── connect ──────────────────────────────────────────────────────────────────

void PgClient::connect() {
    if (conn_) PQfinish(conn_);
    conn_ = PQconnectdb(conn_str_.c_str());
    if (!conn_) {
        throw std::runtime_error("[PgClient] PQconnectdb returned NULL (out of memory)");
    }
    if (PQstatus(conn_) != CONNECTION_OK) {
        std::string err = PQerrorMessage(conn_);
        PQfinish(conn_);
        conn_ = nullptr;
        throw std::runtime_error("[PgClient] Connection failed: " + err);
    }
    std::cout << "[PgClient] Connected to PostgreSQL\n";
}

// ─── ensure_connected ─────────────────────────────────────────────────────────

void PgClient::ensure_connected() {
    if (!conn_ || PQstatus(conn_) != CONNECTION_OK) {
        std::cout << "[PgClient] Reconnecting...\n";
        connect();
    }
}

// ─── parse_expires_at ─────────────────────────────────────────────────────────
// Parses PostgreSQL TIMESTAMPTZ output (e.g. "2026-04-27 12:00:00+00") into
// unix milliseconds. Returns 0 if ts_str is NULL or cannot be parsed.

long long PgClient::parse_expires_at(const char* ts_str) {
    if (!ts_str || ts_str[0] == '\0') return 0;

    struct tm t{};
    // PostgreSQL outputs format: "2026-04-27 12:00:00+00"
    // strptime with %Y-%m-%d %H:%M:%S
    char* end = strptime(ts_str, "%Y-%m-%d %H:%M:%S", &t);
    if (!end) return 0;

    // timegm treats tm as UTC
    time_t epoch = timegm(&t);
    if (epoch == (time_t)-1) return 0;
    return static_cast<long long>(epoch) * 1000LL;
}

// ─── load_pending_orders ──────────────────────────────────────────────────────

std::vector<StopOrder> PgClient::load_pending_orders() {
    ensure_connected();

    const char* sql =
        "SELECT id, user_id, symbol, side, order_type, "
        "       stop_price, limit_price, quantity, expires_at "
        "FROM orders "
        "WHERE status = 'pending_trigger' "
        "ORDER BY created_at ASC";

    PGresult* res = PQexec(conn_, sql);
    if (PQresultStatus(res) != PGRES_TUPLES_OK) {
        std::string err = PQresultErrorMessage(res);
        PQclear(res);
        throw std::runtime_error("[PgClient] load_pending_orders failed: " + err);
    }

    std::vector<StopOrder> orders;
    int rows = PQntuples(res);

    // Column indices
    int col_id          = PQfnumber(res, "id");
    int col_user_id     = PQfnumber(res, "user_id");
    int col_symbol      = PQfnumber(res, "symbol");
    int col_side        = PQfnumber(res, "side");
    int col_type        = PQfnumber(res, "order_type");
    int col_stop_price  = PQfnumber(res, "stop_price");
    int col_limit_price = PQfnumber(res, "limit_price");
    int col_quantity    = PQfnumber(res, "quantity");
    int col_expires_at  = PQfnumber(res, "expires_at");

    for (int i = 0; i < rows; ++i) {
        StopOrder o;
        o.order_id    = PQgetvalue(res, i, col_id);
        o.user_id     = PQgetvalue(res, i, col_user_id);
        o.symbol      = PQgetvalue(res, i, col_symbol);
        o.side        = PQgetvalue(res, i, col_side);
        o.type        = PQgetvalue(res, i, col_type);
        try {
            o.stop_price  = PQgetisnull(res, i, col_stop_price)  ? 0.0 : std::stod(PQgetvalue(res, i, col_stop_price));
            o.limit_price = PQgetisnull(res, i, col_limit_price) ? 0.0 : std::stod(PQgetvalue(res, i, col_limit_price));
            o.quantity    = std::stod(PQgetvalue(res, i, col_quantity));
        } catch (const std::exception& ex) {
            std::cerr << "[PgClient] Failed to parse numeric fields for order "
                      << o.order_id << ": " << ex.what() << " – skipping\n";
            continue;
        }
        o.expires_at_ms = PQgetisnull(res, i, col_expires_at)
                          ? 0LL
                          : parse_expires_at(PQgetvalue(res, i, col_expires_at));
        orders.push_back(std::move(o));
    }

    PQclear(res);
    std::cout << "[PgClient] Loaded " << orders.size() << " pending_trigger orders\n";
    return orders;
}

// ─── load_expired_order_ids ───────────────────────────────────────────────────

std::vector<std::string> PgClient::load_expired_order_ids() {
    ensure_connected();

    const char* sql =
        "SELECT id FROM orders "
        "WHERE status = 'pending_trigger' "
        "  AND expires_at IS NOT NULL "
        "  AND expires_at < NOW()";

    PGresult* res = PQexec(conn_, sql);
    if (PQresultStatus(res) != PGRES_TUPLES_OK) {
        std::string err = PQresultErrorMessage(res);
        PQclear(res);
        std::cerr << "[PgClient] load_expired_order_ids failed: " << err << "\n";
        return {};
    }

    std::vector<std::string> ids;
    int rows = PQntuples(res);
    for (int i = 0; i < rows; ++i) {
        ids.emplace_back(PQgetvalue(res, i, 0));
    }
    PQclear(res);
    return ids;
}

// ─── exec_status ─────────────────────────────────────────────────────────────

void PgClient::exec_status(const std::string& order_id, const std::string& status) {
    ensure_connected();

    const char* sql =
        "UPDATE orders SET status=$1 WHERE id=$2";
    const char* params[2] = { status.c_str(), order_id.c_str() };

    PGresult* res = PQexecParams(conn_, sql, 2, nullptr, params, nullptr, nullptr, 0);
    if (PQresultStatus(res) != PGRES_COMMAND_OK) {
        std::cerr << "[PgClient] Status update failed for " << order_id
                  << ": " << PQresultErrorMessage(res) << "\n";
    }
    PQclear(res);
}

void PgClient::mark_triggered(const std::string& order_id) {
    exec_status(order_id, "triggered");
}

void PgClient::mark_cancelled(const std::string& order_id) {
    exec_status(order_id, "cancelled");
}
