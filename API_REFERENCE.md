# API Reference — Synthetic-Bull Backend

> **Hosted backend:** `https://opensoft-backend.duckdns.org`
> **WebSocket service:** `wss://opensoft-backend.duckdns.org` (port 8001 — adjust if proxied)

---

## Service Overview

| Service | Protocol | Port | Purpose |
|---------|----------|------|---------|
| API Gateway | HTTPS REST | 8000 | Auth, orders, market data, user account |
| WebSocket Service | WSS | 8001 | Real-time trades, order book, candles, stop-order events |
| Matching Engine | TCP (internal) | 9000 | C++ order matching — not directly accessible |

---

## Authentication

All endpoints marked **Auth required** need a JWT Bearer token:

```
Authorization: Bearer <access_token>
```

Tokens are obtained from `/api/v1/auth/register` or `/api/v1/auth/login`.
Tokens expire after **24 hours**. The `user_id` in the token payload is a UUID used to connect the personal WebSocket stream.

---

## REST API

### Auth

---

#### `POST /api/v1/auth/register`

Register a new user. Returns an access token immediately — no separate login step needed.

**Request body:**
```json
{
  "username": "string  (3–50 characters)",
  "email":    "string  (valid email)",
  "password": "string  (min 6 characters)"
}
```

**Response `201`:**
```json
{
  "access_token": "string  (JWT)",
  "token_type":   "bearer",
  "user_id":      "string  (UUID — save this for WS connections)",
  "username":     "string"
}
```

**Errors:**
- `409` — username or email already taken

---

#### `POST /api/v1/auth/login`

