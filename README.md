# Synthetic-Bull — Production-Grade Simulated Trading Exchange

> **A fully functional, high-fidelity order-driven exchange simulation built for traders, developers, and educators who demand realism without real money.**

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [Why Synthetic-Bull? — Unique Selling Points](#2-why-synthetic-bull--unique-selling-points)
3. [System Architecture](#3-system-architecture)
4. [Microservices Deep-Dive](#4-microservices-deep-dive)
   - 4.1 [Market Generator — GBM Price Engine (C++)](#41-market-generator--gbm-price-engine-c)
   - 4.2 [Matching Engine — Limit Order Book (C++)](#42-matching-engine--limit-order-book-c)
   - 4.3 [Trigger Engine — Stop Order Executor (C++)](#43-trigger-engine--stop-order-executor-c)
   - 4.4 [API Gateway — REST Layer (Python/FastAPI)](#44-api-gateway--rest-layer-pythonfastapi)
   - 4.5 [Fill Processor — Trade Settlement Engine](#45-fill-processor--trade-settlement-engine)
   - 4.6 [Candle Service — OHLCV Aggregator](#46-candle-service--ohlcv-aggregator)
   - 4.7 [WebSocket Service — Real-time Feed Bridge](#47-websocket-service--real-time-feed-bridge)
   - 4.8 [Market Maker Bot — Autonomous Liquidity Provider](#48-market-maker-bot--autonomous-liquidity-provider)
   - 4.9 [Alpha Bot — Algorithmic Signal Trader](#49-alpha-bot--algorithmic-signal-trader)
   - 4.10 [Data Pruner — Retention Manager](#410-data-pruner--retention-manager)
5. [Mathematical Models & Algorithms](#5-mathematical-models--algorithms)
   - 5.1 [Geometric Brownian Motion (GBM)](#51-geometric-brownian-motion-gbm)
   - 5.2 [Nine Microstructure Extensions](#52-nine-microstructure-extensions)
   - 5.3 [Price-Time Priority Matching](#53-price-time-priority-matching)
   - 5.4 [Volume-Weighted Average Cost (VWAC)](#54-volume-weighted-average-cost-vwac)
   - 5.5 [P&L Calculation Engine](#55-pl-calculation-engine)
   - 5.6 [OHLCV Bucket Aggregation](#56-ohlcv-bucket-aggregation)
6. [Order Lifecycle & State Machine](#6-order-lifecycle--state-machine)
   - 6.1 [Limit & Market Orders](#61-limit--market-orders)
   - 6.2 [Stop-Limit & Stop-Market Orders](#62-stop-limit--stop-market-orders)
   - 6.3 [End-to-End Flow: Buy Limit Example](#63-end-to-end-flow-buy-limit-example)
   - 6.4 [End-to-End Flow: Stop-Limit Example](#64-end-to-end-flow-stop-limit-example)
7. [Data Architecture](#7-data-architecture)
   - 7.1 [PostgreSQL Schema](#71-postgresql-schema)
   - 7.2 [Redis Data Structures](#72-redis-data-structures)
   - 7.3 [Message Bus Topology](#73-message-bus-topology)
8. [API Reference](#8-api-reference)
   - 8.1 [Authentication](#81-authentication)
   - 8.2 [Order Management](#82-order-management)
   - 8.3 [Portfolio & Account](#83-portfolio--account)
   - 8.4 [Market Data (REST)](#84-market-data-rest)
   - 8.5 [WebSocket Feeds](#85-websocket-feeds)
9. [Synthetic Instruments](#9-synthetic-instruments)
10. [Technology Stack](#10-technology-stack)
11. [Infrastructure & Deployment](#11-infrastructure--deployment)
12. [Configuration Reference](#12-configuration-reference)
13. [Use Cases & Target Audience](#13-use-cases--target-audience)
14. [Competitive Positioning](#14-competitive-positioning)
15. [Roadmap & Extensibility](#15-roadmap--extensibility)

---

## 1. Executive Overview

**Synthetic-Bull** is a **production-grade simulated trading exchange** that replicates the full lifecycle of a real order-driven financial market — from stochastic price generation to order matching, settlement, portfolio tracking, and real-time data distribution — without touching real capital.

Built on a **microservices architecture** with C++ at its performance core and Python for orchestration services, the platform delivers:

- **Sub-millisecond order matching** via a native C++ Limit Order Book (LOB)
- **Scientifically realistic price simulation** using Geometric Brownian Motion extended with 9 market microstructure models
- **4 order types** — limit, market, stop-limit, and stop-market — with full lifecycle management
- **Three real-time WebSocket feeds** — 100 Hz raw market data, trade events, and stop-order notifications
- **Autonomous trading bots** — a market-maker and an SMA-crossover alpha bot — providing continuous liquidity and realistic order flow
- **Complete financial ledger** — trade history, balance ledger, portfolio P&L with VWAC cost basis

The system is deployable in a single command (`docker-compose up`) and exposes a clean REST API (`port 8000`) and WebSocket gateway (`port 8001`), making it immediately consumable by trading UIs, backtesting frameworks, or algorithmic trading clients.

**Five synthetic instruments** mirror real-world equity parameters:

| Symbol   | Underlying | Drift (Annual) | Volatility (Annual) | Base Price |
|----------|-----------|---------------|---------------------|------------|
| AAPL_S   | Apple Inc. | ~8%           | ~22%                | ~$180      |
| GOOGL_S  | Alphabet   | ~7%           | ~25%                | ~$140      |
| TSLA_S   | Tesla      | ~5%           | ~55%                | ~$250      |
| MSFT_S   | Microsoft  | ~9%           | ~20%                | ~$375      |
| AMZN_S   | Amazon     | ~8%           | ~28%                | ~$185      |

---

## 2. Why Synthetic-Bull? — Unique Selling Points

### USP 1: Scientifically Rigorous Price Simulation

Most simulated exchanges use simple random walks or static price feeds. Synthetic-Bull uses **Geometric Brownian Motion augmented with 9 independent microstructure extensions** (regime switching, GARCH volatility clustering, order-flow imbalance, hidden drift, and more). The result is price paths that exhibit:

- **Fat tails** — extreme moves happen more often than a normal distribution predicts
- **Volatility clustering** — high-volatility periods cluster together (GARCH effect)
- **Market regimes** — bull, bear, and neutral regimes with probabilistic switching
- **Mean reversion tendencies** — prices anchor near recent VWAPs
- **Realistic spreads** — dynamic bid-ask spreads that widen during volatile periods
- **Power-law order sizes** — large orders appear with realistic frequency (Pareto distribution)

No other open-source simulated exchange offers this level of market fidelity.

---

### USP 2: Real C++ Matching Engine — Not a Mock

The order book is implemented in **native C++** with a price-time priority Limit Order Book. Orders are **actually matched** against real resting counterparty orders — including GBM-generated liquidity from the market generator and orders from other users and bots. This is not a simulated fill; it is a real exchange matching algorithm.

- Lock-free queue (`LFQueue`) for concurrent order ingestion
- CPU thread affinity for minimum latency
- Price-time FIFO priority within each price level
- Separate bid/ask books maintained as sorted maps

---

### USP 3: Four Complete Order Types with Server-Side Stop Logic

Most simulators support only limit and market orders. Synthetic-Bull implements:

| Order Type    | Trigger              | Execution           | Persistence |
|---------------|----------------------|---------------------|-------------|
| **Limit**     | N/A — rests on book  | At limit price or better | Until cancelled or filled |
| **Market**    | Immediate            | Best available price | Immediate (IOC) |
| **Stop-Limit** | Price crosses stop  | Submits limit order at `limit_price` | DB-persisted, survives restarts |
| **Stop-Market** | Price crosses stop | Submits market order | DB-persisted, survives restarts |

Stop orders are held by a dedicated **C++ Trigger Engine** that monitors live prices from Redis and fires triggers deterministically. Stop orders survive service restarts because they are persisted in PostgreSQL and reloaded on boot.

---

### USP 4: Complete Financial Settlement Pipeline

Every trade creates a cascading settlement chain:

```
Trade Executed → Fill Processor →
  ├─ trades table (immutable record)
  ├─ orders table (filled_qty, status updated)
  ├─ portfolios table (VWAC-based cost basis updated)
  ├─ users.balance (debited/credited)
  └─ balance_history (full ledger entry with running balance)
```

Users receive a **bank-statement-style ledger** (`/api/v1/my/balance-history`) showing every balance change with reason, symbol, quantity, price, and running balance — giving complete financial auditability.

---

### USP 5: Three Independent Real-Time WebSocket Feeds

| Feed | Endpoint | Frequency | Content |
|------|----------|-----------|---------|
| **Market Stream** | `/ws/{symbol}` | Event-driven | Trades, orderbook snapshots, candle closes |
| **Stop Notifications** | `/ws/orders/{user_id}` | On trigger | Stop order triggered events |
| **Raw L2 Feed** | `/ws/market/{symbol}` | 100 Hz | Full bid/ask depth at tick resolution |

The raw L2 feed at 100 Hz (10ms intervals) is suitable for high-frequency algorithmic trading clients and backtesting frameworks.

---

### USP 6: Built-In Autonomous Trading Bots

The platform ships with two autonomous bots that immediately make the market live and realistic:

- **Market Maker Bot**: Continuously quotes both sides of the book at a 0.1% spread, refreshing every 500ms. Provides liquidity so user orders fill immediately.
- **Alpha Bot**: Implements an SMA(10)/SMA(50) crossover strategy on 1-minute candles. Generates directional order flow, creating realistic price momentum.

These bots interact with user orders exactly like real counterparties — there is no special treatment.

---

### USP 7: Production-Grade DevOps

- **Single-command deployment**: `docker-compose up --build`
- **10 containerized services** with health checks and ordered startup
- **Database migrations**: Schema versioned and applied automatically
- **Configurable data retention**: Pruner prevents unbounded storage growth
- **Environment-based configuration**: All secrets and tuning parameters via `.env`
- **Two external ports only**: REST (`8000`) and WebSocket (`8001`)

---

### USP 8: Open & Extensible

- **Clean REST API** with OpenAPI/Swagger docs at `/docs`
- **WebSocket protocol** documented and subscribable by any client
- **Shared schemas** (`shared/schemas/`) in Pydantic for easy extension
- **Configurable instruments** via `shared/config/stocks.yaml` — add any symbol with custom GBM parameters
- **Pluggable bots** — add your own trading strategy by following the market-maker or alpha-bot pattern

---

## 3. System Architecture

### High-Level Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        SYNTHETIC-BULL PLATFORM                           │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                C++ PERFORMANCE CORE                                │  │
│  │                                                                    │  │
│  │  ┌─────────────────────┐   ┌─────────────────────────────────┐   │  │
│  │  │   MARKET GENERATOR  │   │        MATCHING ENGINE          │   │  │
│  │  │  (GBM + 9 exts.)    │──▶│    (Price-Time Priority LOB)    │   │  │
│  │  │  100 ticks/sec/sym  │   │    Lock-free, CPU-pinned        │   │  │
│  │  └─────────────────────┘   └─────────────┬───────────────────┘   │  │
│  │                                           │                        │  │
│  │  ┌─────────────────────┐                 │ Redis                  │  │
│  │  │   TRIGGER ENGINE    │◀────────────────┘                        │  │
│  │  │  Stop Order Monitor │  stream:trades, trades:*, orderbook:*   │  │
│  │  │  DB-persisted state │                                          │  │
│  │  └─────────────────────┘                                          │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │               PYTHON SERVICES LAYER                                │  │
│  │                                                                    │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐    │  │
│  │  │ FILL         │  │ CANDLE       │  │  WEBSOCKET SERVICE   │    │  │
│  │  │ PROCESSOR    │  │ SERVICE      │  │  (Redis→WS Fan-out)  │    │  │
│  │  │ (Settlement) │  │ (OHLCV Agg.) │  │  Port 8001           │    │  │
│  │  └──────────────┘  └──────────────┘  └──────────────────────┘    │  │
│  │                                                                    │  │
│  │  ┌─────────────────────────────────────────────────────────────┐  │  │
│  │  │                  API GATEWAY (FastAPI)                      │  │  │
│  │  │  REST endpoints — Auth, Orders, Portfolio, Market Data      │  │  │
│  │  │  Port 8000                                                  │  │  │
│  │  └─────────────────────────────────────────────────────────────┘  │  │
│  │                                                                    │  │
│  │  ┌──────────────────────┐  ┌──────────────────────────────────┐   │  │
│  │  │  MARKET MAKER BOT    │  │        ALPHA BOT                 │   │  │
│  │  │  (Spread Quoting)    │  │   (SMA Crossover Strategy)       │   │  │
│  │  └──────────────────────┘  └──────────────────────────────────┘   │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                       DATA LAYER                                   │  │
│  │                                                                    │  │
│  │   ┌───────────────────────────┐  ┌──────────────────────────┐    │  │
│  │   │  POSTGRESQL 16            │  │  REDIS 7.2               │    │  │
│  │   │  users, orders, trades    │  │  pub/sub, streams,       │    │  │
│  │   │  portfolios, candles      │  │  sorted sets, hashes     │    │  │
│  │   │  balance_history          │  │  (real-time bus + cache) │    │  │
│  │   └───────────────────────────┘  └──────────────────────────┘    │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
          │ REST :8000                   │ WebSocket :8001
          ▼                             ▼
   ┌─────────────┐              ┌────────────────┐
   │  API Client │              │  Frontend / UI │
   │  (Trader)   │              │  Algo Client   │
   └─────────────┘              └────────────────┘
```

---

### Data Flow Architecture

```
PRICE GENERATION PIPELINE:
──────────────────────────
Market Generator
  └─[GBM tick @ 100Hz]──TCP:9000──▶ Matching Engine
                                        ├─▶ Redis stream:trades
                                        ├─▶ Redis trades:{symbol}  (pub/sub)
                                        ├─▶ Redis orderbook:{symbol} (pub/sub)
                                        └─▶ Redis price:{symbol} (hash)

TRADE SETTLEMENT PIPELINE:
──────────────────────────
Redis stream:trades
  ├─▶ Fill Processor (consumer group)
  │     ├─ PostgreSQL: INSERT trades
  │     ├─ PostgreSQL: UPDATE orders.filled_qty / status
  │     ├─ PostgreSQL: UPSERT portfolios (VWAC)
  │     ├─ PostgreSQL: UPDATE users.balance
  │     └─ PostgreSQL: INSERT balance_history
  └─▶ Candle Service (consumer group)
        ├─ Redis: ZADD candles:{symbol}:{interval}
        ├─ PostgreSQL: UPSERT candles
        └─ Redis pub/sub: candles:{symbol}:{interval}

REAL-TIME DISTRIBUTION PIPELINE:
──────────────────────────────────
Redis pub/sub (trades:*, orderbook:*, candles:*, stop_triggered:*)
  └─▶ WebSocket Service
        └─▶ WebSocket clients (fan-out per symbol/user)

STOP ORDER PIPELINE:
────────────────────
API Gateway
  └─[stop_orders:new]──Redis pub/sub──▶ Trigger Engine (C++)
                                            ├─ Monitors: Redis price:{symbol}
                                            ├─ On trigger: TCP → Matching Engine
                                            ├─ On trigger: PostgreSQL UPDATE status='triggered'
                                            └─ On trigger: Redis pub/sub stop_triggered:{user_id}
                                                              └─▶ WebSocket Service → Client
```

---

### Service Interaction Matrix

| Service | Reads From | Writes To |
|---------|-----------|-----------|
| Market Generator | stocks.yaml | TCP:9000 (Matching Engine) |
| Matching Engine | TCP:9000 (orders) | Redis streams, pub/sub, hashes |
| Trigger Engine | Redis price:*, stop_orders:*, PostgreSQL | TCP:9000, Redis stop_triggered:*, PostgreSQL |
| API Gateway | Redis, PostgreSQL | Redis stop_orders:*, PostgreSQL, TCP:9000 |
| Fill Processor | Redis stream:trades | PostgreSQL |
| Candle Service | Redis stream:trades | Redis sorted sets, PostgreSQL, Redis pub/sub |
| WebSocket Service | Redis pub/sub | WebSocket clients |
| Market Maker Bot | Redis price:* | REST API (POST /orders) |
| Alpha Bot | Redis candles:*:1m | REST API (POST /orders) |

---

## 4. Microservices Deep-Dive

### 4.1 Market Generator — GBM Price Engine (C++)

**Location**: `market-generator/`
**Language**: C++
**Function**: Generates synthetic price ticks at 100 ticks/second per symbol and sends L2 orderbook snapshots to the matching engine via TCP.

#### What It Does

Every tick (~10ms), for each of the 5 symbols, the market generator:

1. Advances the GBM stochastic differential equation one discrete time step
2. Applies 9 microstructure extensions (see [Section 5.2](#52-nine-microstructure-extensions))
3. Constructs a synthetic L2 orderbook: 10 bid levels and 10 ask levels around the new mid-price
4. Assigns order sizes using a Pareto-blended heavy-tailed distribution
5. Applies dynamic spread based on realized volatility
6. Sends the orderbook snapshot to the matching engine's TCP server

#### Background Logic

The market generator is the **ground truth price source**. The matching engine uses the GBM-generated orderbook as passive (resting) liquidity — the "market" that user orders trade against. When no user orders exist, the market maker bot additionally places limit orders, ensuring there is always a two-sided book.

The generator operates independently from the matching engine, pushing new snapshots continuously. This decoupled design means the price process is not affected by whether the matching engine is busy or idle.

#### Key Parameters (per symbol in `stocks.yaml`)

```yaml
symbol: AAPL_S
name: "Apple Inc. (Synthetic)"
initial_price: 180.0
drift: 0.08        # 8% annual drift
volatility: 0.22   # 22% annual volatility
```

---

### 4.2 Matching Engine — Limit Order Book (C++)

**Location**: `matching-engine/`
**Language**: C++
**Function**: Accepts incoming orders via TCP, maintains a Limit Order Book, matches orders using price-time priority, publishes trades and orderbook snapshots to Redis.

#### What It Does

1. **TCP Server** (`tcp_server.cpp`): Listens on port 9000, accepts JSON-delimited order messages from the API Gateway and Market Generator
2. **LOB Management** (`order_book.cpp`): Maintains separate bid (`std::map<price, queue>`, descending) and ask (`std::map<price, queue>`, ascending) sides
3. **Matching Algorithm** (`lob_matching_engine.cpp`): For each incoming aggressor order, greedily matches against the opposite side using price-time priority
4. **Redis Publisher** (`redis_publisher.cpp`): Publishes trade events to `stream:trades` and `trades:{symbol}`, orderbook snapshots to `orderbook:{symbol}`, and price updates to `price:{symbol}`

#### Matching Algorithm Detail

```
For a BUY limit order at price P:
  best_ask = min(asks)
  while order.remaining_qty > 0 and best_ask.price <= P:
    fill_qty = min(order.remaining_qty, best_ask.qty)
    execute_trade(fill_qty, best_ask.price)
    deduct fill_qty from best_ask order (FIFO within level)
    order.remaining_qty -= fill_qty
    advance to next ask level if exhausted
  if order.remaining_qty > 0:
    rest order on bid book at price P

For a BUY market order:
  (same as above but P = infinity — matches everything)
```

#### Concurrency Model

- **Lock-free queue** (`LFQueue`): Orders from the TCP server are enqueued lock-free
- **Matching thread**: Dedicated CPU-pinned thread that dequeues and processes orders
- **Publisher thread**: Separate thread for Redis I/O, avoiding blocking the match loop

---

### 4.3 Trigger Engine — Stop Order Executor (C++)

**Location**: `trigger-engine/`
**Language**: C++
**Function**: Holds all pending stop orders in memory, monitors live prices from Redis, and executes stop orders when their trigger condition is met.

#### What It Does

1. **Startup**: Queries PostgreSQL for all orders with `status = 'pending_trigger'` and loads them into an in-memory hashmap (`order_id → stop_info`)
2. **Redis Subscription**: Subscribes to `price:{symbol}` updates (published by the matching engine) and `stop_orders:new` / `stop_orders:cancel` channels
3. **Trigger Check** (per price update):
   - For SELL stop: trigger if `mid_price ≤ stop_price`
   - For BUY stop: trigger if `mid_price ≥ stop_price`
4. **On Trigger**:
   - Remove from in-memory map
   - Update PostgreSQL: `status = 'triggered'`
   - Submit resulting order (limit or market) to matching engine via TCP
   - Publish `stop_triggered:{user_id}` event to Redis pub/sub
5. **Cancellation**: Handles `stop_orders:cancel` messages by removing from memory and updating DB

#### Durability Guarantee

Stop orders are **fully durable**. If the trigger engine restarts, it reloads all pending stop orders from PostgreSQL and continues monitoring. No stop orders are lost across service restarts.

---

### 4.4 API Gateway — REST Layer (Python/FastAPI)

**Location**: `api-gateway/`
**Language**: Python 3.11+, FastAPI
**Port**: 8000
**Function**: Single entry point for all user-facing REST operations: authentication, order submission, market data retrieval, portfolio queries.

#### Components

- **`app/main.py`**: FastAPI application initialization, startup tasks (fill processor, pruner), router registration
- **`app/routers/auth.py`**: Registration and login endpoints
- **`app/routers/orders.py`**: Order CRUD — place, query, cancel
- **`app/routers/portfolio.py`**: Portfolio snapshot, trade history, balance ledger
- **`app/routers/market_data.py`**: Stocks, ticker, orderbook, candles, recent trades
- **`app/fill_processor.py`**: Background Redis stream consumer for trade settlement
- **`app/pruner.py`**: Background data retention task
- **`app/dependencies.py`**: Shared FastAPI dependencies (JWT auth, DB connections)
- **`app/tcp_client.py`**: Connection pool to the C++ matching engine

#### Authentication Flow

```
POST /api/v1/auth/register:
  1. Validate: username (3–50 chars), email format, password (≥6 chars)
  2. Check uniqueness: username + email in PostgreSQL
  3. Hash password: bcrypt(password, rounds=12)
  4. INSERT users: id=UUID4, balance=100,000
  5. Return: JWT token (HS256, 24h expiry)
     Payload: {sub: user_id, username, exp, iat}

POST /api/v1/auth/login:
  1. Lookup user by username
  2. Verify: bcrypt.verify(password, hash)
  3. Return: JWT token (same format)
```

All protected endpoints require `Authorization: Bearer <token>` header. The dependency `get_current_user` verifies the JWT, extracts `user_id`, and provides it to the route handler.

#### TCP Connection Pool

The API Gateway maintains a pool of TCP connections to the matching engine (port 9000). Order submission is fire-and-forget: the gateway writes the JSON order to TCP and immediately returns a response to the client. Order status updates arrive asynchronously via the fill processor watching `stream:trades`.

---

### 4.5 Fill Processor — Trade Settlement Engine

**Location**: `api-gateway/app/fill_processor.py` (247 LOC)
**Function**: Consumes `stream:trades` Redis stream, processes each trade, and updates all affected database entities.

#### Consumer Group Architecture

The fill processor joins consumer group `fill-processor-group` on `stream:trades`. This guarantees:
- **Exactly-once processing**: Each trade message is processed by exactly one consumer instance
- **Resumability**: After restart, processing resumes from the last acknowledged message
- **Idempotency**: `ON CONFLICT DO NOTHING` on trade inserts prevents duplicate settlement

#### Two-Phase Settlement

**Phase 1 — Critical Path (Atomic Transaction)**:
```sql
BEGIN;
  INSERT INTO trades VALUES (...) ON CONFLICT DO NOTHING;
  UPDATE orders SET filled_qty = filled_qty + $qty, status = ...
    WHERE id = $buy_order_id;
  UPDATE orders SET filled_qty = filled_qty + $qty, status = ...
    WHERE id = $sell_order_id;
COMMIT;
```

Status update logic:
- If `filled_qty = quantity` → `status = 'filled'`
- If `filled_qty < quantity` → `status = 'partial'`

**Phase 2 — Portfolio & Balance (Best-Effort)**:
```python
# Buyer:
UPSERT portfolios:
  new_avg_cost = (old_avg_cost × old_qty + trade_price × trade_qty) / (old_qty + trade_qty)
  quantity += trade_qty
UPDATE users SET balance = balance - (trade_price × trade_qty) WHERE id = buyer_id
INSERT INTO balance_history (delta=-cost, balance=new_balance, reason='trade_buy', ...)

# Seller:
UPDATE portfolios SET quantity = quantity - trade_qty WHERE user_id = seller_id AND symbol = ...
UPDATE users SET balance = balance + (trade_price × trade_qty) WHERE id = seller_id
INSERT INTO balance_history (delta=+proceeds, balance=new_balance, reason='trade_sell', ...)
```

**Design Rationale**: Phase 1 failures abort the entire transaction — no partial state. Phase 2 failures are logged but do not roll back Phase 1. This ensures trade records are always created, even if portfolio accounting encounters an edge case.

---

### 4.6 Candle Service — OHLCV Aggregator

**Location**: `candle-service/`
**Language**: Python
**Function**: Consumes `stream:trades`, aggregates into OHLCV candlesticks at three intervals, persists to Redis and PostgreSQL, and publishes candle-close events.

#### Aggregation Algorithm

```
For each incoming trade (price p, quantity q, timestamp t_ms):

  For each interval I in {1s=1000ms, 10s=10000ms, 1m=60000ms}:
    bucket_start = floor(t_ms / I_ms) × I_ms

    if no existing open candle for (symbol, interval):
      create new candle: O=H=L=C=p, V=q, bucket=bucket_start

    elif bucket_start > current_bucket:
      CLOSE current candle:
        → Redis: ZADD candles:{symbol}:{I} score=bucket V=json(candle)
        → Redis: ZREMRANGEBYSCORE (trim to newest 1000)
        → PostgreSQL: UPSERT candles ON CONFLICT DO UPDATE
          SET high = GREATEST(high, $new_high),
              low  = LEAST(low, $new_low),
              close = $new_close,
              volume = volume + $new_volume
        → Redis pub/sub: PUBLISH candles:{symbol}:{I} (closed candle)
      CREATE new candle: O=H=L=C=p, V=q, bucket=bucket_start

    else (same bucket):
      UPDATE: H=max(H,p), L=min(L,p), C=p, V+=q
```

#### Three Granularities

| Interval | Bucket Size | Redis TTL (entries) | Use Case |
|----------|-------------|---------------------|----------|
| 1 second | 1,000ms | 1,000 most recent | Scalping, tick charts |
| 10 seconds | 10,000ms | 1,000 most recent | Short-term monitoring |
| 1 minute | 60,000ms | 1,000 most recent | SMA-based strategies |

---

### 4.7 WebSocket Service — Real-time Feed Bridge

**Location**: `websocket-service/`
**Language**: Python, FastAPI WebSockets
**Port**: 8001
**Function**: Bridges Redis pub/sub channels to WebSocket clients, enabling real-time market data, trade feeds, and stop-order notifications.

#### Architecture

```
Redis pub/sub channels
  ┌─ trades:{symbol}          ─┐
  ├─ orderbook:{symbol}         │──▶ Subscription Manager
  ├─ candles:{symbol}:{interval}│      (in-memory per-symbol client sets)
  └─ market_data:{symbol}      ─┘          │
                                           ▼
  ┌─ stop_triggered:{user_id} ──────▶ User WebSocket Subscriptions
                                           │
                                           ▼
                                   WebSocket fan-out to all connected clients
```

#### Three Endpoints

**`/ws/{symbol}`** — Market Data Stream:
- Default subscriptions on connect: `trades`, `orderbook`, `candles:1m`
- Client can send subscription update:
  ```json
  {"subscribe": ["trades", "orderbook", "candles:1s", "candles:10s", "candles:1m"]}
  ```
- Server sends 30-second ping keepalives: `{"type": "ping"}`

**`/ws/orders/{user_id}`** — Stop Order Notifications:
- Subscribes to `stop_triggered:{user_id}`
- Delivers real-time stop-trigger events
- Allows users to react instantly to stop order executions

**`/ws/market/{symbol}`** — Raw L2 @ 100 Hz:
- Subscribes to `market_data:{symbol}` from market generator
- Delivers full bid/ask depth at ~10ms intervals
- Suitable for algorithmic trading and high-frequency strategy development

---

### 4.8 Market Maker Bot — Autonomous Liquidity Provider

**Location**: `market-maker-bot/`
**Language**: Python async
**Function**: Continuously quotes both sides of the book for all symbols using the risk-adjusted **Avellaneda-Stoikov** pricing model to manage inventory risk.

#### Strategy: Avellaneda-Stoikov (Inventory Skew)

```text
Every tick (100ms by default) per symbol:
  1. Fetch mid-price from Redis and calculate per-tick variance via EMA
  2. Sync inventory (q) from the portfolio periodically
  3. Compute reservation price (r) adjusted for inventory risk:
     r = mid - q * γ * σ² * rem
  4. Compute spread distances:
     δ_fixed = (1/γ) * ln(1 + γ/k)
     bid = r - δ_fixed
     ask = r + δ_fixed
  5. Cancel existing quotes and POST new limit buy/sell orders
```

#### Parameters

| Parameter | Default | Effect |
|-----------|---------|--------|
| `GAMMA` | 0.001 | Risk-aversion coefficient. Higher values aggressively skew quotes. |
| `K` | 1.5 | Order-arrival intensity decay rate per unit of spread. |
| `T_TICKS` | 500 | Rolling strategy horizon in ticks. |
| `Q_MAX` | 20 | Soft inventory cap per symbol to prevent runaway positions. |
| `TPS` | 10 | Ticks per second for update frequency. |

#### Economic Role

The market maker earns the bid-ask spread on round-trip trades while actively managing the risk of holding unbalanced inventory. Its presence ensures:
1. User limit orders have a counterparty to fill against immediately.
2. Market orders always have resting liquidity.
3. The orderbook dynamically adjusts to volume and one-sided order flow.

---

### 4.9 Alpha Bot — Algorithmic Signal Trader

**Location**: `alpha-bot/`
**Language**: Python async
**Function**: Implements an SMA crossover strategy on 1-minute candles, generating directional market orders that create realistic price trends.

#### Strategy: SMA(10)/SMA(50) Crossover

```
Every 10 seconds per symbol:
  1. Fetch last 50 closed 1m candles: ZRANGE candles:{symbol}:1m -50 -1
  2. Extract close prices
  3. Compute:
     fast_sma = mean(closes[-10:])    # 10-period SMA
     slow_sma = mean(closes[-50:])    # 50-period SMA
  4. Determine signal:
     if fast_sma > slow_sma → BULL signal
     if fast_sma < slow_sma → BEAR signal
  5. If signal changed AND last_order_time > 30 seconds ago:
     side = 'buy'  if BULL signal
     side = 'sell' if BEAR signal
     POST market order: {symbol, side, qty=5}
     Update last_order_time
```

#### Parameters

| Parameter | Value |
|-----------|-------|
| `SMA_FAST` | 10 periods (minutes) |
| `SMA_SLOW` | 50 periods (minutes) |
| `CANDLE_INTERVAL` | 1 minute |
| `ORDER_QUANTITY` | 5 units |
| `MIN_ORDER_INTERVAL` | 30 seconds (rate limiter) |
| `TICK_RATE` | Every 10 seconds |

#### Effect on Market

- On bullish crossover → market buy → pushes price up → reinforces the regime
- On bearish crossover → market sell → pushes price down → reinforces the regime
- Interacts naturally with market maker's resting quotes and user orders

---

### 4.10 Data Pruner — Retention Manager

**Location**: `api-gateway/app/pruner.py` (161 LOC)
**Function**: Background task that periodically deletes old records from PostgreSQL and trims Redis streams to prevent unbounded storage growth.

#### Retention Limits (Configurable via Environment)

| Dataset | Default Limit | Logic |
|---------|--------------|-------|
| Trades | 100,000 rows | Keep newest N by timestamp |
| Orders | 50,000 rows | Keep newest N terminal-state only (never deletes open/partial) |
| Balance History | 10,000 rows | Keep newest N by created_at |
| Candles (per symbol+interval) | 5,000 rows | Keep newest N by timestamp |
| stream:trades (Redis) | 10,000 entries | XTRIM MAXLEN |
| Prune Interval | 60 seconds | Background loop delay |

#### Invariant: Open Orders Are Never Pruned

```sql
-- Only terminal states are eligible for deletion
DELETE FROM orders
WHERE status IN ('filled', 'cancelled', 'failed', 'triggered')
AND id NOT IN (
  SELECT id FROM orders
  WHERE status IN ('filled', 'cancelled', 'failed', 'triggered')
  ORDER BY created_at DESC
  LIMIT $MAX_ORDERS
)
```

---

## 5. Mathematical Models & Algorithms

### 5.1 Geometric Brownian Motion (GBM)

The price process follows the stochastic differential equation:

```
dS_t = μ·S_t·dt + σ·S_t·dW_t
```

Where:
- `S_t` — asset price at time t
- `μ` — annualized drift (expected return)
- `σ` — annualized volatility (standard deviation of returns)
- `dW_t` — Wiener process increment (Brownian motion)

#### Analytical Solution (Itô's Lemma)

The exact discrete-time solution is:

```
S(t+Δt) = S(t) · exp[ (μ - σ²/2)·Δt + σ·√Δt·Z ]

where Z ~ N(0,1)  (standard normal random variable)
```

The `σ²/2` correction (Itô correction) is essential — without it, the expected log-return would be biased upward. This term ensures the expected price follows `E[S(t)] = S(0)·exp(μt)`.

#### Scaling to Tick Frequency

The exchange simulates 100 ticks per second per symbol. Annual parameters must be scaled to per-tick:

```
Trading periods per year:
  N_tpy = 252 days × 6.5 hours × 3600 sec/hour × 100 ticks/sec
        = 252 × 6.5 × 3,600 × 100
        ≈ 589,680,000 ticks/year

Per-tick scaling:
  σ_tick = σ_annual / √N_tpy
  μ_tick = μ_annual / N_tpy

At 100 tps with σ=0.22:
  σ_tick ≈ 0.22 / √589,680,000 ≈ 0.000000286
```

This ensures that annual drift and volatility parameters in `stocks.yaml` produce realistic annual-scale price behavior.

---

### 5.2 Nine Microstructure Extensions

The base GBM is augmented with nine independent microstructure features that together produce highly realistic market behavior.

#### F1 — Hidden Markov Regime Switching

**Purpose**: Real markets alternate between bull, bear, and neutral regimes. This extension models that switching behavior.

**Mechanism**:
- Three states: `BULL`, `BEAR`, `NEUTRAL`
- Each tick: switch with probability `p = 0.0002` (≈ once per 50 seconds at 100 tps)
- Each regime has distinct drift and volatility:

| Regime | Annual Drift (μ) | Annual Volatility (σ) |
|--------|-----------------|----------------------|
| BULL | +10% | 22% |
| BEAR | −10% | 25% |
| NEUTRAL | +0.1% | 15% |

**Background Logic**: In real markets, volatility is higher during bear markets (the "leverage effect"). This is captured by BEAR having higher σ than BULL.

---

#### F2 — GARCH-like Volatility Clustering

**Purpose**: Real volatility is not constant. High-volatility periods cluster together ("volatility clusters").

**Mechanism**:
```
Realized volatility EMA:
  σ̂_t = (1 - α_v)·σ̂_{t-1} + α_v·|ln(S_t / S_{t-1})|
  α_v = 0.005  (slow adaptation)

Effective volatility (blend):
  σ_eff = (1 - w)·σ_regime + w·σ̂_t
  w = 0.40  (40% weight to realized vol)

Constraints: σ_eff ∈ [1%, 100%]
```

**Background Logic**: GARCH (Generalized AutoRegressive Conditional Heteroskedasticity) models predict that volatility tomorrow depends on volatility today. The EMA of realized moves approximates this memory effect. When prices move violently, `σ̂` rises, increasing effective volatility, which makes further violent moves more likely.

---

#### F3 — Soft Price Anchoring (Mean Reversion to VWAP Proxy)

**Purpose**: Prices tend to revert toward a "fair value" rather than drifting indefinitely.

**Mechanism**:
```
Price EMA (proxy for VWAP):
  EMA_t = (1 - α_a)·EMA_{t-1} + α_a·S_t
  α_a = 0.0001  (very slow)

Anchor reset: every 36,000 ticks (~6 minutes at 100 tps)

Post-GBM correction:
  S ← S + κ·(P_anchor - S)
  κ = 0.00002  (very weak pull)
```

**Background Logic**: This implements a weak Ornstein-Uhlenbeck mean-reversion process. The anchor price is periodically refreshed to track the current price level, preventing the correction from pulling prices back to historical levels after large trending moves.

---

#### F4 — Order-Flow Imbalance with Delayed Price Impact

**Purpose**: When more volume is on the bid than ask (or vice versa), prices tend to move in that direction — with a delay (market impact takes time to materialize).

**Mechanism**:
```
Order-flow imbalance:
  imb_t = (V_bid - V_ask) / (V_bid + V_ask)  ∈ [-1, +1]

Circular buffer: 64-entry buffer, 10-tick delay

Drift adjustment from delayed imbalance:
  Δμ_imb = λ_imb · σ_eff · imb_{t-10}
  λ_imb = 0.15
```

**Background Logic**: Market microstructure theory (Glosten-Milgrom, Kyle model) shows that order flow imbalance predicts short-term price changes. The 10-tick delay reflects the real-world latency between order submission and price impact.

---

#### F5 — Asymmetric Book Depth per Regime

**Purpose**: In bullish markets, buyers are more aggressive, creating more depth on the bid side.

**Mechanism**:
```
Depth multipliers per regime:
  BULL:    bid_bias = 1.15, ask_bias = 0.88
  BEAR:    bid_bias = 0.88, ask_bias = 1.15
  NEUTRAL: bid_bias = 1.00, ask_bias = 1.00

Applied to size at each LOB level:
  bid_size_k = base_size_k × bid_bias
  ask_size_k = base_size_k × ask_bias
```

**Background Logic**: Real order books are not symmetric. In bull markets, there is typically more resting buy liquidity (buyers wanting to enter on dips) and less sell-side depth (sellers hold inventory).

---

#### F6 — Hidden Drift (Ornstein-Uhlenbeck Process)

**Purpose**: Real markets have slowly evolving latent drift components that are not directly observable — institutional order flow, sentiment shifts, sector rotations.

**Mechanism**:
```
OU process for hidden drift θ:
  θ_{t+1} = θ_t - κ_θ·θ_t + (ν_θ / √N_tpy) · Z
  κ_θ = 0.001  (mean-reversion speed; half-life ≈ 11.5 min at 100 tps)
  ν_θ = 0.02   (annual volatility of hidden drift)

Constraint: |θ| ≤ 0.30 (30% max annual hidden drift)

Contribution to per-tick drift:
  Δμ_hidden = θ_t / N_tpy
```

**Background Logic**: The OU process is mean-reverting around zero — hidden drift eventually dissipates. But over short windows (minutes), it creates persistent directional biases that resemble real institutional flows.

---

#### F7 — Power-Law Order Sizes (Pareto Blend)

**Purpose**: Real order sizes are not normally distributed. Large orders appear far more frequently than a Gaussian model predicts, following a power law.

**Mechanism**:
```
Pareto distribution sample:
  X_Pareto = 1 / U^(1/α_P),  U ~ Uniform(0,1)
  α_P = 1.3  (heavy tail exponent)
  Clipped to [1, 20]

Blended size (per LOB level k):
  size_k = (1 - β) · exp(-δk) · (1 + ε·Z_k)   [normal-distributed]
          + β · exp(-δk) · X_Pareto              [Pareto-distributed]
  β = 0.55  (55% weight to Pareto component)
  δ = 0.30  (exponential decay across levels)
  ε = 0.35  (noise factor)
```

**Background Logic**: Empirical studies (Gabaix et al., 2003) show that the distribution of trade sizes in real markets follows a power law with exponent ≈ 1.5. Pareto with α=1.3 produces a heavier tail, reflecting that very large orders (institutional block trades) are more likely than normal distributions predict.

---

#### F8 — Dynamic Spread Widening with Volatility

**Purpose**: Market makers widen spreads during volatile periods to compensate for inventory risk.

**Mechanism**:
```
Base half-spread:
  f_base = 2×10⁻⁶  (2 basis points)

Dynamic half-spread:
  f = f_base · (1 + γ · max(0, σ̂_t/σ_eff - 1))
  γ = 0.50  (spread sensitivity to excess volatility)

Cap: f ≤ 3 × f_base  (6 basis points maximum)

Bid/Ask construction:
  ask = mid × (1 + f)
  bid = mid × (1 - f)
```

**Background Logic**: Glosten-Milgrom adverse selection theory: when realized volatility exceeds expected volatility (σ̂ > σ_eff), market makers face greater adverse selection risk and widen spreads. The cap prevents unrealistically wide spreads during brief volatility spikes.

---

#### F9 — Volume Clustering (OU Process)

**Purpose**: Trading volume is not constant — it clusters at market open/close and around events.

**Mechanism**:
```
OU process for volume multiplier V_t:
  V_{t+1} = V_t - κ_V·(V_t - V̄) + ν_V · Z
  V̄ = 1.0   (mean volume multiplier)
  κ_V = 0.005 (mean-reversion speed)
  ν_V = 0.01  (noise)

Clipped to [0.1, 3.0]

Applied to order sizes:
  final_size = base_size × max(0.1, V_t)
```

**Background Logic**: Volume clustering is well-documented in market microstructure literature. It creates realistic periods of low activity (quiet markets) and high activity (news events, large participant activity), even without an explicit event clock.

---

### 5.3 Price-Time Priority Matching

The matching engine implements the standard exchange matching rule:

```
Priority 1: Price — best price for the aggressor (lowest ask for buy, highest bid for sell)
Priority 2: Time  — within the same price level, oldest resting order fills first (FIFO)
```

**Example**:
```
Orderbook asks:
  $180.00: [Order A: 50 shares (oldest), Order B: 30 shares]
  $180.05: [Order C: 100 shares]

Incoming BUY market order: 70 shares

Matching sequence:
  1. Fill from $180.00 first (best ask):
     - Match Order A: 50 shares @ $180.00  (FIFO — A is older than B)
     - Match Order B: 20 shares @ $180.00  (only 20 remain of the 70)
  2. Order fully filled at 70 shares, avg price $180.00

If incoming BUY limit @ $180.00: 70 shares
  Same result — $180.00 ≤ $180.00 (limit met)

If incoming BUY limit @ $179.95: 70 shares
  - $180.00 > $179.95 (limit not met)
  - No fills; order rests on bid book @ $179.95
```

---

### 5.4 Volume-Weighted Average Cost (VWAC)

When a user buys in multiple fills at different prices, the portfolio tracks cost basis using VWAC:

```
new_avg_cost = (old_avg_cost × old_qty + trade_price × trade_qty) / (old_qty + trade_qty)
```

**Example**:
```
Step 1: Buy 10 shares @ $180.00
  avg_cost = $180.00, qty = 10

Step 2: Buy 5 more shares @ $182.00
  new_avg_cost = (180.00 × 10 + 182.00 × 5) / (10 + 5)
               = (1800 + 910) / 15
               = $180.67
  qty = 15

Step 3: Buy 5 more @ $178.00
  new_avg_cost = (180.67 × 15 + 178.00 × 5) / 20
               = (2710 + 890) / 20
               = $180.00
  qty = 20
```

VWAC correctly reflects the blended cost basis across all purchases, giving accurate P&L measurements.

---

### 5.5 P&L Calculation Engine

**Unrealized P&L** (per position, computed at query time):
```
market_value    = current_price × quantity
cost_basis      = avg_cost × quantity
unrealized_pnl  = market_value - cost_basis
               = (current_price - avg_cost) × quantity
pnl_pct         = (unrealized_pnl / cost_basis) × 100
```

**Portfolio Totals**:
```
total_portfolio_value = Σ(current_price_i × quantity_i) for all positions
total_unrealized_pnl  = Σ(unrealized_pnl_i) for all positions
total_account_value   = cash_balance + total_portfolio_value
```

`current_price` is fetched live from Redis (`price:{symbol}`) at query time, ensuring P&L reflects the most recent trade price.

---

### 5.6 OHLCV Bucket Aggregation

Candles are computed by bucketing trades into fixed time windows:

```
bucket_start = floor(timestamp_ms / interval_ms) × interval_ms

Example: trade at 14:32:47.523, interval = 1m (60,000 ms)
  bucket_start = floor(1234567800000 + 47523 / 60000) × 60000
               = bucket starting at 14:32:00.000
```

OHLCV within a bucket:
```
open  = price of first trade in bucket
high  = max(price) of all trades in bucket
low   = min(price) of all trades in bucket
close = price of last trade in bucket
volume = Σ(quantity) of all trades in bucket
```

The PostgreSQL UPSERT uses `GREATEST` and `LEAST` to correctly handle concurrent or out-of-order updates to the same bucket.

---

## 6. Order Lifecycle & State Machine

### 6.1 Limit & Market Orders

```
                    ┌─────────────────┐
                    │    SUBMITTED    │ ← API returns this immediately
                    └────────┬────────┘
                             │ Fill Processor processes trade(s)
                             ▼
                         ┌────────┐
                         │  OPEN  │ ← No fills yet (resting on book)
                         └───┬────┘
                             │
              ┌──────────────┼──────────────────┐
              ▼              ▼                  ▼
         ┌─────────┐   ┌──────────┐      ┌────────────┐
         │ PARTIAL │   │  FILLED  │      │ CANCELLED  │
         │ (some   │   │ (fully   │      │ (user req) │
         │ fills)  │   │ matched) │      └────────────┘
         └────┬────┘   └──────────┘
              │
     ┌────────┴────────┐
     ▼                 ▼
┌──────────┐     ┌──────────┐
│  FILLED  │     │CANCELLED │
└──────────┘     └──────────┘
```

**Market orders** are Immediate-or-Cancel: they match as much as possible then the remainder is discarded (never rest on book). Market orders cannot be cancelled after submission.

---

### 6.2 Stop-Limit & Stop-Market Orders

```
              ┌────────────────────┐
              │  PENDING_TRIGGER   │ ← API returns this; Trigger Engine holds it
              └──────────┬─────────┘
                         │
           ┌─────────────┼───────────────┐
           ▼             │               ▼
    ┌──────────────┐     │        ┌──────────────┐
    │  CANCELLED   │     │        │   TRIGGERED  │ ← Price crossed stop_price
    │ (user cancel │     │        └──────┬───────┘
    │  while       │     │               │ New limit/market order submitted
    │  pending)    │     │               ▼
    └──────────────┘     │    ┌──────────────────────┐
                         │    │ [Limit/Market Order]  │
                         │    │ OPEN → PARTIAL        │
                         │    │      → FILLED         │
                         │    └──────────────────────┘
                         │
                    (30-day default expiry)
```

**Stop trigger conditions**:
- `SELL` stop: triggers when `mid_price ≤ stop_price`
- `BUY` stop: triggers when `mid_price ≥ stop_price`

---

### 6.3 End-to-End Flow: Buy Limit Example

```
User → POST /api/v1/orders
       {symbol: "AAPL_S", type: "limit", side: "buy", price: 180.00, quantity: 10}
         │
         ▼
API Gateway
  1. Validate request (price > 0, qty > 0, symbol valid)
  2. INSERT orders (status='open')
  3. Send JSON to matching engine (TCP)
  4. Return {order_id, status: "submitted"}
         │
         ▼ (async, ~ms later)
Matching Engine
  1. Check orderbook asks
  2. Best ask = $179.95 (< $180.00 limit) → FILL
  3. Execute trade: 10 shares @ $179.95
  4. Publish to stream:trades
  5. Publish to trades:AAPL_S (pub/sub)
  6. Update price:AAPL_S hash
         │
         ▼ (async)
Fill Processor
  1. Consume from stream:trades
  2. INSERT trades (id, symbol, price=179.95, qty=10, buyer_id, seller_id)
  3. UPDATE orders SET filled_qty=10, status='filled' WHERE id=buy_order_id
  4. UPDATE orders SET filled_qty=10, status='filled' WHERE id=sell_order_id
  5. UPSERT portfolios: buyer qty+=10, avg_cost=179.95
  6. UPDATE users: buyer balance -= 1799.50
  7. INSERT balance_history: (delta=-1799.50, reason='trade_buy', ...)
  8. UPDATE portfolios: seller qty-=10
  9. UPDATE users: seller balance += 1799.50
 10. INSERT balance_history: (delta=+1799.50, reason='trade_sell', ...)
         │
         ▼ (async)
WebSocket Service
  - Broadcasts trade event to all /ws/AAPL_S subscribers
  - Updates orderbook snapshot

User → GET /api/v1/me
  Returns: AAPL_S position (qty=10, avg_cost=179.95), balance=$98,200.50
```

---

### 6.4 End-to-End Flow: Stop-Limit Example

```
User → POST /api/v1/orders
       {symbol: "AAPL_S", type: "stop_limit", side: "sell",
        stop_price: 175.00, limit_price: 174.80, quantity: 10}
         │
         ▼
API Gateway
  1. Validate (stop_price + limit_price required for stop_limit)
  2. INSERT orders (status='pending_trigger', stop_price=175, limit_price=174.80)
  3. PUBLISH stop_orders:new (Redis)
  4. Return {order_id, status: "pending_trigger", expires_at: "2026-05-01"}
         │
         ▼ (Trigger Engine reads from Redis pub/sub)
Trigger Engine
  - Stores order in memory: {order_id, symbol, side='sell', stop=175, limit=174.80}
  - Monitors price:AAPL_S Redis hash
         │
         ▼ (time passes; market falls)
  price:AAPL_S updates: $180 → $177 → $175.50 → $175.00
  Check: 175.00 ≤ 175.00 → TRIGGERED
         │
         ▼
Trigger Engine on trigger:
  1. UPDATE orders SET status='triggered'  (PostgreSQL)
  2. POST limit order to matching engine:  {side='sell', price=174.80, qty=10}
  3. PUBLISH stop_triggered:user_id  (Redis)
         │
         ├─▶ WebSocket Service → User's /ws/orders/{user_id}
         │     {type: "stop_triggered", order_id, symbol, stop_price: 175}
         │
         └─▶ Matching Engine matches the new limit order
               → Fill Processor settles → balance credited
```

---

## 7. Data Architecture

### 7.1 PostgreSQL Schema

#### users
```sql
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      VARCHAR(50) UNIQUE NOT NULL,
    email         VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,           -- bcrypt hash
    balance       DECIMAL(18,2) DEFAULT 100000.00, -- virtual cash
    created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

#### orders
```sql
CREATE TABLE orders (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id),
    symbol      VARCHAR(20) NOT NULL,
    order_type  VARCHAR(15) NOT NULL  -- 'limit' | 'market' | 'stop_limit' | 'stop_market'
                CHECK (order_type IN ('limit','market','stop_limit','stop_market')),
    side        VARCHAR(4) NOT NULL   -- 'buy' | 'sell'
                CHECK (side IN ('buy','sell')),
    price       DECIMAL(18,6),        -- NULL for market orders
    stop_price  DECIMAL(18,6),        -- trigger price for stop orders
    limit_price DECIMAL(18,6),        -- execution price for stop_limit
    quantity    DECIMAL(18,6) NOT NULL,
    filled_qty  DECIMAL(18,6) DEFAULT 0,
    status      VARCHAR(20) NOT NULL  -- see lifecycle states above
                CHECK (status IN ('open','partial','filled','cancelled',
                                  'failed','pending_trigger','triggered')),
    expires_at  TIMESTAMPTZ,           -- GTC=NULL; stop default=30 days
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ
);
-- Indexes: user_id, (symbol, status), created_at DESC, status='pending_trigger'
```

#### trades
```sql
CREATE TABLE trades (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol       VARCHAR(20) NOT NULL,
    buy_order_id UUID REFERENCES orders(id),
    sell_order_id UUID REFERENCES orders(id),
    price        DECIMAL(18,6) NOT NULL,
    quantity     DECIMAL(18,6) NOT NULL,
    buyer_id     UUID REFERENCES users(id),
    seller_id    UUID REFERENCES users(id),
    timestamp    TIMESTAMPTZ DEFAULT NOW()
);
-- Indexes: (symbol, timestamp DESC), buyer_id, seller_id
```

#### portfolios
```sql
CREATE TABLE portfolios (
    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id  UUID NOT NULL REFERENCES users(id),
    symbol   VARCHAR(20) NOT NULL,
    quantity DECIMAL(18,6) DEFAULT 0,
    avg_cost DECIMAL(18,6) DEFAULT 0,  -- Volume-weighted average cost
    UNIQUE(user_id, symbol)
);
```

#### candles
```sql
CREATE TABLE candles (
    symbol    VARCHAR(20) NOT NULL,
    interval  VARCHAR(5) NOT NULL     -- '1s' | '10s' | '1m'
              CHECK (interval IN ('1s','10s','1m')),
    open      DECIMAL(18,6) NOT NULL,
    high      DECIMAL(18,6) NOT NULL,
    low       DECIMAL(18,6) NOT NULL,
    close     DECIMAL(18,6) NOT NULL,
    volume    DECIMAL(18,6) DEFAULT 0,
    timestamp TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (symbol, interval, timestamp)
);
-- Index: (symbol, interval, timestamp DESC)
```

#### balance_history
```sql
CREATE TABLE balance_history (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id),
    delta      DECIMAL(18,2) NOT NULL,    -- signed change (negative=debit)
    balance    DECIMAL(18,2) NOT NULL,    -- running balance AFTER this event
    reason     VARCHAR(20) NOT NULL       -- 'trade_buy' | 'trade_sell'
               CHECK (reason IN ('trade_buy','trade_sell')),
    symbol     VARCHAR(20),
    quantity   DECIMAL(18,6),
    price      DECIMAL(18,6),
    trade_id   UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Index: (user_id, created_at DESC)
```

---

### 7.2 Redis Data Structures

#### Pub/Sub Channels (Event Bus)

| Channel | Producer | Consumer(s) | Payload |
|---------|----------|-------------|---------|
| `trades:{symbol}` | Matching Engine | WebSocket Service | Trade event JSON |
| `orderbook:{symbol}` | Matching Engine | WebSocket Service | Orderbook snapshot JSON |
| `candles:{symbol}:{interval}` | Candle Service | WebSocket Service | Closed candle JSON |
| `market_data:{symbol}` | Market Generator | WebSocket Service | Raw L2 orderbook JSON |
| `stop_triggered:{user_id}` | Trigger Engine | WebSocket Service | Stop trigger event JSON |
| `stop_orders:new` | API Gateway | Trigger Engine | New stop order JSON |
| `stop_orders:cancel` | API Gateway | Trigger Engine | Cancel stop order JSON |

#### Streams (Durable Message Log)

| Stream | Producer | Consumers | Retention |
|--------|----------|-----------|-----------|
| `stream:trades` | Matching Engine | Fill Processor (consumer group), Candle Service (consumer group) | Pruned to 10k entries |

Redis Streams provide durable, replayable, consumer-group semantics — trade events are not lost even if consumers restart.

#### Hashes (Point-in-Time State)

| Key | Fields | Updated By |
|-----|--------|------------|
| `price:{symbol}` | `price`, `volume`, `timestamp` | Matching Engine |

#### Sorted Sets (Time-Series Cache)

| Key | Score | Value | Retention |
|-----|-------|-------|-----------|
| `candles:{symbol}:1s` | bucket_start (unix ms) | JSON candle | Newest 1,000 |
| `candles:{symbol}:10s` | bucket_start | JSON candle | Newest 1,000 |
| `candles:{symbol}:1m` | bucket_start | JSON candle | Newest 1,000 |

Sorted sets enable O(log N) range queries by time: `ZRANGEBYSCORE candles:AAPL_S:1m <start> <end>`.

#### Strings (Short-Lived Cache)

| Key | Value | TTL |
|-----|-------|-----|
| `orderbook:snapshot:{symbol}` | Orderbook JSON | 5 seconds |

---

### 7.3 Message Bus Topology

```
┌──────────────────────────────────────────────────────────────────────┐
│                        REDIS MESSAGE BUS                             │
│                                                                      │
│  STREAMS (durable):                                                  │
│  ─────────────────                                                   │
│  stream:trades ──────────▶ fill-processor-group (Fill Processor)    │
│                     └──▶ candle-service-group (Candle Service)      │
│                                                                      │
│  PUB/SUB CHANNELS (ephemeral):                                       │
│  ──────────────────────────────                                      │
│  trades:{symbol}     ──▶ WebSocket Service (→ /ws/{symbol} clients) │
│  orderbook:{symbol}  ──▶ WebSocket Service (→ /ws/{symbol} clients) │
│  candles:{s}:{i}     ──▶ WebSocket Service (→ /ws/{symbol} clients) │
│  market_data:{s}     ──▶ WebSocket Service (→ /ws/market/{s})       │
│  stop_triggered:{uid}──▶ WebSocket Service (→ /ws/orders/{uid})     │
│  stop_orders:new     ──▶ Trigger Engine (C++)                       │
│  stop_orders:cancel  ──▶ Trigger Engine (C++)                       │
│                                                                      │
│  KEY-VALUE:                                                          │
│  ──────────                                                          │
│  price:{symbol}           ──▶ Trigger Engine, Market Maker, Alpha   │
│  orderbook:snapshot:{s}   ──▶ API Gateway REST endpoint             │
│  candles:{symbol}:{i}     ──▶ Alpha Bot, API Gateway                │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 8. API Reference

### 8.1 Authentication

#### Register

```
POST /api/v1/auth/register
Content-Type: application/json

{
  "username": "alice",
  "email": "alice@example.com",
  "password": "secure123"
}

Response 201:
{
  "access_token": "eyJhbGc...",
  "token_type": "bearer",
  "user_id": "uuid",
  "username": "alice"
}
```

#### Login

```
POST /api/v1/auth/login
Content-Type: application/json

{
  "username": "alice",
  "password": "secure123"
}

Response 200:
{
  "access_token": "eyJhbGc...",
  "token_type": "bearer",
  "user_id": "uuid",
  "username": "alice"
}
```

**Token usage**: `Authorization: Bearer <access_token>`
**Expiry**: 24 hours

---

### 8.2 Order Management

#### Place Order

```
POST /api/v1/orders
Authorization: Bearer <token>

# Limit order:
{
  "symbol": "AAPL_S",
  "type": "limit",
  "side": "buy",
  "price": 180.00,
  "quantity": 10.0
}

# Market order:
{
  "symbol": "AAPL_S",
  "type": "market",
  "side": "buy",
  "quantity": 10.0
}

# Stop-Limit order:
{
  "symbol": "AAPL_S",
  "type": "stop_limit",
  "side": "sell",
  "stop_price": 175.00,
  "limit_price": 174.80,
  "quantity": 10.0
}

# Stop-Market order:
{
  "symbol": "AAPL_S",
  "type": "stop_market",
  "side": "sell",
  "stop_price": 175.00,
  "quantity": 10.0
}
```

**Response (limit/market)**:
```json
{
  "order_id": "uuid",
  "status": "submitted",
  "symbol": "AAPL_S",
  "order_type": "limit",
  "side": "buy",
  "price": 180.00,
  "quantity": 10.0
}
```

**Response (stop orders)**:
```json
{
  "order_id": "uuid",
  "status": "pending_trigger",
  "symbol": "AAPL_S",
  "order_type": "stop_limit",
  "side": "sell",
  "stop_price": 175.00,
  "limit_price": 174.80,
  "quantity": 10.0,
  "expires_at": "2026-05-01T00:00:00+00:00"
}
```

#### List Orders

```
GET /api/v1/orders?symbol=AAPL_S&status=open&limit=50
Authorization: Bearer <token>

Response 200: [OrderObject, ...]
```

Query parameters: `symbol`, `status`, `limit` (default 50)

#### Get Single Order

```
GET /api/v1/orders/{order_id}
Authorization: Bearer <token>

Response 200: OrderObject
```

#### Cancel Order

```
DELETE /api/v1/orders/{order_id}
Authorization: Bearer <token>

Response 200: {"message": "Order cancelled successfully"}
```

Cancellable statuses: `open`, `partial`, `pending_trigger`
Market orders in flight cannot be cancelled.

---

### 8.3 Portfolio & Account

#### Full Account Snapshot

```
GET /api/v1/me
Authorization: Bearer <token>

Response 200:
{
  "user_id": "uuid",
  "username": "alice",
  "email": "alice@example.com",
  "cash_balance": 95000.00,
  "portfolio": [
    {
      "symbol": "AAPL_S",
      "quantity": 10.0,
      "avg_cost": 179.95,
      "current_price": 182.50,
      "market_value": 1825.00,
      "unrealized_pnl": 25.50,
      "pnl_pct": 1.42
    }
  ],
  "total_portfolio_value": 1825.00,
  "total_unrealized_pnl": 25.50,
  "total_account_value": 96825.00,
  "created_at": "2026-03-30T10:00:00+00:00"
}
```

#### Holdings Only

```
GET /api/v1/portfolio
Authorization: Bearer <token>

Response 200: [PortfolioPosition, ...]
```

#### Personal Trade History

```
GET /api/v1/my/trades?limit=50
Authorization: Bearer <token>

Response 200:
[
  {
    "trade_id": "uuid",
    "symbol": "AAPL_S",
    "side": "buy",
    "price": 179.95,
    "quantity": 10.0,
    "total": 1799.50,
    "order_id": "uuid",
    "timestamp": "2026-04-01T14:32:47+00:00"
  }
]
```

#### Balance Ledger

```
GET /api/v1/my/balance-history?limit=100
Authorization: Bearer <token>

Response 200:
[
  {
    "id": "uuid",
    "delta": -1799.50,
    "balance": 98200.50,
    "reason": "trade_buy",
    "symbol": "AAPL_S",
    "quantity": 10.0,
    "price": 179.95,
    "trade_id": "uuid",
    "created_at": "2026-04-01T14:32:47+00:00"
  }
]
```

---

### 8.4 Market Data (REST)

#### All Symbols

```
GET /api/v1/stocks

Response 200:
[
  {
    "symbol": "AAPL_S",
    "name": "Apple Inc. (Synthetic)",
    "initial_price": 180.0,
    "drift": 0.08,
    "volatility": 0.22
  },
  ...
]
```

#### Current Ticker

```
GET /api/v1/ticker/{symbol}

Response 200:
{
  "symbol": "AAPL_S",
  "price": 182.43,
  "volume": 1234.5,
  "timestamp": 1711987200000
}
```

#### Orderbook Snapshot

```
GET /api/v1/orderbook/{symbol}

Response 200:
{
  "event": "orderbook",
  "symbol": "AAPL_S",
  "timestamp": 1711987200000,
  "bids": [[182.40, 50], [182.35, 120], ...],  // descending (best bid first)
  "asks": [[182.45, 30], [182.50, 80], ...]    // ascending (best ask first)
}
```

Top 20 levels per side. Cached 5 seconds in Redis.

#### OHLCV Candles

```
GET /api/v1/candles/{symbol}?interval=1m&limit=100

Query params:
  interval: "1s" | "10s" | "1m"  (default: "1m")
  limit: integer (default: 100, max: 1000)

Response 200:
{
  "symbol": "AAPL_S",
  "interval": "1m",
  "candles": [
    {
      "open": 182.10,
      "high": 182.55,
      "low": 181.90,
      "close": 182.43,
      "volume": 342.0,
      "timestamp": "2026-04-01T14:32:00+00:00"
    },
    ...
  ]
}
```

#### Recent Public Trades

```
GET /api/v1/trades/{symbol}?limit=50

Response 200:
[
  {
    "price": 182.43,
    "quantity": 10.0,
    "timestamp": "2026-04-01T14:32:47+00:00"
  },
  ...
]
```

---

### 8.5 WebSocket Feeds

#### Market Data Stream: `/ws/{symbol}`

Connect: `ws://host:8001/ws/AAPL_S`

Default subscriptions: `trades`, `orderbook`, `candles:1m`

**Update subscriptions** (client → server):
```json
{"subscribe": ["trades", "orderbook", "candles:1s", "candles:10s", "candles:1m"]}
```

**Trade event** (server → client):
```json
{
  "event": "trade",
  "trade_id": "uuid",
  "symbol": "AAPL_S",
  "price": 182.43,
  "quantity": 10.0,
  "buy_order_id": "uuid",
  "sell_order_id": "uuid",
  "buyer_id": "uuid",
  "seller_id": "uuid",
  "timestamp": 1711987200000
}
```

**Orderbook snapshot** (server → client):
```json
{
  "event": "orderbook",
  "symbol": "AAPL_S",
  "timestamp": 1711987200000,
  "bids": [[182.40, 50], [182.35, 120]],
  "asks": [[182.45, 30], [182.50, 80]]
}
```

**Candle close** (server → client):
```json
{
  "event": "candle",
  "symbol": "AAPL_S",
  "interval": "1m",
  "open": 182.10,
  "high": 182.55,
  "low": 181.90,
  "close": 182.43,
  "volume": 342.0,
  "timestamp": 1711987200000
}
```

**Keepalive** (server → client, every 30s):
```json
{"type": "ping"}
```

---

#### Stop Order Notifications: `/ws/orders/{user_id}`

Connect: `ws://host:8001/ws/orders/<your_user_id>`

**Stop triggered event** (server → client):
```json
{
  "type": "stop_triggered",
  "order_id": "uuid",
  "symbol": "AAPL_S",
  "side": "sell",
  "order_type": "stop_limit",
  "stop_price": 175.00,
  "triggered_at": 1711987200000,
  "status": "triggered"
}
```

---

#### Raw L2 Feed @ 100 Hz: `/ws/market/{symbol}`

Connect: `ws://host:8001/ws/market/AAPL_S`

**Market data tick** (server → client, ~every 10ms):
```json
{
  "type": "market_data",
  "symbol": "AAPL_S",
  "tick": 12345,
  "ts": 1711987200123,
  "mid": 182.43,
  "spread": 0.18,
  "spread_pct": 0.099,
  "asks": [
    {"price": 182.52, "size": 1000},
    {"price": 182.61, "size": 500},
    ...
  ],
  "bids": [
    {"price": 182.34, "size": 1000},
    {"price": 182.25, "size": 700},
    ...
  ]
}
```

---

## 9. Synthetic Instruments

Five instruments modeled after real equities, with parameters calibrated to historical behavior:

| Symbol | Name | Base Price | Annual Drift | Annual Volatility | Personality |
|--------|------|-----------|-------------|------------------|-------------|
| `AAPL_S` | Apple Inc. (Synthetic) | ~$180 | 8% | 22% | Steady growth, moderate vol |
| `GOOGL_S` | Alphabet Inc. (Synthetic) | ~$140 | 7% | 25% | Slightly higher vol |
| `TSLA_S` | Tesla Inc. (Synthetic) | ~$250 | 5% | 55% | High volatility, unpredictable |
| `MSFT_S` | Microsoft Corp. (Synthetic) | ~$375 | 9% | 20% | Highest drift, lowest vol |
| `AMZN_S` | Amazon.com Inc. (Synthetic) | ~$185 | 8% | 28% | Growth stock with elevated vol |

Instruments are defined in `shared/config/stocks.yaml` and are fully customizable. New symbols can be added by appending entries to the YAML file.

---

## 10. Technology Stack

### Performance Core — C++

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Matching Engine | C++17, CMake | LOB matching, price-time priority |
| Market Generator | C++17, CMake | GBM price simulation |
| Trigger Engine | C++17, CMake | Stop order monitoring & execution |
| JSON | nlohmann/json | Order parsing & serialization |
| YAML | yaml-cpp | Stock configuration |
| Redis C Client | hiredis | Real-time pub/sub & streams |
| PostgreSQL C Client | libpq | Direct DB queries from C++ services |
| Concurrency | pthread | Thread pinning, lock-free queues |

### Services Layer — Python

| Component | Technology | Purpose |
|-----------|-----------|---------|
| API Gateway | FastAPI 0.111.0 | REST framework with OpenAPI docs |
| ASGI Server | Uvicorn | High-performance async server |
| PostgreSQL | asyncpg | Async PostgreSQL driver |
| Redis | redis[asyncio] | Async pub/sub & stream consumer |
| WebSocket | FastAPI WebSockets | Client connection management |
| Data Validation | Pydantic 2.7.1 | Request/response schemas |
| Configuration | pydantic-settings | Environment variable management |
| Authentication | python-jose, passlib | JWT tokens, bcrypt hashing |
| HTTP Client | httpx | Bot-to-API communication |

### Infrastructure

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Database | PostgreSQL 16 | Persistent data storage |
| Cache & Bus | Redis 7.2 | Real-time messaging, caching |
| Orchestration | Docker Compose | Multi-container deployment |
| Config | YAML + dotenv | Per-symbol & per-service config |

---

## 11. Infrastructure & Deployment

### Service Topology (Docker Compose)

```
┌─────────────────────────────────────────────────────────────────┐
│  Docker Network: synthbull_default                              │
│                                                                 │
│  Infrastructure:                                                │
│  ┌────────────────┐    ┌────────────────────────────────┐      │
│  │  postgres:5432 │    │         redis:6379             │      │
│  │  (PostgreSQL16)│    │         (Redis 7.2)            │      │
│  └────────────────┘    └────────────────────────────────┘      │
│                                                                 │
│  C++ Core:                                                      │
│  ┌──────────────────┐  ┌───────────────────┐                   │
│  │ matching-engine  │  │  market-generator │                   │
│  │ :9000 (internal) │  │  (no ext port)    │                   │
│  └──────────────────┘  └───────────────────┘                   │
│  ┌──────────────────┐                                          │
│  │  trigger-engine  │                                          │
│  │  (no ext port)   │                                          │
│  └──────────────────┘                                          │
│                                                                 │
│  Python Services:                                               │
│  ┌──────────────────┐  ┌──────────────────┐                   │
│  │  api-gateway     │  │  websocket-svc   │                   │
│  │  :8000 (exposed) │  │  :8001 (exposed) │                   │
│  └──────────────────┘  └──────────────────┘                   │
│  ┌──────────────────┐                                          │
│  │  candle-service  │                                          │
│  │  (no ext port)   │                                          │
│  └──────────────────┘                                          │
│                                                                 │
│  Bots:                                                          │
│  ┌──────────────────┐  ┌──────────────────┐                   │
│  │ market-maker-bot │  │    alpha-bot      │                   │
│  │  (no ext port)   │  │  (no ext port)   │                   │
│  └──────────────────┘  └──────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘

External access:
  REST:      http://localhost:8000
  WebSocket: ws://localhost:8001
  Docs:      http://localhost:8000/docs  (OpenAPI Swagger UI)
```

### Quick Start

```bash
# 1. Clone repository
git clone <repo-url>
cd backend

# 2. Configure environment
cp .env.example .env
# Edit .env if needed (defaults work out of the box)

# 3. Launch all services
docker-compose up --build

# 4. Access
# REST API: http://localhost:8000
# API Docs: http://localhost:8000/docs
# WebSocket: ws://localhost:8001
```

### Health Check

```
GET http://localhost:8000/health

Response 200:
{"status": "healthy"}
```

### Startup Order (Docker Compose Dependencies)

```
postgres → redis → matching-engine → market-generator
       → trigger-engine → api-gateway → candle-service
       → websocket-service → market-maker-bot → alpha-bot
```

---

## 12. Configuration Reference

### Environment Variables

```bash
# ─── Database ─────────────────────────────────────────────────
POSTGRES_USER=synthbull
POSTGRES_PASSWORD=synthbull_pass
POSTGRES_DB=synthbull
POSTGRES_URL=postgresql://synthbull:synthbull_pass@postgres:5432/synthbull

# ─── Redis ────────────────────────────────────────────────────
REDIS_URL=redis://redis:6379

# ─── Authentication ───────────────────────────────────────────
JWT_SECRET=change-me-in-production        # CHANGE THIS IN PRODUCTION
JWT_EXPIRE_MINUTES=1440                   # 24 hours

# ─── Matching Engine ──────────────────────────────────────────
ENGINE_HOST=matching-engine
ENGINE_PORT=9000

# ─── Market Generator ─────────────────────────────────────────
MARKET_TPS=100                            # Ticks per second per symbol
STOCKS_CONFIG=/shared/config/stocks.yaml

# ─── Bot Credentials (created on first docker-compose up) ─────
MM_BOT_USERNAME=market_maker_bot
MM_BOT_PASSWORD=mmbot_pass
ALPHA_BOT_USERNAME=alpha_bot
ALPHA_BOT_PASSWORD=alphabot_pass

# ─── Data Retention (Pruner) ──────────────────────────────────
MAX_TRADES=100000                # Max trades rows to keep
MAX_ORDERS=50000                 # Max terminal-state order rows
MAX_BALANCE_HISTORY=10000        # Max balance_history rows
MAX_CANDLES_PG=5000              # Max candles per (symbol, interval)
MAX_STREAM_LEN=10000             # Max entries in stream:trades
PRUNE_INTERVAL_S=60              # Pruner run frequency (seconds)
```

### Instrument Configuration (`shared/config/stocks.yaml`)

```yaml
stocks:
  - symbol: AAPL_S
    name: "Apple Inc. (Synthetic)"
    initial_price: 180.0
    drift: 0.08          # 8% annual expected return
    volatility: 0.22     # 22% annual volatility

  - symbol: TSLA_S
    name: "Tesla Inc. (Synthetic)"
    initial_price: 250.0
    drift: 0.05
    volatility: 0.55     # High-volatility asset
```

Add new instruments by appending to this file. All services automatically pick up the new symbol on next startup.

---

## 13. Use Cases & Target Audience

### Primary Use Cases

#### 1. Algorithmic Trading Education
Learn to build trading algorithms against a realistic exchange without financial risk. The platform provides:
- Real order types (limit, market, stop-limit, stop-market)
- Real market microstructure (spread, depth, volatility regimes)
- Real-time WebSocket feeds compatible with real exchange protocols
- Historical candle data for backtesting strategy signals

#### 2. Trading Platform Frontend Development
Build trading UIs — charts, order entry, portfolio dashboards — against a full-featured backend API. The REST API and WebSocket protocol are designed to mirror real exchange APIs, making the transition to a live exchange straightforward.

#### 3. Quantitative Finance Research & Education
Study market microstructure phenomena in a controlled, reproducible environment:
- Observe order book dynamics at millisecond resolution
- Study the interaction between market maker quotes and aggressive orders
- Test hypothesis about regime switching, volatility clustering, and price anchoring
- Examine stop-order cascade effects

#### 4. FinTech Product Prototyping
Prototype trading features — paper trading accounts, portfolio analytics, risk metrics — against a realistic but risk-free exchange, before connecting to real brokerage APIs.

#### 5. Trading Bot Development & Testing
Test algorithmic strategies in a realistic environment:
- Market-making strategies (observe spread capture vs. adverse selection)
- Momentum/trend strategies (SMA crossover, breakout)
- Statistical arbitrage between the 5 correlated symbols
- Risk management strategies (stop-loss effectiveness)

#### 6. Interview Preparation & Competitions
Prepare for trading firm interviews and university trading competitions by practicing strategy development in a realistic environment.

---

### Target Audience

| Segment | Value Proposition |
|---------|------------------|
| **Individual Traders** | Learn order types, market mechanics, risk management without financial risk |
| **CS/Finance Students** | Realistic trading environment for coursework, projects, and competitions |
| **FinTech Developers** | Production-quality API to build trading frontends and backends against |
| **Quant Researchers** | Configurable GBM with 9 microstructure extensions for academic research |
| **Trading Firms** | Internal training tool, intern onboarding, strategy prototyping sandbox |
| **EdTech Platforms** | Embeddable trading simulation engine for courses and certifications |

---

## 14. Competitive Positioning

### Synthetic-Bull vs. Alternatives

| Feature | Synthetic-Bull | Paper Trading Brokers | Basic Simulators | Academic Models |
|---------|---------------|----------------------|-----------------|-----------------|
| **Real LOB matching engine** | C++ price-time priority | Broker simulation | None | None |
| **GBM with microstructure** | 9 extensions | Random walk | Simple random | Varies |
| **Stop orders** | Server-side, durable | Yes | Rarely | No |
| **Real-time WebSocket** | 100 Hz L2 + trades | Yes (throttled) | No | No |
| **Autonomous counterparties** | Market maker + alpha | Real users | No | No |
| **Full settlement pipeline** | VWAC + ledger | Yes | Partial | No |
| **Self-hosted / open** | Yes — Docker | No | Sometimes | Academic |
| **API-first design** | Full REST + WS | Limited | No | No |
| **Configurable instruments** | YAML-defined | Fixed | Fixed | Manual |
| **Three candle intervals** | 1s, 10s, 1m | Yes | Rarely | No |
| **Data retention control** | Configurable pruner | Broker-managed | No | No |

### Key Differentiators

1. **The only open-source simulated exchange with a real C++ LOB**: Competitor simulators compute fills programmatically. Synthetic-Bull actually maintains a live order book and matches orders.

2. **The only simulator with 9 simultaneous market microstructure models**: Most simulators use simple GBM. We layer GARCH volatility, HMM regime switching, Pareto order sizes, order-flow imbalance, dynamic spreads, and more.

3. **Built-in autonomous counterparties**: The market maker and alpha bot mean the exchange is live the moment it starts. No need to populate with test orders.

4. **Production parity**: The REST/WebSocket API, authentication model, order types, and settlement pipeline mirror what a real exchange provides, reducing the learning curve when transitioning to live trading.

---

## 15. Roadmap & Extensibility

### Adding New Instruments

1. Add entry to `shared/config/stocks.yaml` with symbol, name, initial price, drift, and volatility
2. Restart services — all components (market generator, candle service, bots) automatically discover new symbols

### Adding New Trading Strategies (Bots)

Follow the `alpha-bot` pattern:
1. Create `my-bot/app/main.py` with asyncio event loop
2. Authenticate against `POST /api/v1/auth/login`
3. Read market data from Redis (`price:*`, `candles:*:1m`)
4. Submit orders via `POST /api/v1/orders`
5. Add service to `docker-compose.yml`

### Potential Extensions

| Feature | Description |
|---------|-------------|
| **Margin Trading** | Add leverage and margin calls to position management |
| **Options Simulation** | Black-Scholes pricing for synthetic options contracts |
| **Multi-Leg Orders** | OCO (One-Cancels-Other), bracket orders |
| **Historical Replay** | Replay recorded market sessions for deterministic backtesting |
| **Risk Metrics** | Real-time VaR, Sharpe ratio, max drawdown per portfolio |
| **FIX Protocol** | Industry-standard FIX gateway for institutional-style connectivity |
| **Cross-Symbol Correlation** | Configurable correlation matrix between synthetic instruments |
| **Intraday Volume Profile** | U-shaped volume curves (high at open/close, low at midday) |
| **News Event Simulation** | Scheduled price shocks to simulate earnings, macro events |
| **Multi-User Leaderboard** | P&L rankings, strategy tournaments |

---

## Appendix: Glossary

| Term | Definition |
|------|-----------|
| **GBM** | Geometric Brownian Motion — the stochastic process governing price evolution |
| **LOB** | Limit Order Book — the data structure holding all resting limit orders |
| **GARCH** | Generalized AutoRegressive Conditional Heteroskedasticity — a model of time-varying volatility |
| **VWAC** | Volume-Weighted Average Cost — cost basis tracking method |
| **IOC** | Immediate-or-Cancel — order that fills what it can and discards the remainder |
| **GTC** | Good-Till-Cancelled — order that stays active until explicitly cancelled |
| **L2** | Level 2 market data — full bid/ask orderbook with depth |
| **OU** | Ornstein-Uhlenbeck process — mean-reverting stochastic process |
| **HMM** | Hidden Markov Model — probabilistic model of latent regime states |
| **OHLCV** | Open, High, Low, Close, Volume — standard candlestick data |
| **Spread** | Bid-ask spread — the difference between the best bid and best ask price |
| **Fill** | A trade execution that fully or partially satisfies an order |
| **Consumer Group** | Redis Streams mechanism for distributed, durable message consumption |
| **Fan-out** | Broadcasting a single message to multiple WebSocket subscribers |
| **Price-Time Priority** | Matching rule: best price first, FIFO within a price level |

---

*Synthetic-Bull — Trade without risk. Learn without limits.*
