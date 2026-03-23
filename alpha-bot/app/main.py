"""
Alpha Bot – SMA crossover strategy

Reads 1m candles from Redis.
When SMA(10) crosses above SMA(50) → BUY market order.
When SMA(10) crosses below SMA(50) → SELL market order.
Rate-limited to one trade per symbol per MIN_ORDER_INTERVAL_S seconds.
"""
import asyncio
import json
import logging
import time
from collections import defaultdict

import httpx
import redis.asyncio as aioredis

from app.config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [alpha-bot] %(message)s",
)
log = logging.getLogger(__name__)


# ─── Login helper ────────────────────────────────────────────────────────────

async def login(client: httpx.AsyncClient, retries: int = 10) -> str:
    for attempt in range(retries):
        try:
            await client.post("/api/v1/auth/register", json={
                "username": settings.BOT_USERNAME,
                "email":    f"{settings.BOT_USERNAME}@synthetic-bull.internal",
                "password": settings.BOT_PASSWORD,
            })
            resp = await client.post("/api/v1/auth/login", json={
                "username": settings.BOT_USERNAME,
                "password": settings.BOT_PASSWORD,
            })
            resp.raise_for_status()
            token = resp.json()["access_token"]
            log.info("Logged in as %s", settings.BOT_USERNAME)
            return token
        except Exception as e:
            log.warning("Login attempt %d/%d failed: %s", attempt + 1, retries, e)
            await asyncio.sleep(3)
    raise RuntimeError("Could not log in")


# ─── SMA calculation ──────────────────────────────────────────────────────────

def sma(values: list[float], period: int) -> float | None:
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


# ─── Per-symbol strategy loop ─────────────────────────────────────────────────

async def alpha_strategy(
    symbol: str,
    token: str,
    redis_conn: aioredis.Redis,
    client: httpx.AsyncClient,
    last_order_time: dict,
    prev_signal: dict,
) -> None:
    headers = {"Authorization": f"Bearer {token}"}

    while True:
        try:
            key = f"candles:{symbol}:{settings.CANDLE_INTERVAL}"
            raw = await redis_conn.zrange(key, -settings.SMA_SLOW, -1)

            if len(raw) >= settings.SMA_SLOW:
                closes = [json.loads(c)["close"] for c in raw]

                fast = sma(closes, settings.SMA_FAST)
                slow = sma(closes, settings.SMA_SLOW)

                if fast is not None and slow is not None:
                    curr = "bull" if fast > slow else "bear"
                    prev = prev_signal.get(symbol, "none")

                    # Detect crossover
                    if curr != prev and prev != "none":
                        now = time.time()
                        if now - last_order_time[symbol] >= settings.MIN_ORDER_INTERVAL_S:
                            side = "buy" if curr == "bull" else "sell"
                            try:
                                resp = await client.post(
                                    "/api/v1/orders",
                                    headers=headers,
                                    json={
                                        "symbol":   symbol,
                                        "type":     "market",
                                        "side":     side,
                                        "quantity": settings.ORDER_QUANTITY,
                                    },
                                )
                                if resp.status_code in (200, 201):
                                    last_order_time[symbol] = now
                                    log.info(
                                        "SMA crossover %s → %s %s %.1f @ market",
                                        symbol, side.upper(), symbol, settings.ORDER_QUANTITY,
                                    )
                            except Exception as e:
                                log.debug("Order error [%s]: %s", symbol, e)

                    prev_signal[symbol] = curr

        except asyncio.CancelledError:
            return
        except Exception as e:
            log.error("[%s] Strategy error: %s", symbol, e)

        await asyncio.sleep(settings.STRATEGY_TICK_S)


# ─── Main ─────────────────────────────────────────────────────────────────────

async def main() -> None:
    symbols = settings.symbols
    log.info("Alpha bot starting for symbols: %s", symbols)

    redis_conn = aioredis.from_url(
        settings.REDIS_URL,
        decode_responses=True,
        health_check_interval=30,
    )

    async with httpx.AsyncClient(
        base_url=settings.API_GATEWAY_URL,
        timeout=10.0,
    ) as client:
        token = await login(client)

        last_order_time: dict[str, float] = defaultdict(float)
        prev_signal: dict[str, str] = {}

        tasks = [
            asyncio.create_task(
                alpha_strategy(sym, token, redis_conn, client, last_order_time, prev_signal)
            )
            for sym in symbols
        ]
        await asyncio.gather(*tasks)


if __name__ == "__main__":
    asyncio.run(main())
