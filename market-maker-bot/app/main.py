"""
Market Maker Bot

Quotes a bid/ask spread around the current mid price for each symbol.
Refreshes quotes every 500ms.

Strategy:
  bid = mid * (1 - SPREAD/2)
  ask = mid * (1 + SPREAD/2)
  Quote size: QUOTE_SIZE units on each side.
"""
import asyncio
import logging

import httpx
import redis.asyncio as aioredis

from app.config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [market-maker] %(message)s",
)
log = logging.getLogger(__name__)


# ─── Login helper ────────────────────────────────────────────────────────────

async def login(client: httpx.AsyncClient, retries: int = 10) -> str:
    """Register (if needed) and login. Returns JWT token."""
    for attempt in range(retries):
        try:
            # Try register first (idempotent – 409 = already exists)
            await client.post("/api/v1/auth/register", json={
                "username": settings.BOT_USERNAME,
                "email":    f"{settings.BOT_USERNAME}@synthetic-bull.internal",
                "password": settings.BOT_PASSWORD,
            })

            # Login
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

    raise RuntimeError("Could not log in to API gateway")


# ─── Per-symbol market maker coroutine ───────────────────────────────────────

async def market_maker_symbol(
    symbol: str,
    token: str,
    redis_conn: aioredis.Redis,
    client: httpx.AsyncClient,
) -> None:
    headers = {"Authorization": f"Bearer {token}"}
    active_orders: list[str] = []

    while True:
        try:
            # ── Get mid price from Redis ──────────────────────────────────────
            price_data = await redis_conn.hgetall(f"price:{symbol}")
            if not price_data:
                await asyncio.sleep(settings.REFRESH_INTERVAL_S)
                continue

            mid = float(price_data.get("price", 0))
            if mid <= 0:
                await asyncio.sleep(settings.REFRESH_INTERVAL_S)
                continue

            # ── Cancel previous quotes ────────────────────────────────────────
            cancel_tasks = [
                client.delete(f"/api/v1/orders/{oid}", headers=headers)
                for oid in active_orders
            ]
            if cancel_tasks:
                results = await asyncio.gather(*cancel_tasks, return_exceptions=True)
                for r in results:
                    if isinstance(r, Exception):
                        log.debug("Cancel error: %s", r)
            active_orders.clear()

            # ── Place new bid and ask ─────────────────────────────────────────
            bid_price = round(mid * (1.0 - settings.SPREAD / 2.0), 6)
            ask_price = round(mid * (1.0 + settings.SPREAD / 2.0), 6)

            for side, price in [("buy", bid_price), ("sell", ask_price)]:
                try:
                    resp = await client.post(
                        "/api/v1/orders",
                        headers=headers,
                        json={
                            "symbol":   symbol,
                            "type":     "limit",
                            "side":     side,
                            "price":    price,
                            "quantity": settings.QUOTE_SIZE,
                        },
                    )
                    if resp.status_code in (200, 201):
                        active_orders.append(resp.json()["order_id"])
                except Exception as e:
                    log.debug("Place order error [%s %s]: %s", side, symbol, e)

        except asyncio.CancelledError:
            return
        except Exception as e:
            log.error("[%s] Error: %s", symbol, e)

        await asyncio.sleep(settings.REFRESH_INTERVAL_S)


# ─── Main ─────────────────────────────────────────────────────────────────────

async def main() -> None:
    symbols = settings.symbols
    log.info("Market maker starting for symbols: %s", symbols)

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

        tasks = [
            asyncio.create_task(
                market_maker_symbol(sym, token, redis_conn, client)
            )
            for sym in symbols
        ]
        await asyncio.gather(*tasks)


if __name__ == "__main__":
    asyncio.run(main())
