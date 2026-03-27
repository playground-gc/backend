import time
import uuid
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import get_current_user
from app.database import get_db
from app.engine_client import get_engine_pool
from app.schemas import OrderDetail, OrderRequest, OrderResponse, OrderStatus
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
    """
    Place a limit or market order.

    - **limit**: specify `price`; order rests on the book until filled or cancelled.
    - **market**: omit `price`; order executes immediately at best available price
      and **cannot be cancelled** after submission.
    """
    if body.symbol not in settings.symbols:
        raise HTTPException(status_code=400, detail=f"Unknown symbol: {body.symbol}")

    order_id = str(uuid.uuid4())
    user_id  = current_user["user_id"]

    # Persist order immediately so the client has a reference ID.
    # Status starts as 'open'; the matching engine updates it asynchronously
    # via trade events published to Redis.
    try:
        await db.execute(
            """
            INSERT INTO orders (id, user_id, symbol, order_type, side, price, quantity, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')
            """,
            order_id,
            user_id,
            body.symbol,
            body.order_type.value,
            body.side.value,
            body.price,
            body.quantity,
        )
    except Exception as e:
        log.error("DB insert failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to save order")

    # Forward to the matching engine (fire-and-forget over TCP).
    # The engine wire format uses "type" as the key name.
    engine_msg = {
        "action":    "place",
        "order_id":  order_id,
        "user_id":   user_id,
        "symbol":    body.symbol,
        "type":      body.order_type.value,
        "side":      body.side.value,
        "price":     body.price,
        "quantity":  body.quantity,
        "timestamp": int(time.time() * 1000),
    }
    try:
        await engine.send_order(engine_msg)
    except Exception as e:
        await db.execute(
            "UPDATE orders SET status='failed' WHERE id=$1", order_id
        )
        log.error("Engine send failed: %s", e)
        raise HTTPException(status_code=503, detail="Matching engine unavailable")

    return OrderResponse(
        order_id=order_id,
        status="submitted",
        symbol=body.symbol,
        order_type=body.order_type.value,
        side=body.side.value,
        price=body.price,
        quantity=body.quantity,
    )


@router.get("/orders/{order_id}", response_model=OrderDetail)
async def get_order(
    order_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """Fetch a single order by ID. Only the owning user may retrieve it."""
    user_id = current_user["user_id"]
    row = await db.fetchrow(
        """
        SELECT id, symbol, order_type, side, price, quantity, filled_qty,
               status, created_at, updated_at
        FROM orders
        WHERE id = $1 AND user_id = $2
        """,
        order_id,
        user_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Order not found")
    return dict(row)


@router.delete("/orders/{order_id}", status_code=200)
async def cancel_order(
    order_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
    engine=Depends(get_engine_pool),
):
    """
    Cancel an open limit order.

    Market orders execute immediately (IOC) and **cannot be cancelled**.
    Returns 409 if the order is already filled, cancelled, or failed.
    """
    user_id = current_user["user_id"]

    row = await db.fetchrow(
        "SELECT symbol, status, order_type FROM orders WHERE id = $1 AND user_id = $2",
        order_id,
        user_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Order not found")

    # Terminal states – nothing to cancel.
    if row["status"] in ("filled", "cancelled", "failed"):
        raise HTTPException(status_code=409, detail=f"Order already {row['status']}")

    # Market orders are immediate-or-cancel; they never rest on the book.
    if row["order_type"] == "market":
        raise HTTPException(
            status_code=400,
            detail="Market orders execute immediately and cannot be cancelled",
        )

    await db.execute(
        "UPDATE orders SET status = 'cancelled' WHERE id = $1", order_id
    )

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


@router.get("/orders", response_model=list[OrderDetail])
async def list_orders(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
    symbol: Optional[str] = None,
    status: Optional[OrderStatus] = None,
    limit: int = Query(default=50, ge=1, le=100),
):
    """
    List orders for the authenticated user.

    - `symbol`: filter by stock symbol (e.g. `AAPL_S`)
    - `status`: filter by order status (`open`, `partial`, `filled`, `cancelled`, `failed`)
    - `limit`: maximum results to return (1–100, default 50)
    """
    user_id = current_user["user_id"]
    query = """
        SELECT id, symbol, order_type, side, price, quantity, filled_qty,
               status, created_at, updated_at
        FROM orders
        WHERE user_id = $1
    """
    params: list = [user_id]

    if symbol:
        params.append(symbol)
        query += f" AND symbol = ${len(params)}"
    if status:
        params.append(status.value)
        query += f" AND status = ${len(params)}"

    params.append(limit)
    query += f" ORDER BY created_at DESC LIMIT ${len(params)}"

    rows = await db.fetch(query, *params)
    return [dict(r) for r in rows]
