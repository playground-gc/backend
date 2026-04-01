"""
Avellaneda-Stoikov Market Maker Bot

Quotes a bid/ask spread around the current mid price for each symbol,
adjusted for inventory risk according to the Avellaneda-Stoikov model.
"""

import asyncio
import logging
import math
from dataclasses import dataclass, field
from typing import List

import httpx
import redis.asyncio as aioredis

from app.config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [market-maker] %(message)s",
)
log = logging.getLogger(__name__)


# ─── Data Structures ─────────────────────────────────────────────────────────


@dataclass
class ASAgent:
    q: float = 0.0  # Current inventory
    tick_count: int = 0  # Running tick counter
    prev_mid: float = 0.0  # Previous mid price for vol estimation
    var_ema: float = 1e-8  # EMA of per-tick log-return variance
    active_bid_id: str = ""
    active_ask_id: str = ""


# ─── Login helper ────────────────────────────────────────────────────────────


async def login(client: httpx.AsyncClient, retries: int = 10) -> str:
    """Register (if needed) and login. Returns JWT token."""
    for attempt in range(retries):
        try:
            # Try register first (idempotent – 409 = already exists)
            await client.post(
                "/api/v1/auth/register",
                json={
                    "username": settings.BOT_USERNAME,
                    "email": f"{settings.BOT_USERNAME}@synthetic-bull.internal",
                    "password": settings.BOT_PASSWORD,
                },
            )

            # Login
            resp = await client.post(
                "/api/v1/auth/login",
                json={
                    "username": settings.BOT_USERNAME,
                    "password": settings.BOT_PASSWORD,
                },
            )
            resp.raise_for_status()
            token = resp.json()["access_token"]
            log.info("Logged in as %s", settings.BOT_USERNAME)
            return token

        except Exception as e:
            log.warning("Login attempt %d/%d failed: %s", attempt + 1, retries, e)
            await asyncio.sleep(3)

    raise RuntimeError("Could not log in to API gateway")


# ─── API Helpers ─────────────────────────────────────────────────────────────


async def fetch_inventory(
    client: httpx.AsyncClient, symbol: str, headers: dict
) -> float:
    """Fetch current inventory (quantity) for a specific symbol."""
    try:
        resp = await client.get("/api/v1/portfolio", headers=headers)
        if resp.status_code == 200:
            portfolio = resp.json()
            for position in portfolio:
                if position.get("symbol") == symbol:
                    return float(position.get("quantity", 0.0))
        return 0.0
    except Exception as e:
        log.debug("[%s] Failed to fetch inventory: %s", symbol, e)
        return 0.0


# ─── Avellaneda-Stoikov Logic ────────────────────────────────────────────────


def compute_quotes(
    mid: float, sigma_tick: float, q: float, tick: int
) -> tuple[float, float, float]:
    """
    Computes AS quotes based on:
    - mid: Current mid price
    - sigma_tick: Per-tick volatility estimate
    - q: Current inventory
    - tick: Current tick count

    Returns (reservation_price, bid_price, ask_price)
    """
    # Ticks remaining to horizon (revolving horizon logic)
    rem = max(settings.T_TICKS - (tick % settings.T_TICKS), 0)

    # Dollar variance
    sigma_dollar = mid * sigma_tick
    var_dollar = sigma_dollar**2

    # Fixed half-spread (independent of inventory)
    delta_fixed = (1.0 / settings.GAMMA) * math.log(1.0 + settings.GAMMA / settings.K)

    # Inventory adjustment
    inv_adj = settings.GAMMA * q * var_dollar * rem

    # Reservation price (inventory-adjusted mid)
    reservation = mid - q * settings.GAMMA * var_dollar * rem

    # Quote distances from mid
    delta_b = inv_adj + delta_fixed
    delta_a = -inv_adj + delta_fixed

    # Guard: prevent negative or zero spread distances
    min_dist = mid * 1e-6
    delta_b = max(delta_b, min_dist)
    delta_a = max(delta_a, min_dist)

    bid_price = mid - delta_b
    ask_price = mid + delta_a

    return reservation, bid_price, ask_price