Authenticate an existing user.

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
  "access_token": "string  (JWT)",
  "token_type":   "bearer",
  "user_id":      "string  (UUID)",
  "username":     "string"
}
```

**Errors:**
- `401` — invalid credentials

---

### User Account

---

#### `GET /api/v1/me` — Auth required

Full account snapshot in a single call. Combines profile, cash balance, every open position with live P&L, and total account value. This is the primary endpoint for a dashboard/header component.

**Response `200`:**
```json
{
  "user_id":               "string (UUID)",
  "username":              "string",
  "email":                 "string",
  "cash_balance":          180234.50,
  "portfolio": [
    {
      "symbol":         "AAPL_S",
      "quantity":       15.0,
      "avg_cost":       179.93,
      "current_price":  182.10,
      "market_value":   2731.50,
      "unrealized_pnl": 32.55,
      "pnl_pct":        1.21
    }
  ],
  "total_portfolio_value": 2731.50,
  "total_unrealized_pnl":  32.55,
  "total_account_value":   182966.00,
  "created_at":            "2026-03-30T10:00:00+00:00"
}
```

**Field notes:**
- `cash_balance` — uninvested cash remaining
- `avg_cost` — volume-weighted average purchase price for the position
- `unrealized_pnl` — `(current_price − avg_cost) × quantity`; negative = loss
- `pnl_pct` — unrealized P&L as a percentage of cost basis
- `total_account_value` — `cash_balance + total_portfolio_value` (what the account is worth right now)

**Errors:**
- `401` — missing/invalid token

---

#### `GET /api/v1/my/trades` — Auth required

Personal trade history — every trade the user was involved in as buyer or seller, ordered newest first.

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `symbol` | string | — | Filter to a single symbol, e.g. `AAPL_S` |
| `limit` | integer | 50 | Max results (1–500) |

**Response `200`:**
```json
[
  {
    "trade_id":  "string (UUID)",
    "symbol":    "AAPL_S",
    "side":      "buy",
    "price":     179.93,
    "quantity":  10.0,
    "total":     1799.30,
    "order_id":  "string (UUID — the user's order that matched)",
    "timestamp": "2026-03-30T22:45:00+00:00"
  }
]
```

**Field notes:**
- `side` — `"buy"` if the user was the buyer, `"sell"` if they were the seller
- `total` — cost if buy (`price × qty` deducted from balance), proceeds if sell (added to balance)
- Counterparty identity is intentionally omitted

---

#### `GET /api/v1/my/balance-history` — Auth required

Full ledger of every cash balance change — like a bank statement. Each entry is one trade execution that moved cash.

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | 50 | Max results (1–500) |

**Response `200`:**
```json
[
  {
    "id":         "string (UUID)",
    "delta":      -1799.30,
    "balance":    98200.70,
    "reason":     "trade_buy",
    "symbol":     "AAPL_S",
    "quantity":   10.0,
    "price":      179.93,
    "trade_id":   "string (UUID) | null",
    "created_at": "2026-03-30T22:45:00+00:00"
  }
]
```

**Field notes:**
- `delta` — signed change: **negative** = cash spent (buy), **positive** = cash received (sell)
- `balance` — running balance **after** this event (use to draw a balance timeline)
- `reason` — `"trade_buy"` or `"trade_sell"`
- Results are ordered newest-first

---

### Orders

---

#### `POST /api/v1/orders` — Auth required

Place a new order. Supports four order types:

| Type | `price` | `stop_price` | `limit_price` | Behaviour |
|------|---------|-------------|--------------|-----------|
| `limit` | required | — | — | Rests on the book at the given price until filled or cancelled |
| `market` | omit | — | — | Executes immediately at the best available price; cannot be cancelled |
| `stop_limit` | — | required | required | Server-held; when price crosses `stop_price`, submits a limit order at `limit_price` |
| `stop_market` | — | required | — | Server-held; when price crosses `stop_price`, submits a market order |

Stop orders persist across client disconnects (held by the backend trigger engine until they fire or are cancelled).

**Request body:**
```json
{
  "symbol":      "AAPL_S",
  "type":        "limit | market | stop_limit | stop_market",
  "side":        "buy | sell",
  "price":       179.50,
  "stop_price":  175.00,
  "limit_price": 174.80,
  "quantity":    10
}
```

**Stop order trigger conditions:**

| Side | Triggers when |
|------|--------------|
| `sell` | Market price falls **to or below** `stop_price` |
| `buy` | Market price rises **to or above** `stop_price` |

**Response `201` — limit / market:**
```json
{
  "order_id":   "string (UUID)",
  "status":     "submitted",
  "symbol":     "AAPL_S",
  "order_type": "limit",
  "side":       "buy",
  "price":      179.50,
  "quantity":   10.0
}
```

**Response `201` — stop_limit / stop_market:**
```json
{
  "order_id":   "string (UUID)",
  "status":     "pending_trigger",
  "stop_price": 175.00,
  "expires_at": "2026-04-29T22:45:00+00:00"
}
```

**Validation errors `422`:**
- `limit` order without `price`
- `market` order with a `price` field present
- `stop_limit` or `stop_market` without `stop_price`
- `stop_limit` without `limit_price`
- `quantity` ≤ 0

**Other errors:**
- `400` — unknown symbol
- `503` — matching engine unavailable

---

#### `GET /api/v1/orders/{order_id}` — Auth required

Fetch a single order by ID. Only the owning user may retrieve it.

**Response `200`:**
```json
{
  "id":          "string (UUID)",
  "symbol":      "AAPL_S",
  "order_type":  "limit",
  "side":        "buy",
  "price":       179.50,
  "stop_price":  null,
  "limit_price": null,
  "quantity":    10.0,
  "filled_qty":  10.0,
  "status":      "filled",
  "expires_at":  null,
  "created_at":  "2026-03-30T22:44:00+00:00",
  "updated_at":  "2026-03-30T22:45:00+00:00"
}
```

**Order status lifecycle:**

```
open ──▶ partial ──▶ filled
  │
  └──▶ cancelled
  └──▶ failed

pending_trigger ──▶ triggered ──▶ open ──▶ ...
        └──▶ cancelled
