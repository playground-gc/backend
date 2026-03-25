# API Reference — Synthetic-Bull Backend

## Overview

| Service | Protocol | Default Port |
|---------|----------|-------------|
| API Gateway | HTTP REST | 8000 |
| WebSocket Service | WebSocket | 8001 |
| Matching Engine | TCP (internal) | 9000 |

Base URL for REST: `http://localhost:8000`
Base URL for WebSocket: `ws://localhost:8001`

---

## Authentication

Protected endpoints require a JWT Bearer token in the `Authorization` header:

```
Authorization: Bearer <access_token>
```

Tokens are obtained from `/api/v1/auth/register` or `/api/v1/auth/login`.

---

## REST API

### Auth

#### POST `/api/v1/auth/register`

Register a new user account.

**Request body:**
```json
{
  "username": "string (3–50 chars)",
  "email": "string",
  "password": "string (min 6 chars)"
}
```

**Response `201`:**
```json
{
  "access_token": "string",
  "token_type": "bearer",
  "user_id": "string (UUID)",
  "username": "string"
}
```

---

#### POST `/api/v1/auth/login`

Authenticate and receive a JWT token.

**Request body:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Response `200`:**
```json
{
  "access_token": "string",
  "token_type": "bearer",
  "user_id": "string (UUID)",
  "username": "string"
}
```

---

### Orders

#### POST `/api/v1/orders` — Auth required

Place a new order. Market orders are matched immediately; limit orders rest on the book.

**Request body:**
```json
{
  "symbol": "string (e.g. AAPL_S)",
  "type": "limit | market",
  "side": "buy | sell",
  "price": "number (required for limit; omit for market)",
  "quantity": "number (> 0)"
}
```

**Response `201`:**
```json
{
  "order_id": "string (UUID)",
  "status": "submitted"
}
```

**Errors:** `400` unknown symbol / invalid format · `503` matching engine unavailable

---

#### DELETE `/api/v1/orders/{order_id}` — Auth required

Cancel an open order.

**Response `200`:**
```json
{
  "order_id": "string",
  "status": "cancelled"
}
```

**Errors:** `404` not found or not owned by caller · `409` already filled/cancelled/failed

---

#### GET `/api/v1/orders` — Auth required

List the authenticated user's orders.

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `symbol` | string | — | Filter by symbol |
| `status` | string | — | `open` · `partial` · `filled` · `cancelled` · `failed` |
| `limit` | integer | 50 | Max results (capped at 50) |

**Response `200`:**
```json
[
  {
    "id": "string (UUID)",
    "symbol": "string",
    "order_type": "limit | market",
    "side": "buy | sell",
    "price": "number | null",
    "quantity": "number",
    "filled_qty": "number",
    "status": "string",
    "created_at": "timestamp"
  }
]
```

---

### Market Data

#### GET `/api/v1/stocks`

List all configured stock symbols and their GBM parameters.

**Response `200`:**
```json
[
  {
    "symbol": "string",
    "initial_price": "number",
    "drift": "number",
    "volatility": "number"
  }
]
```

---

#### GET `/api/v1/orderbook/{symbol}`

Current order book snapshot (top 20 levels, cached with 5 s TTL).

**Response `200`:**
```json
{
  "event": "orderbook",
  "symbol": "string",
  "timestamp": "number (ms)",
  "bids": [[price, qty], ...],
  "asks": [[price, qty], ...]
}
```

**Errors:** `404` unknown symbol or no data yet

---

#### GET `/api/v1/candles/{symbol}`

OHLCV candles aggregated from executed trades.

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `interval` | string | `1m` | `1s` · `10s` · `1m` |
| `limit` | integer | 100 | Number of candles (1–1000) |

**Response `200`:**
```json
{
  "symbol": "string",
  "interval": "string",
  "candles": [
    {
      "open": "number",
      "high": "number",
      "low": "number",
      "close": "number",
      "volume": "number",
      "timestamp": "number (ms, bucket start)"
    }
  ]
}
```

**Errors:** `404` unknown symbol

---

#### GET `/api/v1/ticker/{symbol}`

Last traded price and volume.

