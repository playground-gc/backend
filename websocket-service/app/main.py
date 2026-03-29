"""
WebSocket Service

Bridges Redis pub/sub channels to WebSocket clients.
Endpoint: ws://host:8001/ws/{symbol}

Client subscription message (optional, sent after connect):
  {"subscribe": ["trades", "orderbook", "candles:1s", "candles:10s", "candles:1m"]}

Default subscription (on connect): trades + orderbook + candles:1m
"""
import asyncio
import json
import logging

from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.redis_subscriber import SubscriptionManager, redis_listener

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [websocket-service] %(message)s")
log = logging.getLogger(__name__)

manager = SubscriptionManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    symbols = settings.symbols
    log.info("Starting Redis listener for symbols: %s", symbols)
    task = asyncio.create_task(
        redis_listener(manager, settings.REDIS_URL, symbols)
    )
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Synthetic-Bull WebSocket Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def resolve_channels(sub_types: list[str], symbol: str) -> list[str]:
    """
    Map subscription type strings to full Redis channel names.
    e.g. "trades" → "trades:AAPL_S"
         "candles:1m" → "candles:AAPL_S:1m"
         "orderbook"  → "orderbook:AAPL_S"
    """
    channels: list[str] = []
    for s in sub_types:
        if s == "trades":
            channels.append(f"trades:{symbol}")
        elif s == "orderbook":
            channels.append(f"orderbook:{symbol}")
        elif s.startswith("candles"):
            parts = s.split(":")
            interval = parts[1] if len(parts) > 1 else "1m"
            channels.append(f"candles:{symbol}:{interval}")
    return channels


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.websocket("/ws/market/{symbol}")
async def market_data_endpoint(websocket: WebSocket, symbol: str):
    """
    Streams raw GBM L2 order book snapshots published by market-generator.
    Each message is a JSON object:
    {
      "type": "market_data",
      "symbol": "AAPL_S",
      "tick": 12345,
      "ts": 1234567890123,
      "mid": 180.12,
      "spread": 0.18,
      "spread_pct": 0.1,
      "asks": [{"price": 180.21, "size": 1000}, ...],   // best→worst
      "bids": [{"price": 180.03, "size": 1000}, ...]    // best→worst
    }
    """
    await websocket.accept()
    channel = f"market_data:{symbol}"
    manager.subscribe(websocket, [channel])
    log.info("Client connected to /ws/market/%s", symbol)

    try:
        while True:
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
            except asyncio.TimeoutError:
                await websocket.send_text('{"type":"ping"}')
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.debug("WebSocket closed: %s", e)
    finally:
        manager.unsubscribe(websocket)
        log.info("Client disconnected from /ws/market/%s", symbol)


@app.websocket("/ws/orders/{user_id}")
async def orders_endpoint(websocket: WebSocket, user_id: str):
    """
    Per-user order notification stream.
    Delivers stop order trigger events published to stop_triggered:{user_id}.
    The frontend connects here using the user_id received at login.
    """
    await websocket.accept()
    channel = f"stop_triggered:{user_id}"
    manager.subscribe(websocket, [channel])
    log.info("Client connected to /ws/orders/%s", user_id)

    try:
        while True:
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
            except asyncio.TimeoutError:
                await websocket.send_text('{"type":"ping"}')
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.debug("WebSocket closed: %s", e)
    finally:
        manager.unsubscribe(websocket)
        log.info("Client disconnected from /ws/orders/%s", user_id)


@app.websocket("/ws/{symbol}")
async def websocket_endpoint(websocket: WebSocket, symbol: str):
    await websocket.accept()

    # Default subscriptions
    default_channels = [
        f"trades:{symbol}",
        f"orderbook:{symbol}",
        f"candles:{symbol}:1m",
    ]
    manager.subscribe(websocket, default_channels)
    log.info("Client connected to /ws/%s", symbol)

    try:
        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if "subscribe" in msg:
                    new_channels = resolve_channels(msg["subscribe"], symbol)
                    manager.subscribe(websocket, new_channels)
                    log.info("Client updated subscriptions for %s: %s", symbol, new_channels)
            except asyncio.TimeoutError:
                # Send keepalive ping
                await websocket.send_text('{"type":"ping"}')
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.debug("WebSocket closed: %s", e)
    finally:
        manager.unsubscribe(websocket)
        log.info("Client disconnected from /ws/%s", symbol)
