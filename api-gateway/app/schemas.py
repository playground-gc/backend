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
    stop_limit = "stop_limit"
    stop_market = "stop_market"


class OrderSide(str, Enum):
    buy = "buy"
    sell = "sell"


class OrderStatus(str, Enum):
    open = "open"
    partial = "partial"
    filled = "filled"
    cancelled = "cancelled"
    failed = "failed"
    pending_trigger = "pending_trigger"
    triggered = "triggered"


# ─── Order request / response ─────────────────────────────────────────────────

class OrderRequest(BaseModel):
    """
    Place a new order.

    - **limit**: price is required; the order rests on the book until filled or cancelled.
    - **market**: price must be omitted; the order executes immediately at the best
      available price (IOC – any unfilled remainder is discarded, not resting).
    - **stop_limit**: stop_price and limit_price required; persisted server-side until triggered.
    - **stop_market**: stop_price required; persisted server-side until triggered.
    """

    model_config = ConfigDict(populate_by_name=True)

    symbol: str
    order_type: OrderType = Field(
        ...,
        alias="type",
        description="'limit', 'market', 'stop_limit', or 'stop_market'",
    )
    side: OrderSide = Field(..., description="'buy' or 'sell'")
    price: Optional[float] = Field(
        None,
        gt=0,
        description="Execution price. Required for limit orders; omit for market/stop orders.",
    )
    stop_price: Optional[float] = Field(
        None,
        gt=0,
        description="Trigger price. Required for stop_limit and stop_market orders.",
    )
    limit_price: Optional[float] = Field(
        None,
        gt=0,
        description="Limit price submitted to the engine when stop_limit triggers.",
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
        if self.order_type in (OrderType.stop_limit, OrderType.stop_market):
            if self.stop_price is None:
                raise ValueError("Stop orders require stop_price")
        if self.order_type == OrderType.stop_limit and self.limit_price is None:
            raise ValueError("stop_limit orders require limit_price")
        return self


class OrderResponse(BaseModel):
    """Returned immediately after a new limit / market order is accepted."""

    order_id: str
    status: str
    symbol: str
    order_type: str
    side: str
    price: Optional[float]
    quantity: float


class StopOrderResponse(BaseModel):
    """Returned immediately after a stop_limit / stop_market order is accepted."""

    order_id: str
    status: str      # "pending_trigger"
    stop_price: float
    expires_at: str  # ISO-8601 datetime


class OrderDetail(BaseModel):
    """Full order record returned by GET /orders and GET /orders/{id}."""

    id: UUID
    symbol: str
    order_type: str
    side: str
    price: Optional[float] = None
    stop_price: Optional[float] = None
    limit_price: Optional[float] = None
    quantity: float
    filled_qty: float
    status: str
    expires_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


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
