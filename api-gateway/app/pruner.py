"""
Data retention pruner — keeps every unbounded table and stream within
a configured row/entry limit. Runs as a background asyncio task.

Limits are controlled via environment variables so they can be tuned
without a code change or rebuild.

  MAX_TRADES          – rows kept in the trades table          (default 100 000)
  MAX_ORDERS          – terminal-state rows kept in orders     (default  50 000)
  MAX_BALANCE_HISTORY – rows kept in balance_history           (default  10 000)
  MAX_CANDLES_PG      – rows kept per (symbol, interval) pair
                        in the candles table                   (default   5 000)
  MAX_STREAM_LEN      – entries kept in stream:trades          (default  10 000)
  PRUNE_INTERVAL_S    – seconds between pruning passes         (default     60)
"""
import asyncio
import logging
import os

log = logging.getLogger(__name__)

# ── Retention limits (env-configurable) ───────────────────────────────────────
MAX_TRADES          = int(os.getenv("MAX_TRADES",          "100000"))
MAX_ORDERS          = int(os.getenv("MAX_ORDERS",           "50000"))
MAX_BALANCE_HISTORY = int(os.getenv("MAX_BALANCE_HISTORY",  "10000"))
MAX_CANDLES_PG      = int(os.getenv("MAX_CANDLES_PG",        "5000"))
MAX_STREAM_LEN      = int(os.getenv("MAX_STREAM_LEN",       "10000"))
PRUNE_INTERVAL_S    = int(os.getenv("PRUNE_INTERVAL_S",         "60"))

_CANDLE_INTERVALS = ("1s", "10s", "1m")

# Only delete orders that are fully terminal — never touch open/partial/triggered
_TERMINAL_STATUSES = ("filled", "cancelled", "failed")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _deleted(result: str) -> int:
    """Parse the 'DELETE N' string returned by asyncpg execute()."""
    try:
        return int(result.split()[-1])
    except (IndexError, ValueError):
        return 0


# ── Per-table prune functions ─────────────────────────────────────────────────

async def _prune_trades(conn) -> int:
    result = await conn.execute(
        """
        DELETE FROM trades
        WHERE id NOT IN (
            SELECT id FROM trades
            ORDER BY timestamp DESC
            LIMIT $1
        )
        """,
        MAX_TRADES,
    )
    return _deleted(result)


async def _prune_orders(conn) -> int:
    """Only prunes terminal-state orders; open/partial/pending orders are untouched."""
    result = await conn.execute(
        """
        DELETE FROM orders
        WHERE status = ANY($1::text[])
          AND id NOT IN (
              SELECT id FROM orders
              WHERE status = ANY($1::text[])
              ORDER BY created_at DESC
              LIMIT $2
          )
        """,
        list(_TERMINAL_STATUSES),
        MAX_ORDERS,
    )
    return _deleted(result)


async def _prune_balance_history(conn) -> int:
    result = await conn.execute(
        """
        DELETE FROM balance_history
        WHERE id NOT IN (
            SELECT id FROM balance_history
            ORDER BY created_at DESC
            LIMIT $1
        )
        """,
        MAX_BALANCE_HISTORY,
    )
    return _deleted(result)


async def _prune_candles_pg(conn, symbols: list[str]) -> int:
    total = 0
    for symbol in symbols:
        for interval in _CANDLE_INTERVALS:
            result = await conn.execute(
                """
                DELETE FROM candles
                WHERE symbol = $1 AND interval = $2
                  AND timestamp NOT IN (
                      SELECT timestamp FROM candles
                      WHERE symbol = $1 AND interval = $2
                      ORDER BY timestamp DESC
                      LIMIT $3
                  )
                """,
                symbol,
                interval,
                MAX_CANDLES_PG,
            )
            total += _deleted(result)
    return total


async def _prune_stream(redis) -> None:
    """Trim stream:trades to MAX_STREAM_LEN entries (approximate for performance)."""
    await redis.xtrim("stream:trades", maxlen=MAX_STREAM_LEN, approximate=True)


# ── Main pruning pass ─────────────────────────────────────────────────────────

async def _run_once(pool, redis, symbols: list[str]) -> None:
    try:
        async with pool.acquire() as conn:
            n_trades = await _prune_trades(conn)
            n_orders = await _prune_orders(conn)
            n_bh     = await _prune_balance_history(conn)
            n_candles = await _prune_candles_pg(conn, symbols)

        if n_trades or n_orders or n_bh or n_candles:
            log.info(
                "Pruner: deleted %d trades, %d orders, %d balance_history, %d candles",
                n_trades, n_orders, n_bh, n_candles,
            )
    except Exception as e:
        log.warning("Pruner: PostgreSQL pass failed: %s", e)

    try:
        await _prune_stream(redis)
    except Exception as e:
        log.warning("Pruner: Redis stream trim failed: %s", e)


# ── Background task entrypoint ────────────────────────────────────────────────

async def run_pruner(pool, redis, symbols: list[str]) -> None:
    log.info(
        "Pruner started — limits: trades=%d orders=%d balance_history=%d "
        "candles_pg=%d stream=%d  interval=%ds",
        MAX_TRADES, MAX_ORDERS, MAX_BALANCE_HISTORY,
        MAX_CANDLES_PG, MAX_STREAM_LEN, PRUNE_INTERVAL_S,
    )
    while True:
        await asyncio.sleep(PRUNE_INTERVAL_S)
        await _run_once(pool, redis, symbols)
