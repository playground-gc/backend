"""
Redis pub/sub → WebSocket fan-out bridge.
One shared Redis subscription for all channels; fan-out to matching WebSocket clients.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Dict, Set

import redis.asyncio as aioredis
from fastapi import WebSocket

log = logging.getLogger(__name__)


class SubscriptionManager:
    """
    Maps Redis pub/sub channel names to sets of WebSocket connections.
    All operations run in a single asyncio event loop – no locking needed.
    """

    def __init__(self) -> None:
        self._subs: Dict[str, Set[WebSocket]] = {}

    def subscribe(self, ws: WebSocket, channels: list[str]) -> None:
        for ch in channels:
            self._subs.setdefault(ch, set()).add(ws)

    def unsubscribe(self, ws: WebSocket) -> None:
        for ch_subs in self._subs.values():
            ch_subs.discard(ws)

    async def broadcast(self, channel: str, message: str) -> None:
        subscribers = list(self._subs.get(channel, set()))
        dead: list[WebSocket] = []
        for ws in subscribers:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.unsubscribe(ws)


# ─── Redis listener background task ──────────────────────────────────────────

async def redis_listener(
    manager: SubscriptionManager,
    redis_url: str,
    symbols: list[str],
) -> None:
    """
    Subscribe to all relevant channels for all symbols, plus the pattern
    stop_triggered:* for per-user stop order notifications.
    Runs forever as a background asyncio task.
    """
    while True:
        try:
            redis_conn = aioredis.from_url(
                redis_url,
                decode_responses=False,
                health_check_interval=30,
            )
            pubsub = redis_conn.pubsub()

            channels: list[str] = []
            for sym in symbols:
                channels.extend([
                    f"market_data:{sym}",
                    f"trades:{sym}",
                    f"orderbook:{sym}",
                    f"candles:{sym}:1s",
                    f"candles:{sym}:10s",
                    f"candles:{sym}:1m",
                ])

            await pubsub.subscribe(*channels)
            # Pattern subscribe for per-user stop order trigger notifications
            await pubsub.psubscribe("stop_triggered:*")
            log.info("Subscribed to %d Redis channels + pattern stop_triggered:*", len(channels))

            async for message in pubsub.listen():
                msg_type = message["type"]
                if msg_type == "message":
                    channel = message["channel"].decode()
                    data    = message["data"].decode()
                    await manager.broadcast(channel, data)
                elif msg_type == "pmessage":
                    # Pattern match: route to the specific channel name
                    channel = message["channel"].decode()
                    data    = message["data"].decode()
                    await manager.broadcast(channel, data)

        except asyncio.CancelledError:
            return
        except Exception as e:
            log.error("Redis listener error: %s – reconnecting in 2s", e)
            await asyncio.sleep(2)