```

| Status | Meaning |
|--------|---------|
| `open` | Resting on the book, no fills yet |
| `partial` | Some quantity filled, remainder still on the book |
| `filled` | Fully matched |
| `cancelled` | Cancelled by the user or expired |
| `failed` | Rejected by the matching engine |
| `pending_trigger` | Stop order waiting for price condition |
| `triggered` | Stop price crossed; a new market/limit order submitted |

**Errors:**
- `404` — order not found or belongs to another user

---

#### `GET /api/v1/orders` — Auth required

List the authenticated user's orders, newest first.

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `symbol` | string | — | Filter by symbol, e.g. `AAPL_S` |
| `status` | string | — | `open` · `partial` · `filled` · `cancelled` · `failed` · `pending_trigger` · `triggered` |
| `limit` | integer | 50 | Max results (1–100) |

**Response `200`:** array of order objects (same shape as single-order GET above)

---

#### `DELETE /api/v1/orders/{order_id}` — Auth required

Cancel an order.

| Current status | Behaviour |
|----------------|-----------|
| `open` / `partial` / `triggered` | Forwarded to the matching engine for cancellation |
| `pending_trigger` | Removed from the trigger engine immediately; never reaches the matching engine |
| `market` order (any status) | `400` — market orders cannot be cancelled |

**Response `200`:**
```json
{
  "order_id": "string (UUID)",
  "status":   "cancelled"
}
```

**Errors:**
- `400` — attempted to cancel a market order
- `404` — not found or not owned by caller
- `409` — already `filled`, `cancelled`, or `failed`

---

### Market Data

All market data endpoints are **public** (no auth required).

---

#### `GET /api/v1/stocks`

List all tradeable symbols and their simulation parameters.

**Response `200`:**
```json
[
  {
    "symbol":        "AAPL_S",
    "name":          "Apple Inc.",
    "initial_price": 180.0,
    "drift":         0.0,
    "volatility":    0.5
  }
]
```

Available symbols: `AAPL_S`, `GOOGL_S`, `TSLA_S`, `MSFT_S`, `AMZN_S`

---

#### `GET /api/v1/ticker/{symbol}`

Last traded price for a symbol.

**Response `200`:**
```json
{
  "symbol":    "AAPL_S",
  "price":     179.93,
  "timestamp": 1774911548000,
  "volume":    7.0
}
```

**Errors:**
- `404` — unknown symbol or no price data yet (system still warming up)

---

#### `GET /api/v1/orderbook/{symbol}`

Current order book snapshot (top 20 price levels per side, cached with 5 s TTL).

**Response `200`:**
```json
{
  "event":     "orderbook",
  "symbol":    "AAPL_S",
  "timestamp": 1774911548000,
  "bids": [
    [179.90, 50],
    [179.85, 120]
  ],
  "asks": [
    [179.95, 30],
    [180.00, 80]
  ]
}
```

Each entry is `[price, quantity]`. Bids are ordered best (highest) first; asks are ordered best (lowest) first.

**Errors:**
- `404` — unknown symbol or no data yet

---

#### `GET /api/v1/candles/{symbol}`

OHLCV candles aggregated from real executed trades.

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `interval` | string | `1m` | Candle width: `1s`, `10s`, or `1m` |
| `limit` | integer | 100 | Number of candles to return (1–1000) |

**Response `200`:**
```json
{
  "symbol":   "AAPL_S",
  "interval": "1m",
  "candles": [
    {
      "open":      179.80,
      "high":      180.10,
      "low":       179.75,
      "close":     180.05,
      "volume":    342.0,
      "timestamp": 1774911480000
    }
  ]
}
```

`timestamp` is the **bucket start** in milliseconds (Unix epoch). Candles are ordered oldest → newest.

**Errors:**
- `404` — unknown symbol

---

#### `GET /api/v1/trades/{symbol}`

Recent executed trades for a symbol (public feed, no auth).

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | 50 | Max trades (1–500) |

**Response `200`:**
```json
[
  {
    "price":     179.93,
    "quantity":  10.0,
    "buyer_id":  "string (UUID)",
    "seller_id": "string (UUID)",
    "timestamp": "2026-03-30T22:45:00+00:00"
  }
]
```

Ordered newest first. `buyer_id` / `seller_id` are the user UUIDs of the matched participants.

**Errors:**
- `404` — unknown symbol

---

#### `GET /api/v1/portfolio` — Auth required

User's current holdings (positions with quantity > 0). Lighter alternative to `/me` — returns only the holdings array without account totals.

**Response `200`:**
```json
[
  {
    "symbol":        "AAPL_S",
    "quantity":      15.0,
    "avg_cost":      179.93,
    "current_price": 182.10
  }
]
```

---

### Health

#### `GET /health`

**Response `200`:**
```json
{
  "status":  "ok",
  "symbols": ["AAPL_S", "GOOGL_S", "TSLA_S", "MSFT_S", "AMZN_S"]
}
```

---

## WebSocket API

WebSocket base: `wss://opensoft-backend.duckdns.org` (port 8001)

