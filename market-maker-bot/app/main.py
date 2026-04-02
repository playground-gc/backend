"""
Avellaneda-Stoikov Market Maker Bot

Quotes a bid/ask spread around the current mid price for each symbol,
adjusted for inventory risk according to the Avellaneda-Stoikov model.
"""

import asyncio
import json
import logging
import math
from dataclasses import dataclass, field

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
    q: int = 0  # Current inventory (signed, integer shares)
    tick_count: int = 0  # Local tick counter for periodic inventory sync
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
    # Ticks remaining to horizon (revolving horizon: resets every T_TICKS ticks).
    # tick % T_TICKS is always in [0, T_TICKS-1], so rem is always in [1, T_TICKS].
    rem = settings.T_TICKS - (tick % settings.T_TICKS)

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

    # Initialize inventory from portfolio
    agent.q = int(await fetch_inventory(client, symbol, headers))
    log.info("[%s] Starting AS Market Maker. Initial inventory: %d", symbol, agent.q)

    # Subscribe to the market generator's pub/sub channel so we process exactly
    # one quote update per market tick (not a timer-driven polling loop).
    pubsub = redis_conn.pubsub()
    await pubsub.subscribe(f"market_data:{symbol}")
    log.info("[%s] Subscribed to market_data:%s", symbol, symbol)

    try:
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue

            try:
                data = json.loads(message["data"])
            except Exception as e:
                log.debug("[%s] Bad message payload: %s", symbol, e)
                continue

            mid = float(data.get("mid", 0))
            if mid <= 0:
                continue

            # Market tick counter drives the revolving horizon (rem calculation).
            market_tick = int(data.get("tick", agent.tick_count))

            # ── 1. Update Volatility Estimate (EMA of log-return variance) ───
            if agent.prev_mid > 0:
                log_ret = math.log(mid / agent.prev_mid)
                agent.var_ema = (
                    settings.VOL_EMA_ALPHA * (log_ret ** 2)
                    + (1.0 - settings.VOL_EMA_ALPHA) * agent.var_ema
                )
            agent.prev_mid = mid
            sigma_tick = math.sqrt(agent.var_ema)

            # ── 2. Sync Inventory (every 5 seconds worth of ticks) ───────────
            agent.tick_count += 1
            if agent.tick_count % (settings.TPS * 5) == 0:
                agent.q = int(await fetch_inventory(client, symbol, headers))

            # ── 3. Compute AS Quotes ─────────────────────────────────────────
            reservation, bid_price, ask_price = compute_quotes(
                mid=mid, sigma_tick=sigma_tick, q=agent.q, tick=market_tick
            )

            bid_price = round(bid_price, 6)
            ask_price = round(ask_price, 6)

            # Soft inventory caps.
            # Long side: stop buying if already at Q_MAX.
            # Short side: stop selling if already at -SHORT_MAX (user's holdings
            # minus SHORT_MAX extra).  This is evaluated against the local q
            # estimate which is updated in real-time via fill detection below.
            place_bid = agent.q < settings.Q_MAX
            place_ask = agent.q > -settings.SHORT_MAX

            # ── 4. Cancel previous quotes (fill detection) ───────────────────
            # A 409 on DELETE means the order is already in a terminal state.
            # If the detail says "filled", the order was matched before we
            # cancelled it — update q in real-time instead of waiting for the
            # 5-second portfolio sync.
            prev_bid_id = agent.active_bid_id
            prev_ask_id = agent.active_ask_id
            agent.active_bid_id = ""
            agent.active_ask_id = ""

            cancel_coros = []
            cancel_sides = []
            if prev_bid_id:
                cancel_coros.append(
                    client.delete(f"/api/v1/orders/{prev_bid_id}", headers=headers)
                )
                cancel_sides.append("bid")
            if prev_ask_id:
                cancel_coros.append(
                    client.delete(f"/api/v1/orders/{prev_ask_id}", headers=headers)
                )
                cancel_sides.append("ask")

            if cancel_coros:
                results = await asyncio.gather(*cancel_coros, return_exceptions=True)
                for side, r in zip(cancel_sides, results):
                    if isinstance(r, Exception):
                        log.debug("[%s] Cancel %s error: %s", symbol, side, r)
                    elif r.status_code == 409:
                        # 409 means order is already in a terminal state.
                        # "Order already filled" means it was matched before we
                        # could cancel it — update inventory accordingly.
                        # "Order already cancelled/failed" should not happen here
                        # (we own these IDs and cancel each only once).
                        try:
                            detail = r.json().get("detail", "").lower()
                        except Exception:
                            detail = ""
                        if "filled" in detail:
                            if side == "bid":
                                agent.q += 1
                                log.debug("[%s] Bid fill detected (409), q=%d", symbol, agent.q)
                            else:
                                agent.q -= 1
                                log.debug("[%s] Ask fill detected (409), q=%d", symbol, agent.q)
                            # Re-evaluate guards after fill detection.
                            place_bid = agent.q < settings.Q_MAX
                            place_ask = agent.q > -settings.SHORT_MAX

            # ── 5. Place new bid and ask ─────────────────────────────────────
            if place_bid:
                try:
                    resp = await client.post(
                        "/api/v1/orders",
                        headers=headers,
                        json={
                            "symbol": symbol,
                            "type": "limit",
                            "side": "buy",
                            "price": bid_price,
                            "quantity": 1,
                        },
                    )
                    if resp.status_code in (200, 201):
                        agent.active_bid_id = resp.json()["order_id"]
                except Exception as e:
                    log.debug("[%s] Place bid error: %s", symbol, e)

            if place_ask:
                try:
                    resp = await client.post(
                        "/api/v1/orders",
                        headers=headers,
                        json={
                            "symbol": symbol,
                            "type": "limit",
                            "side": "sell",
                            "price": ask_price,
                            "quantity": 1,
                        },
                    )
                    if resp.status_code in (200, 201):
                        agent.active_ask_id = resp.json()["order_id"]
                except Exception as e:
                    log.debug("[%s] Place ask error: %s", symbol, e)

    except asyncio.CancelledError:
        pass
    finally:
        await pubsub.unsubscribe(f"market_data:{symbol}")
        await pubsub.aclose()


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
