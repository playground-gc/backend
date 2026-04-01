"""
Fill Processor

Background consumer that reads from stream:trades and:
  1. Inserts into the trades table
  2. Updates orders.filled_qty / status for each matched order
  3. Updates portfolios and user balances
"""
import asyncio
import json
import logging
import uuid

import asyncpg
import redis.asyncio as aioredis

from app.config import settings
from app.database import get_pool

log = logging.getLogger(__name__)

STREAM_KEY     = "stream:trades"
CONSUMER_GROUP = "fill-processor-group"
CONSUMER_NAME  = "fill-worker-1"
BATCH_SIZE     = 50
BLOCK_MS       = 1000


def _try_uuid(val: str | None):
    """Return val as UUID string if valid, else None."""
    if not val:
        return None
    try:
        uuid.UUID(val)
        return val
    except (ValueError, AttributeError):
        return None


async def process_trade(pool: asyncpg.Pool, trade: dict) -> None:
    symbol        = trade["symbol"]
    price         = float(trade["price"])
    quantity      = float(trade["quantity"])
    timestamp_ms  = int(trade["timestamp"])

    buy_order_id  = _try_uuid(trade.get("buy_order_id"))
    sell_order_id = _try_uuid(trade.get("sell_order_id"))
    buyer_id      = _try_uuid(trade.get("buyer_id"))
    seller_id     = _try_uuid(trade.get("seller_id"))

    cost = price * quantity

    # ── Critical path: trade insert + order status updates ─────────────────
    # These must NOT be rolled back by portfolio/balance failures.
    async with pool.acquire() as conn:
        async with conn.transaction():
            # 1. Insert into trades table
            await conn.execute(
                """
                INSERT INTO trades (symbol, buy_order_id, sell_order_id, price, quantity, buyer_id, seller_id, timestamp)
                VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0))
                ON CONFLICT DO NOTHING
                """,
                symbol,
                uuid.UUID(buy_order_id)  if buy_order_id  else None,
                uuid.UUID(sell_order_id) if sell_order_id else None,
                price, quantity,
                uuid.UUID(buyer_id)  if buyer_id  else None,
                uuid.UUID(seller_id) if seller_id else None,
                timestamp_ms,
            )

            # 2. Update buy order status/filled_qty
            if buy_order_id:
                await conn.execute(
                    """
                    UPDATE orders
                    SET filled_qty = LEAST(filled_qty + $2::numeric(18,6), quantity),
                        status     = CASE
                                        WHEN filled_qty + $2::numeric(18,6) >= quantity THEN 'filled'
                                        ELSE 'partial'
                                     END
                    WHERE id = $1 AND status NOT IN ('cancelled', 'failed', 'filled')
                    """,
                    uuid.UUID(buy_order_id), quantity,
                )

            # 3. Update sell order status/filled_qty
            if sell_order_id:
                await conn.execute(
                    """
                    UPDATE orders
                    SET filled_qty = LEAST(filled_qty + $2::numeric(18,6), quantity),
                        status     = CASE
                                        WHEN filled_qty + $2::numeric(18,6) >= quantity THEN 'filled'
                                        ELSE 'partial'
                                     END
                    WHERE id = $1 AND status NOT IN ('cancelled', 'failed', 'filled')
                    """,
                    uuid.UUID(sell_order_id), quantity,
                )

    # ── Secondary path: portfolio + balance updates ────────────────────────
    # Failures here must NOT affect order status updates above.

    # 4. Update buyer portfolio and balance
    if buyer_id:
        try:
            async with pool.acquire() as conn:
                async with conn.transaction():
                    await conn.execute(
                        """
                        INSERT INTO portfolios (user_id, symbol, quantity, avg_cost)
                        VALUES ($1, $2, $3, $4)
                        ON CONFLICT (user_id, symbol) DO UPDATE
                        SET avg_cost = CASE
                                          WHEN portfolios.quantity + $3 > 0
                                          THEN (portfolios.avg_cost * portfolios.quantity + $4 * $3)
                                               / (portfolios.quantity + $3)
                                          ELSE $4
                                       END,
                            quantity = portfolios.quantity + $3
                        """,
                        uuid.UUID(buyer_id), symbol, quantity, price,
                    )
                    row = await conn.fetchrow(
                        """
                        UPDATE users SET balance = balance - $2
                        WHERE id = $1 AND balance >= $2
                        RETURNING balance
                        """,
                        uuid.UUID(buyer_id), cost,
                    )
                    if row:
                        await conn.execute(
                            """
                            INSERT INTO balance_history
                                (user_id, delta, balance, reason, symbol, quantity, price, trade_id)
                            VALUES ($1, $2, $3, 'trade_buy', $4, $5, $6, $7)
                            """,
                            uuid.UUID(buyer_id), -cost, float(row["balance"]),
                            symbol, quantity, price,
                            uuid.UUID(tid) if (tid := _try_uuid(trade.get("trade_id"))) else None,
                        )
        except Exception as e:
            log.warning("Buyer portfolio/balance update failed for %s: %s", buyer_id, e)

    # 5. Update seller portfolio and balance
    if seller_id:
        try:
            async with pool.acquire() as conn:
                async with conn.transaction():
                    await conn.execute(
                        """
                        INSERT INTO portfolios (user_id, symbol, quantity, avg_cost)
                        VALUES ($1, $2, -$3, 0)
                        ON CONFLICT (user_id, symbol) DO UPDATE
                        SET quantity = portfolios.quantity - $3
                        """,
                        uuid.UUID(seller_id), symbol, quantity,
                    )
                    row = await conn.fetchrow(
                        """
                        UPDATE users SET balance = balance + $2
                        WHERE id = $1
                        RETURNING balance
                        """,
                        uuid.UUID(seller_id), cost,
                    )
                    if row:
                        await conn.execute(
                            """
                            INSERT INTO balance_history
                                (user_id, delta, balance, reason, symbol, quantity, price, trade_id)
                            VALUES ($1, $2, $3, 'trade_sell', $4, $5, $6, $7)
                            """,
                            uuid.UUID(seller_id), cost, float(row["balance"]),
                            symbol, quantity, price,
                            uuid.UUID(tid) if (tid := _try_uuid(trade.get("trade_id"))) else None,
                        )
        except Exception as e:
            log.warning("Seller portfolio/balance update failed for %s: %s", seller_id, e)