All three WebSocket endpoints send a keepalive `{"type":"ping"}` every 30 seconds. You can ignore or use it to detect connection drops.

---

### `ws://host:8001/ws/{symbol}` — Market stream

Real-time stream of trades, order book updates, and candle closes for one symbol.

**Default subscriptions on connect:** `trades`, `orderbook`, `candles:1m`

**To subscribe to additional or different channels**, send a JSON message after connecting:
```json
{
  "subscribe": ["trades", "orderbook", "candles:1s", "candles:10s", "candles:1m"]
}
```
You can send this message at any time to replace/add subscriptions. Specify only the channels you want.

---

**Trade event:**
```json
{
  "event":         "trade",
  "trade_id":      "string",
  "symbol":        "AAPL_S",
  "price":         179.93,
  "quantity":      10.0,
  "buy_order_id":  "string (UUID)",
  "sell_order_id": "string (UUID)",
  "buyer_id":      "string (UUID)",
  "seller_id":     "string (UUID)",
  "timestamp":     1774911548000
}
```

**Order book snapshot:**
```json
{
  "event":     "orderbook",
  "symbol":    "AAPL_S",
  "timestamp": 1774911548000,
  "bids": [[179.90, 50], [179.85, 120]],
  "asks": [[179.95, 30], [180.00, 80]]
}
```

**Candle closed:**
```json
{
  "event":     "candle",
  "symbol":    "AAPL_S",
  "interval":  "1m",
  "open":      179.80,
  "high":      180.10,
  "low":       179.75,
  "close":     180.05,
  "volume":    342.0,
  "timestamp": 1774911480000
}
```

`interval` will be `"1s"`, `"10s"`, or `"1m"` depending on which channel the candle came from.

---

### `ws://host:8001/ws/orders/{user_id}` — Stop order notifications

Per-user stream. Delivers a message each time the trigger engine fires one of the user's stop orders. Connect using the `user_id` UUID returned at login/register.

No subscription message needed — events are pushed automatically.

**Stop order triggered:**
```json
{
  "type":         "stop_triggered",
  "order_id":     "string (UUID)",
  "symbol":       "AAPL_S",
  "side":         "sell",
  "order_type":   "stop_limit",
  "stop_price":   175.00,
  "triggered_at": 1774911548000,
  "status":       "triggered"
}
```

Use this to show a real-time notification to the user when their stop fires.

---

### `ws://host:8001/ws/market/{symbol}` — Raw GBM L2 stream

Raw Level 2 order book snapshots from the market generator at **100 ticks/second** (every ~10 ms). This is the highest-frequency feed — use for charts or live spread display. No subscription message needed.

