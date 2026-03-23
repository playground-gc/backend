"""
Shared Pydantic v2 message schemas used across all Python services.
"""
from __future__ import annotations

import time
import uuid
from typing import Literal, Optional

from pydantic import BaseModel, Field


class OrderMessage(BaseModel):
    action: Literal["place", "cancel"]
    order_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    symbol: str
    type: Literal["limit", "market"]
    side: Literal["buy", "sell"]
    price: Optional[float] = None  # None for market orders
    quantity: float
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))


class CancelMessage(BaseModel):
    action: Literal["cancel"] = "cancel"
    order_id: str
    symbol: str
    user_id: str
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))


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
