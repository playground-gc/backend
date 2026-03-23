import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import get_current_user
from app.config import settings
from app.database import get_db
from app.redis_client import get_redis

router = APIRouter(prefix="/api/v1", tags=["market"])
log = logging.getLogger(__name__)


@router.get("/stocks")
async def list_stocks():
    """List all configured stock symbols with metadata."""
    return settings.stocks_list


@router.get("/orderbook/{symbol}")
async def get_orderbook(symbol: str, redis=Depends(get_redis)):
    if symbol not in settings.symbols:
        raise HTTPException(status_code=404, detail=f"Unknown symbol: {symbol}")

    snapshot = await redis.get(f"orderbook:snapshot:{symbol}")
    if not snapshot:
        raise HTTPException(status_code=404, detail="No orderbook data yet – system warming up")

    return json.loads(snapshot)


@router.get("/candles/{symbol}")
async def get_candles(
    symbol: str,
    interval: str = Query("1m", regex="^(1s|10s|1m)$"),
    limit: int = Query(100, ge=1, le=1000),
    redis=Depends(get_redis),
):
    if symbol not in settings.symbols:
        raise HTTPException(status_code=404, detail=f"Unknown symbol: {symbol}")

    key = f"candles:{symbol}:{interval}"
    # ZRANGE returns elements from lowest to highest score; fetch last `limit`
    raw_entries = await redis.zrange(key, -limit, -1)

    candles = []
    for entry in raw_entries:
        try:
            candles.append(json.loads(entry))
        except (json.JSONDecodeError, TypeError):
            pass

    return {"symbol": symbol, "interval": interval, "candles": candles}


@router.get("/ticker/{symbol}")
async def get_ticker(symbol: str, redis=Depends(get_redis)):
    if symbol not in settings.symbols:
        raise HTTPException(status_code=404, detail=f"Unknown symbol: {symbol}")

    price_data = await redis.hgetall(f"price:{symbol}")
    if not price_data:
        raise HTTPException(status_code=404, detail="No price data yet")

    return {
        "symbol":    symbol,
        "price":     float(price_data.get("price", 0)),
        "timestamp": int(price_data.get("timestamp", 0)),
        "volume":    float(price_data.get("volume", 0)),
    }


@router.get("/portfolio")
async def get_portfolio(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
    redis=Depends(get_redis),
):
    user_id = current_user["user_id"]
    rows = await db.fetch(
        "SELECT symbol, quantity, avg_cost FROM portfolios WHERE user_id=$1 AND quantity > 0",
        user_id,
    )

    result = []
    for row in rows:
        item = dict(row)
        price_data = await redis.hgetall(f"price:{row['symbol']}")
        if price_data:
            item["current_price"] = float(price_data.get("price", 0))
        result.append(item)

    return result


@router.get("/trades/{symbol}")
async def get_recent_trades(
    symbol: str,
    limit: int = Query(50, ge=1, le=500),
    db=Depends(get_db),
):
    if symbol not in settings.symbols:
        raise HTTPException(status_code=404, detail=f"Unknown symbol: {symbol}")

    rows = await db.fetch(
        """
        SELECT price, quantity, buyer_id, seller_id, timestamp
        FROM trades
        WHERE symbol=$1
        ORDER BY timestamp DESC
        LIMIT $2
        """,
        symbol, limit,
    )
    return [dict(r) for r in rows]