# ─── Per-symbol market maker coroutine ───────────────────────────────────────


async def market_maker_symbol(
    symbol: str,
    token: str,
    redis_conn: aioredis.Redis,
    client: httpx.AsyncClient,
) -> None:
    headers = {"Authorization": f"Bearer {token}"}
    agent = ASAgent()
    refresh_interval = 1.0 / settings.TPS

    # Initialize inventory
    agent.q = await fetch_inventory(client, symbol, headers)
    log.info("[%s] Starting AS Market Maker. Initial inventory: %.2f", symbol, agent.q)

    while True:
        try:
            # ── 1. Get mid price from Redis ──────────────────────────────────
            price_data = await redis_conn.hgetall(f"price:{symbol}")
            if not price_data:
                await asyncio.sleep(refresh_interval)
                continue

            mid = float(price_data.get("price", 0))
            if mid <= 0:
                await asyncio.sleep(refresh_interval)
                continue

            # ── 2. Update Volatility Estimate (F2) ───────────────────────────
            if agent.prev_mid > 0:
                log_ret = math.log(mid / agent.prev_mid)
                # EMA of variance
                agent.var_ema = (
                    settings.VOL_EMA_ALPHA * (log_ret**2)
                    + (1.0 - settings.VOL_EMA_ALPHA) * agent.var_ema
                )
            agent.prev_mid = mid
            sigma_tick = math.sqrt(agent.var_ema)

            # ── 3. Sync Inventory (Periodically) ─────────────────────────────
            if agent.tick_count % (settings.TPS * 5) == 0:  # Sync every 5 seconds
                agent.q = await fetch_inventory(client, symbol, headers)

            agent.tick_count += 1

            # ── 4. Compute AS Quotes ─────────────────────────────────────────
            reservation, bid_price, ask_price = compute_quotes(
                mid=mid, sigma_tick=sigma_tick, q=agent.q, tick=agent.tick_count
            )

            bid_price = round(bid_price, 6)
            ask_price = round(ask_price, 6)

            # Check inventory limits before placing
            place_bid = agent.q < settings.Q_MAX
            place_ask = agent.q > -settings.Q_MAX

            # ── 5. Cancel previous quotes ────────────────────────────────────
            cancel_tasks = []
            if agent.active_bid_id:
                cancel_tasks.append(
                    client.delete(
                        f"/api/v1/orders/{agent.active_bid_id}", headers=headers
                    )
                )
            if agent.active_ask_id:
                cancel_tasks.append(
                    client.delete(
                        f"/api/v1/orders/{agent.active_ask_id}", headers=headers
                    )
                )

            agent.active_bid_id = ""
            agent.active_ask_id = ""

            if cancel_tasks:
                results = await asyncio.gather(*cancel_tasks, return_exceptions=True)
                for r in results:
                    if isinstance(r, Exception):
                        log.debug("[%s] Cancel error: %s", symbol, r)

            # ── 6. Place new bid and ask ─────────────────────────────────────
            place_tasks = []
            if place_bid:
                place_tasks.append(("buy", bid_price))
            if place_ask:
                place_tasks.append(("sell", ask_price))

            for side, price in place_tasks:
                try:
                    resp = await client.post(
                        "/api/v1/orders",
                        headers=headers,
                        json={
                            "symbol": symbol,
                            "type": "limit",
                            "side": side,
                            "price": price,
                            "quantity": 1,  # Based on pure AS strategy default
                        },
                    )
                    if resp.status_code in (200, 201):
                        oid = resp.json()["order_id"]
                        if side == "buy":
                            agent.active_bid_id = oid
                        else:
                            agent.active_ask_id = oid
                except Exception as e:
                    log.debug("[%s] Place order error [%s]: %s", symbol, side, e)

        except asyncio.CancelledError:
            return
        except Exception as e:
            log.error("[%s] Error: %s", symbol, e)

        await asyncio.sleep(refresh_interval)


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
            asyncio.create_task(market_maker_symbol(sym, token, redis_conn, client))
            for sym in symbols
        ]
        await asyncio.gather(*tasks)


if __name__ == "__main__":
    asyncio.run(main())
