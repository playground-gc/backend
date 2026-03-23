import time
import uuid
import logging

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import get_db
from app.engine_client import get_engine_pool
from app.schemas import OrderRequest, OrderResponse
from app.config import settings

router = APIRouter(prefix="/api/v1", tags=["orders"])
log = logging.getLogger(__name__)


@router.post("/orders", response_model=OrderResponse, status_code=201)
async def place_order(
    body: OrderRequest,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
    engine=Depends(get_engine_pool),
):
    # Validate symbol
    if body.symbol not in settings.symbols:
        raise HTTPException(status_code=400, detail=f"Unknown symbol: {body.symbol}")

    # Validate limit order has a price
    if body.type == "limit" and (body.price is None or body.price <= 0):
        raise HTTPException(status_code=400, detail="Limit orders require a positive price")

    order_id = str(uuid.uuid4())
    user_id  = current_user["user_id"]

    # Persist order with status='open'
    try:
        await db.execute(
            """
            INSERT INTO orders (id, user_id, symbol, order_type, side, price, quantity, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')
            """,
            order_id, user_id, body.symbol,
            body.type, body.side, body.price, body.quantity,
        )
    except Exception as e:
        log.error("DB insert failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to save order")

    # Forward to matching engine (fire-and-forget)
    engine_msg = {
        "action":    "place",
        "order_id":  order_id,
        "user_id":   user_id,
        "symbol":    body.symbol,
        "type":      body.type,
        "side":      body.side,
        "price":     body.price,
        "quantity":  body.quantity,
        "timestamp": int(time.time() * 1000),
    }
    try:
        await engine.send_order(engine_msg)
    except Exception as e:
        # Mark order as failed in DB but don't crash
        await db.execute(
            "UPDATE orders SET status='failed' WHERE id=$1", order_id
        )
        log.error("Engine send failed: %s", e)
        raise HTTPException(status_code=503, detail="Matching engine unavailable")

    return OrderResponse(order_id=order_id, status="submitted")


@router.delete("/orders/{order_id}", status_code=200)
async def cancel_order(
    order_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
    engine=Depends(get_engine_pool),
):
    user_id = current_user["user_id"]

    # Verify the order belongs to this user
    row = await db.fetchrow(
        "SELECT symbol, status FROM orders WHERE id=$1 AND user_id=$2",
        order_id, user_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Order not found")
    if row["status"] in ("filled", "cancelled", "failed"):
        raise HTTPException(status_code=409, detail=f"Order already {row['status']}")

    # Update DB
    await db.execute(
        "UPDATE orders SET status='cancelled' WHERE id=$1", order_id
    )

    # Notify matching engine
    cancel_msg = {
        "action":   "cancel",
        "order_id": order_id,
        "symbol":   row["symbol"],
        "user_id":  user_id,
    }
    try:
        await engine.send_order(cancel_msg)
    except Exception as e:
        log.warning("Engine cancel send failed: %s", e)

    return {"order_id": order_id, "status": "cancelled"}


@router.get("/orders")
async def list_orders(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
    symbol: str | None = None,
    status: str | None = None,
    limit: int = 50,
):
    user_id = current_user["user_id"]
    query = "SELECT id, symbol, order_type, side, price, quantity, filled_qty, status, created_at FROM orders WHERE user_id=$1"
    params = [user_id]

    if symbol:
        params.append(symbol)
        query += f" AND symbol=${len(params)}"
    if status:
        params.append(status)
        query += f" AND status=${len(params)}"

    params.append(limit)
    query += f" ORDER BY created_at DESC LIMIT ${len(params)}"

    rows = await db.fetch(query, *params)
    return [dict(r) for r in rows]
