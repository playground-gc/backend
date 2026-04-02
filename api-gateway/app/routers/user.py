"""
User-centric endpoints:
  GET /api/v1/me               – profile, cash balance, portfolio summary, total P&L
  GET /api/v1/my/trades        – the user's own executed trades (buyer or seller)
  GET /api/v1/my/balance-history – full ledger of every balance change
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.auth import get_current_user
from app.database import get_db
from app.redis_client import get_redis

router = APIRouter(prefix="/api/v1", tags=["user"])
log = logging.getLogger(__name__)


# ─── /me ──────────────────────────────────────────────────────────────────────

@router.get("/me")
async def get_me(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
    redis=Depends(get_redis),
):
    """
    Return the authenticated user's full account snapshot:
    - username, email, cash balance
    - portfolio holdings with current price + unrealized P&L per position
    - total portfolio market value and total unrealized P&L
    - total account value = cash + portfolio market value
    """
    user_id = current_user["user_id"]

    user_row = await db.fetchrow(
        "SELECT id, username, email, balance, created_at FROM users WHERE id = $1",
        user_id,
    )
    if not user_row:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="User not found")

    balance = float(user_row["balance"])

    # Load portfolio positions
    port_rows = await db.fetch(
        "SELECT symbol, quantity, avg_cost FROM portfolios WHERE user_id = $1 AND quantity != 0",
        user_id,
    )

    total_unrealized_pnl  = 0.0
    total_portfolio_value = 0.0
    portfolio = []

    for row in port_rows:
        sym      = row["symbol"]
        qty      = float(row["quantity"])
        avg_cost = float(row["avg_cost"])

        current_price = None
        price_data = await redis.hgetall(f"price:{sym}")
        if price_data:
            current_price = float(price_data.get("price", 0) or 0)

        market_value   = (current_price * qty) if current_price else 0.0
        unrealized_pnl = ((current_price - avg_cost) * qty) if current_price else 0.0

        total_portfolio_value += market_value
        total_unrealized_pnl  += unrealized_pnl

        portfolio.append({
            "symbol":         sym,
            "quantity":       qty,
            "avg_cost":       avg_cost,
            "current_price":  current_price,
            "market_value":   round(market_value, 2),
            "unrealized_pnl": round(unrealized_pnl, 2),
            "pnl_pct":        round((unrealized_pnl / abs(avg_cost * qty) * 100), 2)
                              if avg_cost and qty else 0.0,
        })

    return {
        "user_id":               str(user_row["id"]),
        "username":              user_row["username"],
        "email":                 user_row["email"],
        "cash_balance":          round(balance, 2),
        "portfolio":             portfolio,
        "total_portfolio_value": round(total_portfolio_value, 2),
        "total_unrealized_pnl":  round(total_unrealized_pnl, 2),
        "total_account_value":   round(balance + total_portfolio_value, 2),
        "created_at":            user_row["created_at"].isoformat(),
    }


# ─── /my/trades ───────────────────────────────────────────────────────────────

@router.get("/my/trades")
async def get_my_trades(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
    symbol: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=500),
):
    """
    Return all trades the authenticated user participated in (as buyer or seller).
    Each trade shows:
      - role: 'buy' or 'sell'
      - price, quantity, total cost/proceeds
      - counterparty is deliberately omitted (privacy)
    """
    user_id = current_user["user_id"]

    query = """
        SELECT
            id,
            symbol,
            price,
            quantity,
            buyer_id,
            seller_id,
            buy_order_id,
            sell_order_id,
            timestamp
        FROM trades
        WHERE (buyer_id = $1 OR seller_id = $1)
    """
    params: list = [user_id]

    if symbol:
        params.append(symbol)
        query += f" AND symbol = ${len(params)}"

    params.append(limit)
    query += f" ORDER BY timestamp DESC LIMIT ${len(params)}"

    rows = await db.fetch(query, *params)

    result = []
    for r in rows:
        price    = float(r["price"])
        qty      = float(r["quantity"])
        is_buyer = str(r["buyer_id"]) == user_id
        side     = "buy" if is_buyer else "sell"
        cost     = round(price * qty, 2)
        result.append({
            "trade_id":  str(r["id"]),
            "symbol":    r["symbol"],
            "side":      side,
            "price":     price,
            "quantity":  qty,
            "total":     cost,            # cost if buy, proceeds if sell
            "order_id":  str(r["buy_order_id"] if is_buyer else r["sell_order_id"]),
            "timestamp": r["timestamp"].isoformat(),
        })

    return result


# ─── /my/balance-history ──────────────────────────────────────────────────────

@router.get("/my/balance-history")
async def get_balance_history(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
    limit: int = Query(default=50, ge=1, le=500),
):
    """
    Full ledger of every cash balance change for the authenticated user —
    like Codeforces rating history but for your trading account balance.

    Each entry shows:
      - delta   : change amount (negative = spent on buy, positive = received from sell)
      - balance : running cash balance AFTER this event
      - reason  : 'trade_buy' or 'trade_sell'
      - symbol, quantity, price : what was traded
    """
    user_id = current_user["user_id"]

    rows = await db.fetch(
        """
        SELECT id, delta, balance, reason, symbol, quantity, price, trade_id, created_at
        FROM balance_history
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
        """,
        user_id, limit,
    )

    return [
        {
            "id":         str(r["id"]),
            "delta":      float(r["delta"]),
            "balance":    float(r["balance"]),
            "reason":     r["reason"],
            "symbol":     r["symbol"],
            "quantity":   float(r["quantity"]) if r["quantity"] else None,
            "price":      float(r["price"])    if r["price"]    else None,
            "trade_id":   str(r["trade_id"])   if r["trade_id"] else None,
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]