async def run_fill_processor() -> None:
    log.info("Fill processor starting")

    redis_conn = aioredis.from_url(
        settings.REDIS_URL,
        decode_responses=False,
        health_check_interval=30,
        retry_on_error=[ConnectionError, TimeoutError],
    )

    pg_pool = await get_pool()

    # Create consumer group (idempotent — start from beginning "0" to catch past trades)
    try:
        await redis_conn.xgroup_create(STREAM_KEY, CONSUMER_GROUP, id="0", mkstream=True)
        log.info("Consumer group '%s' created", CONSUMER_GROUP)
    except aioredis.ResponseError as e:
        if "BUSYGROUP" in str(e):
            log.info("Consumer group '%s' already exists", CONSUMER_GROUP)
        else:
            raise

    log.info("Fill processor consuming from '%s'", STREAM_KEY)

    while True:
        try:
            messages = await redis_conn.xreadgroup(
                groupname=CONSUMER_GROUP,
                consumername=CONSUMER_NAME,
                streams={STREAM_KEY: ">"},
                count=BATCH_SIZE,
                block=BLOCK_MS,
            )

            if not messages:
                continue

            for _stream, entries in messages:
                ack_ids = []
                for entry_id, fields in entries:
                    try:
                        raw = fields.get(b"data") or fields.get("data")
                        if not raw:
                            ack_ids.append(entry_id)
                            continue
                        trade = json.loads(raw)
                        await process_trade(pg_pool, trade)
                        log.info(
                            "Filled trade %s | %s qty=%.4f price=%.4f",
                            trade.get("trade_id"), trade.get("symbol"),
                            float(trade.get("quantity", 0)), float(trade.get("price", 0)),
                        )
                        ack_ids.append(entry_id)
                    except Exception as e:
                        log.error("Error processing trade entry %s: %s", entry_id, e, exc_info=True)
                        ack_ids.append(entry_id)  # ack anyway to avoid poison-pill loop

                if ack_ids:
                    await redis_conn.xack(STREAM_KEY, CONSUMER_GROUP, *ack_ids)

        except asyncio.CancelledError:
            break
        except Exception as e:
            log.error("Fill processor loop error: %s", e)
            await asyncio.sleep(1)

    await redis_conn.aclose()
    log.info("Fill processor stopped")
