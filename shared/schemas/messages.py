"""
Shared Pydantic v2 message schemas used across all Python services.
"""
from __future__ import annotations

import time
import uuid
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# ─── Enums ────────────────────────────────────────────────────────────────────

class OrderType(str, Enum):
    limit = "limit"
    market = "market"


class OrderSide(str, Enum):
    buy = "buy"
    sell = "sell"


# ─── Engine wire messages ─────────────────────────────────────────────────────

class OrderMessage(BaseModel):
    """
    Message sent from the API gateway to the matching engine over TCP.

    The matching engine (C++) parses the ``type`` key, so this model
    serialises ``order_type`` as ``type`` via ``serialization_alias``.
    Use ``model.model_dump(by_alias=True)`` when building the JSON payload.
    """

    model_config = ConfigDict(populate_by_name=True)

    action: Literal["place", "cancel"]
    order_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    symbol: str
    order_type: OrderType = Field(..., serialization_alias="type")
    side: OrderSide
    price: Optional[float] = None  # None for market orders
    quantity: float
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))


class CancelMessage(BaseModel):
    action: Literal["cancel"] = "cancel"
    order_id: str
    symbol: str
    user_id: str
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))


# ─── Redis pub/sub events ─────────────────────────────────────────────────────

class TradeEvent(BaseModel):
    event: Literal["trade"] = "trade"
    trade_id: str
    symbol: str
    price: float
    quantity: float
    buy_order_id: str
    sell_order_id: str
    buyer_id: str
    seller_id: str
    timestamp: int


class OrderbookLevel(BaseModel):
    price: float
    quantity: float


class OrderbookSnapshot(BaseModel):
    event: Literal["orderbook"] = "orderbook"
    symbol: str
    bids: list[list[float]]  # [[price, qty], ...]  descending
    asks: list[list[float]]  # [[price, qty], ...]  ascending
    timestamp: int


class CandleEvent(BaseModel):
    event: Literal["candle"] = "candle"
    symbol: str
    interval: str  # "1s", "10s", "1m"
    open: float
    high: float
    low: float
    close: float
    volume: float
    timestamp: int  # bucket start unix ms


class StockInfo(BaseModel):
    symbol: str
    name: str
    initial_price: float
    drift: float
    volatility: float
