from typing import Literal, Optional
from pydantic import BaseModel, Field, EmailStr


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


class OrderRequest(BaseModel):
    symbol: str
    type: Literal["limit", "market"]
    side: Literal["buy", "sell"]
    price: Optional[float] = None   # required for limit orders
    quantity: float = Field(..., gt=0)


class OrderResponse(BaseModel):
    order_id: str
    status: str


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
