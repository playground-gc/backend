from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: str
    password: str = Field(..., min_length=6)


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    username: str


# ─── Order enums ──────────────────────────────────────────────────────────────

class OrderType(str, Enum):
    limit = "limit"
    market = "market"


class OrderSide(str, Enum):
    buy = "buy"
    sell = "sell"


class OrderStatus(str, Enum):
    open = "open"
    partial = "partial"
    filled = "filled"
    cancelled = "cancelled"
    failed = "failed"


# ─── Order request / response ─────────────────────────────────────────────────

class OrderRequest(BaseModel):
    """
    Place a new order.

    - **limit**: price is required; the order rests on the book until filled or cancelled.
    - **market**: price must be omitted; the order executes immediately at the best
      available price (IOC – any unfilled remainder is discarded, not resting).
    """

    model_config = ConfigDict(populate_by_name=True)

    symbol: str
    order_type: OrderType = Field(
        ...,
        alias="type",
        description="'limit' or 'market'",
    )
    side: OrderSide = Field(..., description="'buy' or 'sell'")
    price: Optional[float] = Field(
        None,
        gt=0,
        description="Execution price. Required for limit orders; must be omitted for market orders.",
    )
    quantity: float = Field(..., gt=0, description="Number of units to trade")

    @model_validator(mode="after")
    def _check_price_constraint(self) -> "OrderRequest":
        if self.order_type == OrderType.limit and self.price is None:
            raise ValueError("Limit orders require a positive price")
        if self.order_type == OrderType.market and self.price is not None:
            raise ValueError(
                "Market orders must not specify a price; omit the 'price' field"
            )
        return self


class OrderResponse(BaseModel):
    """Returned immediately after a new order is accepted."""

    order_id: str
    status: str
    symbol: str
    order_type: str
    side: str
    price: Optional[float]
    quantity: float


class OrderDetail(BaseModel):
    """Full order record returned by GET /orders and GET /orders/{id}."""

    id: UUID
    symbol: str
    order_type: str
    side: str
    price: Optional[float]
    quantity: float
    filled_qty: float
    status: str
    created_at: datetime
    updated_at: datetime


# ─── Market data ──────────────────────────────────────────────────────────────

class CandleBar(BaseModel):
    open: float
    high: float
    low: float
    close: float
    volume: float
    timestamp: int


class PortfolioItem(BaseModel):
    symbol: str
    quantity: float
    avg_cost: float
    current_price: Optional[float] = None