**Response `200`:**
```json
{
  "symbol": "string",
  "price": "number",
  "timestamp": "number (ms)",
  "volume": "number"
}
```

**Errors:** `404` unknown symbol or no price data

---

#### GET `/api/v1/trades/{symbol}`

Recent executed trades.

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | 50 | Max trades (1–500) |

**Response `200`:**
```json
[
  {
    "price": "number",
    "quantity": "number",
    "buyer_id": "string (UUID)",
    "seller_id": "string (UUID)",
    "timestamp": "number (ms)"
  }
]
```

**Errors:** `404` unknown symbol

---

### Portfolio

#### GET `/api/v1/portfolio` — Auth required

User's current holdings (positions with quantity > 0).

**Response `200`:**
```json
[
  {
    "symbol": "string",
    "quantity": "number",
    "avg_cost": "number",
    "current_price": "number"
  }
]
```

---

### Health

#### GET `/health`

**Response `200`:**
```json
{
  "status": "ok",
  "symbols": ["AAPL_S", "GOOGL_S", "..."]
}
```

---

## WebSocket API

### `ws://host:8001/ws/{symbol}` — Market updates stream

Real-time trades, order book snapshots, and candle events for a symbol.

**Default subscriptions on connect:** `trades`, `orderbook`, `candles:1m`

**Subscribe to additional channels** by sending:
```json
{
  "subscribe": ["trades", "orderbook", "candles:1s", "candles:10s", "candles:1m"]
}
```

**Incoming messages:**

<details>
<summary>Trade event</summary>

```json
{
  "event": "trade",
  "trade_id": "string (UUID)",
  "symbol": "string",
  "price": "number",
  "quantity": "number",
  "buy_order_id": "string",
  "sell_order_id": "string",
  "buyer_id": "string",
  "seller_id": "string",
  "timestamp": "number (ms)"
}
```
</details>

<details>
<summary>Order book snapshot</summary>

```json
{
  "event": "orderbook",
  "symbol": "string",
  "timestamp": "number (ms)",
  "bids": [[price, qty], ...],
  "asks": [[price, qty], ...]
}
```
</details>

<details>
<summary>Candle closed</summary>

```json
{
  "event": "candle",
  "symbol": "string",
  "interval": "1s | 10s | 1m",
  "open": "number",
  "high": "number",
  "low": "number",
  "close": "number",
  "volume": "number",
  "timestamp": "number (ms, bucket start)"
}
```
</details>

<details>
<summary>Keepalive ping (every 30 s)</summary>

```json
{ "type": "ping" }
```
</details>

---

### `ws://host:8001/ws/market/{symbol}` — Raw GBM L2 stream

Raw Level 2 order book snapshots generated by the market generator at 100 ticks/sec (every 10 ms). No subscription message required.

**Incoming message:**
```json
{
  "type": "market_data",
  "symbol": "string",
  "tick": "integer",
  "ts": "number (ms)",
  "mid": "number",
  "spread": "number",
  "spread_pct": "number",
  "asks": [{ "price": "number", "size": "integer" }, ...],
  "bids": [{ "price": "number", "size": "integer" }, ...]
}
```

`asks` are ordered lowest→highest; `bids` are ordered highest→lowest (best price first on both sides).

---

## Quick Reference

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| POST | `/api/v1/auth/register` | | Register user |
| POST | `/api/v1/auth/login` | | Login |
| POST | `/api/v1/orders` | ✓ | Place order |
| DELETE | `/api/v1/orders/{id}` | ✓ | Cancel order |
| GET | `/api/v1/orders` | ✓ | List orders |
| GET | `/api/v1/stocks` | | List symbols |
| GET | `/api/v1/orderbook/{symbol}` | | Order book snapshot |
| GET | `/api/v1/candles/{symbol}` | | OHLCV candles |
| GET | `/api/v1/ticker/{symbol}` | | Last price |
| GET | `/api/v1/trades/{symbol}` | | Recent trades |
| GET | `/api/v1/portfolio` | ✓ | Portfolio holdings |
| GET | `/health` | | Health check |
| WS | `ws://…/ws/{symbol}` | | Trades · book · candles stream |
| WS | `ws://…/ws/market/{symbol}` | | Raw GBM L2 stream (100 Hz) |
