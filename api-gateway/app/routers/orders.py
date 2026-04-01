import json
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import get_current_user
from app.config import settings
from app.database import get_db
from app.engine_client import get_engine_pool
from app.redis_client import get_redis
from app.schemas import (
    OrderDetail,
    OrderRequest,
    OrderResponse,
    OrderStatus,
    StopOrderResponse,
)

router = APIRouter(prefix="/api/v1", tags=["orders"])
log = logging.getLogger(__name__)

_STOP_TYPES = {"stop_limit", "stop_market"}


# ─── Place order ───────────────────────────────────────────────────────────────


@router.post("/orders", status_code=201)
async def place_order(
    body: OrderRequest,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
    engine=Depends(get_engine_pool),
):
    """
    Place a limit, market, stop_limit, or stop_market order.

    - **limit**: specify `price`; order rests on the book until filled or cancelled.
    - **market**: omit `price`; order executes immediately at best available price
      and **cannot be cancelled** after submission.
    - **stop_limit**: specify `stop_price` and `limit_price`; persisted server-side until triggered.
    - **stop_market**: specify `stop_price`; persisted server-side until triggered.
    """
    if body.symbol not in settings.symbols:
        raise HTTPException(status_code=400, detail=f"Unknown symbol: {body.symbol}")

    user_id = current_user["user_id"]
    order_id = str(uuid.uuid4())

    if body.side.value == "sell":
        # Check short selling limit
        row = await db.fetchrow(
            "SELECT quantity FROM portfolios WHERE user_id = $1 AND symbol = $2",
            user_id,
            body.symbol,
        )
        current_qty = row["quantity"] if row else 0.0

        # Calculate active sell orders quantity
        active_sells = await db.fetchval(
            "SELECT COALESCE(SUM(quantity - filled_qty), 0) FROM orders "
            "WHERE user_id = $1 AND symbol = $2 AND side = 'sell' AND status IN ('open', 'partial', 'pending_trigger')",
            user_id,
            body.symbol,
        )

        if current_qty - active_sells - body.quantity < -settings.MAX_SHORT_INVENTORY:
            raise HTTPException(
                status_code=400,
                detail=f"Short selling limit exceeded. Max allowed short position is {settings.MAX_SHORT_INVENTORY}.",
            )

    # ── Stop orders ────────────────────────────────────────────────────────────
    if body.order_type.value in _STOP_TYPES:
        expires_at = datetime.now(timezone.utc) + timedelta(days=30)

        try:
            await db.execute(
                """
                INSERT INTO orders
                    (id, user_id, symbol, order_type, side, stop_price, limit_price,
                     quantity, status, expires_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending_trigger',$9)
                """,
                order_id,
                user_id,
                body.symbol,
                body.order_type.value,
                body.side.value,
                body.stop_price,
                body.limit_price,
                body.quantity,
                expires_at,
            )
        except Exception as e:
            log.error("DB insert failed for stop order: %s", e)
            raise HTTPException(status_code=500, detail="Failed to save stop order")

        # Notify trigger engine via Redis after DB commit
        try:
            redis = await get_redis()
            payload = json.dumps(
                {
                    "order_id": order_id,
                    "user_id": user_id,
                    "symbol": body.symbol,
                    "side": body.side.value,
                    "type": body.order_type.value,
                    "stop_price": body.stop_price,
                    "limit_price": body.limit_price or 0.0,
                    "quantity": body.quantity,
                    "expires_at": expires_at.isoformat(),
                }
            )
            await redis.publish("stop_orders:new", payload)
        except Exception as e:
            log.warning("Redis publish for stop order failed: %s", e)
            # Non-fatal: trigger engine will recover from DB on restart

        return StopOrderResponse(
            order_id=order_id,
            status="pending_trigger",
            stop_price=body.stop_price,
            expires_at=expires_at.isoformat(),
        )

    # ── Limit / Market orders (existing behaviour) ─────────────────────────────
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
        "action": "place",
        "order_id": order_id,
        "user_id": user_id,
        "symbol": body.symbol,
        "type": body.order_type.value,
        "side": body.side.value,
        "price": body.price,
        "quantity": body.quantity,
        "timestamp": int(time.time() * 1000),
    }
    try:
        await engine.send_order(engine_msg)
    except Exception as e:
        await db.execute("UPDATE orders SET status='failed' WHERE id=$1", order_id)
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
        SELECT id, symbol, order_type, side, price, stop_price, limit_price,
               quantity, filled_qty, status, expires_at, created_at, updated_at
        FROM orders
        WHERE id = $1 AND user_id = $2
        """,
        order_id,
        user_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Order not found")
    return dict(row)


# ─── Cancel order ──────────────────────────────────────────────────────────────


@router.delete("/orders/{order_id}", status_code=200)
async def cancel_order(
    order_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
    engine=Depends(get_engine_pool),
):
    """
    Cancel an open limit or stop order.

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

    await db.execute("UPDATE orders SET status = 'cancelled' WHERE id = $1", order_id)

    if row["status"] == "pending_trigger":
        # Order was never sent to the matching engine; notify trigger engine to drop it
        try:
            redis = await get_redis()
            payload = json.dumps(
                {
                    "order_id": order_id,
                    "symbol": row["symbol"],
                    "user_id": user_id,
                }
            )
            await redis.publish("stop_orders:cancel", payload)
        except Exception as e:
            log.warning("Redis publish for stop cancel failed: %s", e)
        return {"order_id": order_id, "status": "cancelled"}

    # For open / partial / triggered orders: notify matching engine
    cancel_msg = {
        "action": "cancel",
        "order_id": order_id,
        "symbol": row["symbol"],
        "user_id": user_id,
    }
    try:
        await engine.send_order(cancel_msg)
    except Exception as e:
        log.warning("Engine cancel send failed: %s", e)

    return {"order_id": order_id, "status": "cancelled"}


# ─── List orders ───────────────────────────────────────────────────────────────


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
    - `status`: filter by order status (`open`, `partial`, `filled`, `cancelled`, `failed`, `pending_trigger`, `triggered`)
    - `limit`: maximum results to return (1–100, default 50)
    """
    user_id = current_user["user_id"]
    query = (
        "SELECT id, symbol, order_type, side, price, stop_price, limit_price, "
        "quantity, filled_qty, status, expires_at, created_at, updated_at "
        "FROM orders WHERE user_id=$1"
    )
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