```json
{
  "type":       "market_data",
  "symbol":     "AAPL_S",
  "tick":       12345,
  "ts":         1774911548123,
  "mid":        180.12,
  "spread":     0.18,
  "spread_pct": 0.10,
  "asks": [
    {"price": 180.21, "size": 1000},
    {"price": 180.30, "size": 500}
  ],
  "bids": [
    {"price": 180.03, "size": 1000},
    {"price": 179.94, "size": 700}
  ]
}
```

`asks` are ordered lowest→highest (best ask first); `bids` are ordered highest→lowest (best bid first).

---

## Quick Reference

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| POST | `/api/v1/auth/register` | | Register + get token |
| POST | `/api/v1/auth/login` | | Login + get token |
| GET | `/api/v1/me` | ✓ | Full account snapshot: balance, portfolio, P&L |
| GET | `/api/v1/my/trades` | ✓ | Personal trade history (buys + sells) |
| GET | `/api/v1/my/balance-history` | ✓ | Cash balance ledger |
| POST | `/api/v1/orders` | ✓ | Place limit / market / stop order |
| GET | `/api/v1/orders` | ✓ | List own orders (filterable) |
| GET | `/api/v1/orders/{id}` | ✓ | Get single order |
| DELETE | `/api/v1/orders/{id}` | ✓ | Cancel order |
| GET | `/api/v1/portfolio` | ✓ | Holdings only (lightweight) |
| GET | `/api/v1/stocks` | | All symbols + parameters |
| GET | `/api/v1/ticker/{symbol}` | | Last traded price |
| GET | `/api/v1/orderbook/{symbol}` | | Order book snapshot |
| GET | `/api/v1/candles/{symbol}` | | OHLCV candles |
| GET | `/api/v1/trades/{symbol}` | | Recent public trade feed |
| GET | `/health` | | Health check |
| WS | `ws://…:8001/ws/{symbol}` | | Trades · order book · candles |
| WS | `ws://…:8001/ws/market/{symbol}` | | Raw GBM L2 at 100 Hz |
| WS | `ws://…:8001/ws/orders/{user_id}` | | Stop order trigger notifications |

---

## Common Patterns

### After login — what to fetch on app load

```
GET /api/v1/me            → balance, portfolio, P&L (dashboard)
GET /api/v1/orders?status=open        → active limit orders
GET /api/v1/orders?status=pending_trigger → active stop orders
```

### Placing a standard market buy

```json
POST /api/v1/orders
{
  "symbol":   "AAPL_S",
  "type":     "market",
  "side":     "buy",
  "quantity": 10
}
```

### Placing a stop-loss (sell stop)

Triggers when price falls **to or below** `stop_price`:
```json
POST /api/v1/orders
{
  "symbol":      "AAPL_S",
  "type":        "stop_limit",
  "side":        "sell",
  "stop_price":  170.00,
  "limit_price": 169.50,
  "quantity":    10
}
```

### Subscribing to live price + trades in the browser

```js
const ws = new WebSocket("wss://opensoft-backend.duckdns.org/ws/AAPL_S");

// Optionally narrow subscriptions after connect:
ws.onopen = () => ws.send(JSON.stringify({
  subscribe: ["trades", "orderbook", "candles:1m"]
}));

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === "ping") return;          // keepalive — ignore
  if (msg.event === "trade")     { /* update last price */ }
  if (msg.event === "orderbook") { /* refresh order book view */ }
  if (msg.event === "candle")    { /* push new candle to chart */ }
};
```

### Listening for stop order triggers

```js
// user_id comes from login response
const ws = new WebSocket(`wss://opensoft-backend.duckdns.org/ws/orders/${user_id}`);

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === "stop_triggered") {
    alert(`Stop order fired! ${msg.symbol} ${msg.side} @ ${msg.stop_price}`);
    // Refresh orders and portfolio
  }
};
```
