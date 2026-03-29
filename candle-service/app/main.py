"""
Candle Service

Consumes trade events from Redis stream:trades (consumer group),
aggregates OHLCV candles, persists to Redis sorted sets + PostgreSQL,
and publishes candle_close events to Redis pub/sub.
"""
import asyncio
import json
import time
import logging

import redis.asyncio as aioredis

from app.aggregator import Aggregator, OpenCandle
from app.config import settings
from app.database import get_pool, close_pool

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [candle-service] %(message)s")
log = logging.getLogger(__name__)

STREAM_KEY     = "stream:trades"
CONSUMER_GROUP = "candle-service-group"
CONSUMER_NAME  = "candle-worker-1"
BATCH_SIZE     = 100
BLOCK_MS       = 1000   # 1 second block on XREADGROUP
FLUSH_INTERVAL = 1.0    # seconds between stale-candle flushes
CANDLE_MAXLEN  = 1000   # max candles kept per sorted set key


# ─── Persistence ──────────────────────────────────────────────────────────────

async def persist_candle(
    redis_conn: aioredis.Redis,
    pg_pool: "asyncpg.Pool",
    candle: OpenCandle,
) -> None:
    candle_json = json.dumps(candle.to_dict())
    key = f"candles:{candle.symbol}:{candle.interval}"
    score = candle.start_time

    # Atomically evict any stale entry at this exact bucket then write the new one.
    # Without this, a re-opened bucket produces duplicate members at the same score.
    pipe = redis_conn.pipeline()
    pipe.zremrangebyscore(key, score, score)
    pipe.zadd(key, {candle_json: score})
    pipe.zremrangebyrank(key, 0, -(CANDLE_MAXLEN + 1))
    await pipe.execute()

    # Persist to PostgreSQL
    async with pg_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO candles (symbol, interval, open, high, low, close, volume, timestamp)
            VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0))
            ON CONFLICT (symbol, interval, timestamp)
            DO UPDATE SET
                close  = EXCLUDED.close,
                high   = GREATEST(candles.high,   EXCLUDED.high),
                low    = LEAST(candles.low,        EXCLUDED.low),
                volume = candles.volume + EXCLUDED.volume
            """,
            candle.symbol,
            candle.interval,
            candle.open,
            candle.high,
            candle.low,
            candle.close,
            candle.volume,
            candle.start_time,
        )


async def publish_candle_event(redis_conn: aioredis.Redis, candle: OpenCandle) -> None:
    channel = f"candles:{candle.symbol}:{candle.interval}"
    event = {
        "event":     "candle",
        "symbol":    candle.symbol,
        "interval":  candle.interval,
        "open":      candle.open,
        "high":      candle.high,
        "low":       candle.low,
        "close":     candle.close,
        "volume":    candle.volume,
        "timestamp": candle.start_time,
    }
    await redis_conn.publish(channel, json.dumps(event))


async def handle_closed_candles(
    redis_conn: aioredis.Redis,
    pg_pool,
    closed: list[OpenCandle],
) -> None:
    for candle in closed:
        try:
            await persist_candle(redis_conn, pg_pool, candle)
            await publish_candle_event(redis_conn, candle)
            log.info("Closed %s %s @ %d  O=%.4f H=%.4f L=%.4f C=%.4f V=%.2f",
                     candle.symbol, candle.interval, candle.start_time,
                     candle.open, candle.high, candle.low, candle.close, candle.volume)
        except Exception as e:
            log.error("Failed to persist candle %s %s: %s", candle.symbol, candle.interval, e)


# ─── Periodic flush ───────────────────────────────────────────────────────────

async def periodic_flush(
    redis_conn: aioredis.Redis,
    pg_pool,
    aggregator: Aggregator,
) -> None:
    while True:
        await asyncio.sleep(FLUSH_INTERVAL)
        now_ms = int(time.time() * 1000)
        closed = aggregator.force_close_stale(now_ms)
        if closed:
            await handle_closed_candles(redis_conn, pg_pool, closed)


# ─── Main consumer loop ───────────────────────────────────────────────────────

async def main() -> None:
    log.info("Starting candle service")

    redis_conn = aioredis.from_url(
        settings.REDIS_URL,
        decode_responses=False,
        health_check_interval=30,
        retry_on_error=[ConnectionError, TimeoutError],
    )
    pg_pool = await get_pool()
    aggregator = Aggregator()

    # Create consumer group (idempotent)
    try:
        await redis_conn.xgroup_create(STREAM_KEY, CONSUMER_GROUP, id="0", mkstream=True)
        log.info("Created consumer group '%s'", CONSUMER_GROUP)
    except aioredis.ResponseError as e:
        if "BUSYGROUP" in str(e):
            log.info("Consumer group '%s' already exists", CONSUMER_GROUP)
        else:
            raise

    # Start periodic flush task
    asyncio.create_task(periodic_flush(redis_conn, pg_pool, aggregator))

    log.info("Consuming from stream '%s'", STREAM_KEY)

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
                entry_ids = []
                for entry_id, fields in entries:
                    try:
                        raw = fields.get(b"data") or fields.get("data")
                        if not raw:
                            continue
                        trade = json.loads(raw)
                        closed = aggregator.process_trade(
                            symbol=trade["symbol"],
                            price=float(trade["price"]),
                            quantity=float(trade["quantity"]),
                            timestamp_ms=int(trade["timestamp"]),
                        )
                        if closed:
                            await handle_closed_candles(redis_conn, pg_pool, closed)
                        entry_ids.append(entry_id)
                    except Exception as e:
                        log.error("Error processing entry %s: %s", entry_id, e)
                        entry_ids.append(entry_id)  # still ack to avoid reprocessing bad messages

                if entry_ids:
                    await redis_conn.xack(STREAM_KEY, CONSUMER_GROUP, *entry_ids)

        except asyncio.CancelledError:
            break
        except Exception as e:
            log.error("Consumer loop error: %s", e)
            await asyncio.sleep(1)

    await close_pool()
    await redis_conn.aclose()


if __name__ == "__main__":
    asyncio.run(main())
