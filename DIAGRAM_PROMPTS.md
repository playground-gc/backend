# Synthetic-Bull — Diagram Generation Prompts

This file contains detailed prompts for generating all architectural, flow, and conceptual diagrams for the Synthetic-Bull platform. Use these prompts with diagramming tools (Mermaid, Draw.io, Lucidchart, PlantUML, Excalidraw) or AI image generation services.

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Microservices Interaction Map](#2-microservices-interaction-map)
3. [Data Flow Pipeline — Trade Lifecycle](#3-data-flow-pipeline--trade-lifecycle)
4. [Order State Machine](#4-order-state-machine)
5. [GBM Price Simulation Pipeline](#5-gbm-price-simulation-pipeline)
6. [Matching Engine — LOB Mechanics](#6-matching-engine--lob-mechanics)
7. [Stop Order Lifecycle](#7-stop-order-lifecycle)
8. [Redis Message Bus Topology](#8-redis-message-bus-topology)
9. [Fill Processor — Settlement Flow](#9-fill-processor--settlement-flow)
10. [WebSocket Fan-out Architecture](#10-websocket-fan-out-architecture)
11. [PostgreSQL Entity Relationship Diagram](#11-postgresql-entity-relationship-diagram)
12. [OHLCV Candle Aggregation Logic](#12-ohlcv-candle-aggregation-logic)
13. [Market Maker Bot Strategy Diagram](#13-market-maker-bot-strategy-diagram)
14. [Alpha Bot SMA Crossover Strategy](#14-alpha-bot-sma-crossover-strategy)
15. [GBM Nine Microstructure Extensions Map](#15-gbm-nine-microstructure-extensions-map)
16. [Deployment & Docker Compose Topology](#16-deployment--docker-compose-topology)
17. [Authentication & JWT Flow](#17-authentication--jwt-flow)
18. [Portfolio P&L Calculation Flow](#18-portfolio-pl-calculation-flow)
19. [Regime Switching State Machine](#19-regime-switching-state-machine)
20. [End-to-End Buy Limit Order Sequence](#20-end-to-end-buy-limit-order-sequence)
21. [End-to-End Stop-Limit Order Sequence](#21-end-to-end-stop-limit-order-sequence)
22. [Technology Stack Layered Diagram](#22-technology-stack-layered-diagram)

---

## 1. System Architecture Overview

### Purpose
High-level bird's-eye view of all platform components, showing the C++ performance core, Python services layer, data layer, and external client interface.

### Mermaid Prompt
```
Create a Mermaid graph TD (top-down) diagram titled "Synthetic-Bull System Architecture".

Nodes:
- MG [Market Generator\nC++ GBM Engine\n100 ticks/sec/symbol]
- ME [Matching Engine\nC++ Limit Order Book\nPrice-Time Priority]
- TE [Trigger Engine\nC++ Stop Order Monitor\nDB-Persisted State]
- AG [API Gateway\nFastAPI REST\nPort 8000]
- FP [Fill Processor\nTrade Settlement\nRedis Stream Consumer]
- CS [Candle Service\nOHLCV Aggregator\nMultiple Intervals]
- WS [WebSocket Service\nReal-time Feed Bridge\nPort 8001]
- MM [Market Maker Bot\nSpread Quoting\n500ms Refresh]
- AB [Alpha Bot\nSMA Crossover\n1m Candles]
- PG [(PostgreSQL 16\nPersistent Storage)]
- RD[(Redis 7.2\nPub/Sub + Streams)]
- CL[External Clients\nFrontend / Algo Bots]

Connections:
MG --TCP:9000--> ME
ME --stream:trades--> RD
ME --pub/sub--> RD
ME --price hash--> RD
RD --stream:trades--> FP
RD --stream:trades--> CS
RD --pub/sub--> WS
RD --price updates--> TE
FP --writes--> PG
CS --writes--> PG
CS --pub/sub--> RD
AG --TCP:9000--> ME
AG --reads/writes--> PG
AG --reads/writes--> RD
AG --stop_orders:new--> RD
TE --reads--> PG
TE --TCP:9000--> ME
TE --stop_triggered--> RD
WS --websocket--> CL
MM --REST API--> AG
AB --REST API--> AG
CL --REST API--> AG

Group MG, ME, TE in a subgraph "C++ Performance Core" (blue background)
Group AG, FP, CS, WS, MM, AB in a subgraph "Python Services Layer" (green background)
Group PG, RD in a subgraph "Data Layer" (orange background)
```

### Draw.io / Lucidchart Description
```
Create a layered system architecture diagram with three horizontal swim lanes:

LAYER 1 — C++ Performance Core (top, blue):
  Left box: "Market Generator" with subtitle "GBM + 9 Microstructure Extensions / 100 Hz"
  Center box: "Matching Engine" with subtitle "Limit Order Book / Price-Time Priority / Lock-free"
  Right box: "Trigger Engine" with subtitle "Stop Order Monitor / DB-Persisted / OU-aware"
  Arrow from Market Generator to Matching Engine labeled "TCP :9000 / orderbook snapshots"

LAYER 2 — Python Services (middle, green):
  Left box: "API Gateway (FastAPI)" — Port 8000
  Center-left box: "Fill Processor" — Trade Settlement
  Center-right box: "Candle Service" — OHLCV
  Right box: "WebSocket Service" — Port 8001
  Below those: "Market Maker Bot" and "Alpha Bot" side by side

LAYER 3 — Data Layer (bottom, orange):
  Left cylinder: "PostgreSQL 16" — users, orders, trades, portfolios, candles, balance_history
  Right cylinder: "Redis 7.2" — pub/sub channels, streams, sorted sets, hashes

External (outside main box):
  Cloud shape: "External Clients" connecting to API Gateway (REST) and WebSocket Service (WS)

Arrows between layers showing key data flows with labels.
```

---

## 2. Microservices Interaction Map

### Purpose
Shows exactly which services communicate with which, what protocol they use, and what data is exchanged.

### Mermaid Prompt
```
Create a Mermaid graph LR (left-right) interaction map.

All 10 services as nodes with distinct colors:
- market-generator (orange)
- matching-engine (red)
- trigger-engine (purple)
- api-gateway (blue)
- fill-processor (teal)
- candle-service (green)
- websocket-service (cyan)
- market-maker-bot (yellow)
- alpha-bot (lime)
- postgres (grey, database shape)
- redis (grey, database shape)

Labeled directed arrows for every interaction:
market-generator -- "TCP JSON orderbooks" --> matching-engine
matching-engine -- "XADD stream:trades" --> redis
matching-engine -- "PUBLISH trades:{s}" --> redis
matching-engine -- "PUBLISH orderbook:{s}" --> redis
matching-engine -- "HSET price:{s}" --> redis
matching-engine -- "SET orderbook:snapshot:{s}" --> redis
api-gateway -- "TCP JSON orders" --> matching-engine
api-gateway -- "SELECT/INSERT/UPDATE" --> postgres
api-gateway -- "GET price/orderbook/candles" --> redis
api-gateway -- "PUBLISH stop_orders:new" --> redis
api-gateway -- "PUBLISH stop_orders:cancel" --> redis
fill-processor -- "XREADGROUP stream:trades" --> redis
fill-processor -- "INSERT trades / UPDATE orders / UPSERT portfolios" --> postgres
candle-service -- "XREADGROUP stream:trades" --> redis
candle-service -- "ZADD candles:{s}:{i}" --> redis
candle-service -- "UPSERT candles" --> postgres
candle-service -- "PUBLISH candles:{s}:{i}" --> redis
trigger-engine -- "SELECT pending stops" --> postgres
trigger-engine -- "SUBSCRIBE price:{s}" --> redis
trigger-engine -- "SUBSCRIBE stop_orders:*" --> redis
trigger-engine -- "TCP JSON order" --> matching-engine
trigger-engine -- "UPDATE status=triggered" --> postgres
trigger-engine -- "PUBLISH stop_triggered:{uid}" --> redis
websocket-service -- "SUBSCRIBE trades/orderbook/candles/market_data/stop_triggered" --> redis
market-maker-bot -- "GET price:{s}" --> redis
market-maker-bot -- "POST /orders" --> api-gateway
alpha-bot -- "ZRANGE candles:{s}:1m" --> redis
alpha-bot -- "POST /orders" --> api-gateway
```

---

## 3. Data Flow Pipeline — Trade Lifecycle

### Purpose
Shows the complete journey of a trade from price generation through settlement to the client's portfolio update.

### Mermaid Sequence Prompt
```
Create a Mermaid sequenceDiagram showing the complete trade lifecycle.

Participants (left to right):
MarketGen, MatchEngine, Redis, FillProc, CandleSvc, WSService, PostgreSQL, Client

Sequence:
MarketGen ->> MatchEngine: GBM orderbook snapshot (TCP)
Client ->> API_Gateway: POST /orders {limit buy 10 AAPL_S @ $180}
API_Gateway ->> PostgreSQL: INSERT orders (status=open)
API_Gateway ->> MatchEngine: TCP order message
API_Gateway -->> Client: {order_id, status: "submitted"}

Note over MatchEngine: Price-time priority matching\nbid price ≤ ask price → FILL

MatchEngine ->> Redis: XADD stream:trades (trade event)
MatchEngine ->> Redis: PUBLISH trades:AAPL_S
MatchEngine ->> Redis: HSET price:AAPL_S {price: 179.95}
MatchEngine ->> Redis: PUBLISH orderbook:AAPL_S

Redis ->> FillProc: XREADGROUP (consumer group)
FillProc ->> PostgreSQL: INSERT trades
FillProc ->> PostgreSQL: UPDATE orders (filled_qty, status=filled)
FillProc ->> PostgreSQL: UPSERT portfolios (VWAC cost basis)
FillProc ->> PostgreSQL: UPDATE users.balance (-$1799.50)
FillProc ->> PostgreSQL: INSERT balance_history

Redis ->> CandleSvc: XREADGROUP (consumer group)
CandleSvc ->> Redis: ZADD candles:AAPL_S:1m
CandleSvc ->> PostgreSQL: UPSERT candles
CandleSvc ->> Redis: PUBLISH candles:AAPL_S:1m

Redis ->> WSService: SUBSCRIBE trades:AAPL_S
Redis ->> WSService: SUBSCRIBE candles:AAPL_S:1m
WSService ->> Client: {event: "trade", price: 179.95, qty: 10}
WSService ->> Client: {event: "candle", close: 179.95, ...}

Client ->> API_Gateway: GET /api/v1/me
API_Gateway ->> PostgreSQL: SELECT portfolios + users
API_Gateway ->> Redis: GET price:AAPL_S
API_Gateway -->> Client: {portfolio, balance, unrealized_pnl}
```

---

## 4. Order State Machine

### Purpose
Visual representation of all order states and valid state transitions.

### Mermaid StateDiagram Prompt
```
Create a Mermaid stateDiagram-v2 for the Synthetic-Bull order state machine.

States:
[*] --> SUBMITTED : User POSTs order
SUBMITTED --> OPEN : Fill Processor confirms no fills yet
SUBMITTED --> PENDING_TRIGGER : Stop order stored in Trigger Engine

OPEN --> PARTIAL : First fill received (filled_qty < quantity)
OPEN --> FILLED : Fully matched in single fill
OPEN --> CANCELLED : User DELETE /orders/{id}
OPEN --> FAILED : Engine rejection

PARTIAL --> PARTIAL : Additional fill (still incomplete)
PARTIAL --> FILLED : Final fill completes quantity
PARTIAL --> CANCELLED : User cancels remainder

PENDING_TRIGGER --> TRIGGERED : Price crosses stop_price
PENDING_TRIGGER --> CANCELLED : User cancels before trigger
PENDING_TRIGGER --> [EXPIRED] : expires_at reached (30-day default)

TRIGGERED --> OPEN : Resulting limit/market order submitted to engine

FILLED --> [*] : Terminal state
CANCELLED --> [*] : Terminal state
FAILED --> [*] : Terminal state

Note on PENDING_TRIGGER: "Held by C++ Trigger Engine\nDB-persisted across restarts"
Note on TRIGGERED: "Trigger Engine submits new limit/market order\nNotifies user via WebSocket"
Note on PARTIAL: "Pruner never deletes\nnon-terminal state orders"
```

---

## 5. GBM Price Simulation Pipeline

### Purpose
Shows the mathematical pipeline inside the market generator — each transformation step from raw GBM to the final L2 orderbook.

### Flowchart Prompt
```
Create a detailed flowchart showing the per-tick price generation pipeline.

Title: "GBM Price Generation Pipeline (100 ticks/sec)"

Steps as process boxes:

[START: Every ~10ms per symbol]
    ↓
[1. GBM Core Step]
   Formula: S(t+Δt) = S(t) × exp[(μ - σ²/2)Δt + σ√Δt × Z]
   Z ~ N(0,1) via Mersenne Twister
    ↓
[2. F1: Regime Check]
   Diamond: Random(0,1) < 0.0002?
   YES → Switch regime (BULL/BEAR/NEUTRAL randomly)
   NO → Keep current regime
   → Update μ_regime, σ_regime
    ↓
[3. F2: GARCH Volatility Update]
   σ̂_t = (1-0.005)σ̂_{t-1} + 0.005 × |ln(S_t/S_{t-1})|
   σ_eff = 0.60 × σ_regime + 0.40 × σ̂_t
   Clamp σ_eff to [1%, 100%]
    ↓
[4. F6: Hidden OU Drift Update]
   θ_{t+1} = θ_t - 0.001×θ_t + (0.02/√N_tpy)×Z
   Clamp θ to [-0.30, +0.30]
   Add Δμ_hidden = θ_t / N_tpy to drift
    ↓
[5. F4: Order-Flow Imbalance]
   Read circular buffer (64 entries, 10-tick lag)
   imb_{t-10} = (V_bid - V_ask) / (V_bid + V_ask)
   Δμ_imb = 0.15 × σ_eff × imb_{t-10}
    ↓
[6. F3: Price Anchoring Correction]
   EMA_t = (1-0.0001)×EMA_{t-1} + 0.0001×S_t
   S ← S + 0.00002 × (P_anchor - S)
    ↓
[7. F7: Pareto Order Size Sampling]
   For each of 10 levels:
     Normal component: exp(-0.3k)(1 + 0.35Z)
     Pareto component: 1/U^(1/1.3), clipped [1,20]
     size_k = 0.45×Normal + 0.55×Pareto
    ↓
[8. F5: Regime Depth Bias]
   BULL: bid_sizes × 1.15, ask_sizes × 0.88
   BEAR: bid_sizes × 0.88, ask_sizes × 1.15
    ↓
[9. F8: Dynamic Spread Widening]
   f = 2e-6 × (1 + 0.5 × max(0, σ̂/σ_eff - 1))
   Cap f at 6e-6
   ask_k = mid × (1 + f×k), bid_k = mid × (1 - f×k)
    ↓
[10. F9: Volume OU Clustering]
    V_{t+1} = V_t - 0.005×(V_t - 1.0) + 0.01×Z
    Clamp V to [0.1, 3.0]
    size_k × = V_t
    ↓
[11. Construct L2 Orderbook]
    10 ask levels: {price: ask_k, size: size_k}
    10 bid levels: {price: bid_k, size: size_k}
    ↓
[12. Publish to Matching Engine]
    Send JSON via TCP:9000
    ↓
[END: Wait for next tick interval]
```

---

## 6. Matching Engine — LOB Mechanics

### Purpose
Illustrates the internal structure of the Limit Order Book and how an aggressive order matches against it.

### Visual Diagram Description
```
Create a diagram showing the Limit Order Book (LOB) matching mechanics.

Left side: BIDS (Buy orders, descending by price)
  ┌────────────────────────────────────────────┐
  │  BIDS (Price descending — best bid first)  │
  ├──────────┬─────────────────────────────────┤
  │ $180.00  │ [Order A: 50] → [Order B: 30]   │  ← Best Bid
  │ $179.95  │ [Order C: 100]                  │
  │ $179.90  │ [Order D: 200] → [Order E: 150] │
  │ $179.85  │ [Order F: 75]                   │
  └──────────┴─────────────────────────────────┘

Right side: ASKS (Sell orders, ascending by price)
  ┌────────────────────────────────────────────┐
  │  ASKS (Price ascending — best ask first)   │
  ├──────────┬─────────────────────────────────┤
  │ $180.05  │ [Order G: 50]                   │  ← Best Ask
  │ $180.10  │ [Order H: 120] → [Order I: 80]  │
  │ $180.15  │ [Order J: 200]                  │
  │ $180.20  │ [Order K: 300]                  │
  └──────────┴─────────────────────────────────┘

Center: MID PRICE = ($180.00 + $180.05) / 2 = $180.025
        SPREAD = $0.05 (2.78 bps)

Bottom: Incoming aggressive BUY market order for 60 shares
  Arrow pointing at ASKS side
  Matching sequence with highlight:
  Step 1: Match Order G (50 @ $180.05) — 50 shares filled
  Step 2: Match Order H (10 of 120 @ $180.10) — 10 shares filled
  Total: 60 shares filled, avg price = (50×180.05 + 10×180.10) / 60

Labels:
  - "Price-Time Priority: Best price first, FIFO within level"
  - "Lock-free queue (LFQueue) for concurrent order ingestion"
  - "Thread-pinned to CPU core for minimum latency"
  - Each order in queue shows (order_id, qty, timestamp)
```

---

## 7. Stop Order Lifecycle

### Purpose
Visualizes the complete stop order flow from submission through persistence, monitoring, trigger, and execution.

### Mermaid Sequence Prompt
```
Create a Mermaid sequenceDiagram for the stop order lifecycle.

Participants: Client, APIGateway, PostgreSQL, Redis, TriggerEngine, MatchEngine, WSService

Client ->> APIGateway: POST /orders\n{type: stop_limit, stop: 175, limit: 174.80, qty: 10, side: sell}

APIGateway ->> APIGateway: Validate: stop_price + limit_price required
APIGateway ->> PostgreSQL: INSERT orders\n(status=pending_trigger, expires_at=+30days)
APIGateway ->> Redis: PUBLISH stop_orders:new\n{order_id, symbol, side, stop_price, limit_price, qty}
APIGateway -->> Client: {status: "pending_trigger", expires_at: "2026-05-01"}

Redis ->> TriggerEngine: Message on stop_orders:new channel
TriggerEngine ->> TriggerEngine: Store in memory:\norders[order_id] = {stop_price: 175, ...}

loop Every price update
    MatchEngine ->> Redis: HSET price:AAPL_S {price: 177.50}
    Redis ->> TriggerEngine: price:AAPL_S → 177.50
    TriggerEngine ->> TriggerEngine: Check: 177.50 ≤ 175.00? NO → skip
end

MatchEngine ->> Redis: HSET price:AAPL_S {price: 175.00}
Redis ->> TriggerEngine: price:AAPL_S → 175.00
TriggerEngine ->> TriggerEngine: Check: 175.00 ≤ 175.00? YES → TRIGGER

TriggerEngine ->> PostgreSQL: UPDATE orders SET status=triggered
TriggerEngine ->> MatchEngine: TCP: {action: place, type: limit, side: sell, price: 174.80, qty: 10}
TriggerEngine ->> Redis: PUBLISH stop_triggered:{user_id}\n{order_id, triggered_at, stop_price}

Redis ->> WSService: Message on stop_triggered:{user_id}
WSService ->> Client: WebSocket: {type: stop_triggered, order_id, stop_price: 175}

Note over MatchEngine: Now matches the triggered limit order\nnormally via price-time priority
```

---

## 8. Redis Message Bus Topology

### Purpose
Shows all Redis data structures, who produces to each, and who consumes from each.

### Diagram Description
```
Create a hub-and-spoke diagram with Redis at the center.

Central node: "Redis 7.2" (large, prominent)

Surrounding nodes grouped by type:

PRODUCERS (left side, sending data TO Redis):
  - Matching Engine → [arrow to] stream:trades, trades:{symbol}, orderbook:{symbol}, price:{symbol}, orderbook:snapshot:{symbol}
  - Market Generator → market_data:{symbol}
  - Candle Service → candles:{symbol}:{interval} [pub/sub], candles:{symbol}:{interval} [sorted set]
  - API Gateway → stop_orders:new, stop_orders:cancel
  - Trigger Engine → stop_triggered:{user_id}

CONSUMERS (right side, reading FROM Redis):
  - Fill Processor ← [arrow from] stream:trades [XREADGROUP consumer group]
  - Candle Service ← stream:trades [XREADGROUP consumer group]
  - WebSocket Service ← trades:{s}, orderbook:{s}, candles:{s}:{i}, market_data:{s}, stop_triggered:{uid}
  - Trigger Engine ← price:{symbol}, stop_orders:new, stop_orders:cancel
  - API Gateway ← price:{symbol}, orderbook:snapshot:{symbol}, candles:{s}:{i}
  - Market Maker Bot ← price:{symbol}
  - Alpha Bot ← candles:{symbol}:1m

Inside Redis central node, show data structure types with icons:
  📦 Streams: stream:trades (durable, consumer groups)
  📢 Pub/Sub: trades:*, orderbook:*, candles:*, market_data:*, stop_triggered:*, stop_orders:*
  🗄️ Hashes: price:{symbol}
  📊 Sorted Sets: candles:{symbol}:{interval}
  📝 Strings: orderbook:snapshot:{symbol} (5s TTL)

Color code by data structure type.
```

---

## 9. Fill Processor — Settlement Flow

### Purpose
Details the two-phase commit settlement logic inside the fill processor.

### Flowchart Prompt
```
Create a detailed flowchart titled "Fill Processor — Two-Phase Trade Settlement"

START: New message in stream:trades (Redis XREADGROUP)

[Read trade event]
  trade_id, symbol, price, quantity, buy_order_id, sell_order_id, buyer_id, seller_id

Diamond: Is trade_id already in trades table?
  YES (duplicate) → XACK (acknowledge) → END (idempotent skip)
  NO → Continue

═══════════════════════════════════
PHASE 1: CRITICAL PATH (BEGIN TRANSACTION)
═══════════════════════════════════

[INSERT INTO trades]
  ON CONFLICT DO NOTHING (idempotent)

[UPDATE buy order]
  SET filled_qty = filled_qty + quantity
  Diamond: filled_qty = total quantity?
    YES → SET status = 'filled'
    NO  → SET status = 'partial'

[UPDATE sell order]
  SET filled_qty = filled_qty + quantity
  Diamond: filled_qty = total quantity?
    YES → SET status = 'filled'
    NO  → SET status = 'partial'

[COMMIT TRANSACTION]

Diamond: Transaction succeeded?
  NO → Log error, XACK anyway (prevent reprocessing loop) → END
  YES → Continue to Phase 2

═══════════════════════════════════
PHASE 2: BEST-EFFORT PORTFOLIO (Independent transactions)
═══════════════════════════════════

BUYER SETTLEMENT:
[UPSERT portfolios for buyer]
  new_avg_cost = (old_avg_cost × old_qty + price × qty) / (old_qty + qty)
  quantity += trade_qty
[UPDATE users SET balance = balance - (price × qty) WHERE id = buyer_id]
[INSERT balance_history]
  delta = -(price × qty), balance = new_balance, reason = 'trade_buy'

SELLER SETTLEMENT:
[UPDATE portfolios for seller]
  quantity -= trade_qty
[UPDATE users SET balance = balance + (price × qty) WHERE id = seller_id]
[INSERT balance_history]
  delta = +(price × qty), balance = new_balance, reason = 'trade_sell'

Diamond: Phase 2 error?
  YES → Log error (Phase 1 NOT rolled back — trade record preserved)
  NO → Continue

[XACK message in stream:trades]
END

Notes:
  "Phase 1 failures abort entire transaction"
  "Phase 2 failures are logged but do NOT affect Phase 1 — trade records are always preserved"
  "ON CONFLICT DO NOTHING ensures idempotency across consumer restarts"
```

---

## 10. WebSocket Fan-out Architecture

### Purpose
Shows how a single trade event travels from the matching engine through Redis to potentially thousands of WebSocket clients.

### Diagram Description
```
Create a fan-out architecture diagram titled "WebSocket Real-time Distribution"

Left side (producers):
  Box: "Matching Engine (C++)"
    → Arrow labeled "PUBLISH trades:AAPL_S" → Redis Pub/Sub node

  Box: "Candle Service (Python)"
    → Arrow labeled "PUBLISH candles:AAPL_S:1m" → Redis Pub/Sub node

  Box: "Trigger Engine (C++)"
    → Arrow labeled "PUBLISH stop_triggered:{user_id}" → Redis Pub/Sub node

  Box: "Market Generator (C++)"
    → Arrow labeled "PUBLISH market_data:AAPL_S (100Hz)" → Redis Pub/Sub node

Center: Redis Pub/Sub (cylindrical database icon)

Center-right: "WebSocket Service (Python)"
  Subscription Manager:
    - Symbol subscriptions: {AAPL_S: [conn1, conn2, conn3, ...]}
    - User subscriptions: {user_123: [conn4]}
    - Raw feed subscriptions: {AAPL_S: [conn5, conn6]}

  Three listener threads/tasks:
    ① Market data listener (trades, orderbook, candles)
    ② Stop order listener (stop_triggered:*)
    ③ Raw L2 listener (market_data:*, 100Hz)

Right side (consumers / WebSocket clients):
  Endpoint 1: /ws/AAPL_S
    → Multiple client connections (trading UI, algo bots)
    → Receives: trade events, orderbook updates, candle closes
    → Can filter by subscription type

  Endpoint 2: /ws/orders/{user_id}
    → Single user connection
    → Receives: stop trigger notifications only

  Endpoint 3: /ws/market/AAPL_S
    → Algo trading client
    → Receives: raw L2 orderbook @ 100Hz

Annotations:
  "Keepalive: server sends {type: ping} every 30 seconds"
  "Fan-out: 1 Redis message → N WebSocket client deliveries"
  "Pub/sub is ephemeral: messages lost if no subscriber is connected"
```

---

## 11. PostgreSQL Entity Relationship Diagram

### Purpose
Complete ERD showing all tables, columns, data types, primary keys, foreign keys, and relationships.

### ERD Description
```
Create a complete Entity Relationship Diagram (Crow's Foot notation) for Synthetic-Bull.

ENTITIES:

users
  PK: id UUID
  username VARCHAR(50) UNIQUE NOT NULL
  email VARCHAR(100) UNIQUE NOT NULL
  password_hash VARCHAR(255) NOT NULL  [bcrypt]
  balance DECIMAL(18,2) DEFAULT 100000.00
  created_at TIMESTAMPTZ

orders
  PK: id UUID
  FK: user_id → users.id
  symbol VARCHAR(20) NOT NULL
  order_type VARCHAR(15) [limit|market|stop_limit|stop_market]
  side VARCHAR(4) [buy|sell]
  price DECIMAL(18,6) [NULL for market orders]
  stop_price DECIMAL(18,6) [stop orders only]
  limit_price DECIMAL(18,6) [stop_limit only]
  quantity DECIMAL(18,6) NOT NULL
  filled_qty DECIMAL(18,6) DEFAULT 0
  status VARCHAR(20) [open|partial|filled|cancelled|failed|pending_trigger|triggered]
  expires_at TIMESTAMPTZ [NULL=GTC; stop=30 days]
  created_at TIMESTAMPTZ
  updated_at TIMESTAMPTZ

trades
  PK: id UUID
  FK: buy_order_id → orders.id
  FK: sell_order_id → orders.id
  FK: buyer_id → users.id
  FK: seller_id → users.id
  symbol VARCHAR(20)
  price DECIMAL(18,6)
  quantity DECIMAL(18,6)
  timestamp TIMESTAMPTZ

portfolios
  PK: id UUID
  FK: user_id → users.id
  symbol VARCHAR(20)
  quantity DECIMAL(18,6)
  avg_cost DECIMAL(18,6)  [VWAC]
  UNIQUE(user_id, symbol)

candles
  PK: (symbol, interval, timestamp) composite
  symbol VARCHAR(20)
  interval VARCHAR(5) [1s|10s|1m]
  open DECIMAL(18,6)
  high DECIMAL(18,6)
  low DECIMAL(18,6)
  close DECIMAL(18,6)
  volume DECIMAL(18,6)
  timestamp TIMESTAMPTZ

balance_history
  PK: id UUID
  FK: user_id → users.id
  FK: trade_id (soft reference to trades.id)
  delta DECIMAL(18,2)  [signed: negative=debit, positive=credit]
  balance DECIMAL(18,2)  [running balance AFTER this event]
  reason VARCHAR(20) [trade_buy|trade_sell]
  symbol VARCHAR(20)
  quantity DECIMAL(18,6)
  price DECIMAL(18,6)
  created_at TIMESTAMPTZ

RELATIONSHIPS:
  users (1) ──< (many) orders
  users (1) ──< (many) trades [as buyer]
  users (1) ──< (many) trades [as seller]
  users (1) ──< (many) portfolios
  users (1) ──< (many) balance_history
  orders (1) ──< (many) trades [as buy_order]
  orders (1) ──< (many) trades [as sell_order]
```

---

## 12. OHLCV Candle Aggregation Logic

### Purpose
Shows how the candle service processes a stream of trades into bucketed OHLCV candlesticks across three intervals.

### Diagram Description
```
Create a timeline-style diagram titled "OHLCV Candle Aggregation — Three Intervals"

Top timeline: Trades arriving on stream:trades
  Mark trade events with price and quantity at specific timestamps:
  T=0.0s: trade $180.10, qty=5
  T=0.3s: trade $180.15, qty=10
  T=0.7s: trade $179.95, qty=3
  T=1.1s: trade $180.05, qty=7
  T=1.4s: trade $180.20, qty=2
  ... continuing

Three parallel rows below showing bucket accumulation:

Row 1: 1-second candles (1,000ms buckets)
  Bucket 0–1s:
    O=$180.10 (first trade)
    H=$180.15 (max in bucket)
    L=$179.95 (min in bucket)
    C=$179.95 (last trade before bucket closes)
    V=18 (sum of quantities)
  [CLOSE EVENT → publish to Redis sorted set + PostgreSQL + pub/sub]
  Bucket 1–2s: starts with T=1.1s trade

Row 2: 10-second candles (10,000ms buckets)
  Larger bucket spanning multiple 1s candles
  Accumulates all trades in 10s window

Row 3: 1-minute candles (60,000ms buckets)
  Largest bucket, used by Alpha Bot for SMA calculation

For each bucket, show:
  - OPEN annotation pointing to first trade
  - HIGH annotation pointing to peak price
  - LOW annotation pointing to lowest price
  - CLOSE annotation pointing to last trade
  - VOLUME = sum of all trade quantities

Closing logic box:
  "When a new trade falls in a DIFFERENT bucket:"
  "1. CLOSE previous bucket → Redis ZADD (score=bucket_start)"
  "2. PostgreSQL UPSERT (GREATEST for high, LEAST for low)"
  "3. PUBLISH candle close event → WebSocket Service"
  "4. OPEN new bucket with current trade"

Storage annotations:
  "Redis: Newest 1,000 candles per (symbol, interval)"
  "PostgreSQL: Newest 5,000 candles per (symbol, interval)"
```

---

## 13. Market Maker Bot Strategy Diagram

### Purpose
Illustrates the market maker's spread quoting algorithm and its effect on the order book.

### Diagram Description
```
Create a diagram titled "Market Maker Bot — Symmetric Spread Quoting"

Left panel: Algorithm flowchart
  [START: Every 500ms per symbol]
  ↓
  [Read mid-price from Redis: GET price:AAPL_S → $180.00]
  ↓
  [Cancel all existing MM orders for symbol]
  ↓
  [Calculate bid_price = $180.00 × (1 - 0.0005) = $179.91]
  [Calculate ask_price = $180.00 × (1 + 0.0005) = $180.09]
  ↓
  [POST limit buy: qty=10 @ $179.91]
  [POST limit sell: qty=10 @ $180.09]
  ↓
  [Wait 500ms]
  ↓ (loop back)

Right panel: Order book visualization
  Shows the resulting order book with MM quotes highlighted in orange:

  ASKS:
  $180.20  [Other user: 5]
  $180.15  [Other user: 20]
  $180.09  [MARKET MAKER: 10]  ← MM quote (best ask)
  ─────────────────────────────
  SPREAD: $0.18 (0.10%)
  MID: $180.00
  ─────────────────────────────
  $179.91  [MARKET MAKER: 10]  ← MM quote (best bid)
  $179.85  [Other user: 15]
  $179.80  [Other user: 30]

  BIDS:

Bottom: Economic explanation
  "Market Maker earns the spread on round-trip trades"
  "Provides liquidity so user market orders always have a counterparty"
  "Quotes all 5 symbols simultaneously (asyncio parallel tasks)"

  P&L example box:
  "If user sells 10 @ $179.91 and another buys 10 @ $180.09:"
  "MM profit = ($180.09 - $179.91) × 10 = $1.80 per round-trip"
  "Risk: Inventory accumulation if market moves directionally"
```

---

## 14. Alpha Bot SMA Crossover Strategy

### Purpose
Visualizes the SMA crossover signal generation and trade execution logic.

### Diagram Description
```
Create a dual-panel diagram titled "Alpha Bot — SMA(10)/SMA(50) Crossover Strategy"

Panel 1: Price chart with SMA overlays
  X-axis: Time (minutes)
  Y-axis: Price ($)

  Show:
  - Candlestick chart (1-minute OHLCV bars) for ~60 minutes
  - Blue line: SMA(10) — faster, more responsive
  - Orange line: SMA(50) — slower, trend-following

  Annotate key events:
  ① [Golden Cross] SMA(10) crosses ABOVE SMA(50)
    → Arrow down labeled "BULL signal → BUY 5 AAPL_S (market order)"
    → Green buy marker on chart

  ② [Death Cross] SMA(10) crosses BELOW SMA(50)
    → Arrow down labeled "BEAR signal → SELL 5 AAPL_S (market order)"
    → Red sell marker on chart

  Add "30-second cooldown zone" shading after each trade

Panel 2: Decision logic flowchart
  [Every 10 seconds]
  ↓
  [Fetch last 50 1m candles from Redis: ZRANGE candles:AAPL_S:1m -50 -1]
  ↓
  [Extract close prices: [c1, c2, ..., c50]]
  ↓
  [fast_sma = mean(closes[-10:])  # Last 10 closes]
  [slow_sma = mean(closes[-50:])  # All 50 closes]
  ↓
  Diamond: fast_sma > slow_sma?
    YES → signal = BULL
    NO  → signal = BEAR
  ↓
  Diamond: Signal changed from last tick?
    NO → Wait for next tick
    YES → Continue
  ↓
  Diamond: now - last_order_time >= 30 seconds?
    NO → Rate limited, skip
    YES → Continue
  ↓
  [side = 'buy' if BULL, 'sell' if BEAR]
  [POST /orders: {type: market, side, qty: 5}]
  [Update last_order_time]
```

---

## 15. GBM Nine Microstructure Extensions Map

### Purpose
Overview diagram showing all 9 extensions, their inputs, outputs, and how they interact.

### Diagram Description
```
Create a "spider web" or "mind map" style diagram titled "GBM Nine Microstructure Extensions"

Central node: "GBM Core\nS(t+Δt) = S(t)·exp[(μ-σ²/2)Δt + σ√Δt·Z]"

Nine satellite nodes arranged in a circle, each with:
  Label: F1 through F9 + name
  Brief description of mechanism
  Arrow showing: INPUT ──> [Extension] ──> OUTPUT (what it affects)

F1 — Regime Switching (HMM)
  Input: Random uniform draw every tick
  Output: Updates μ_regime, σ_regime
  Effect: Transitions between BULL/BEAR/NEUTRAL states

F2 — GARCH Volatility Clustering
  Input: Realized log-returns (EMA α=0.005)
  Output: σ_eff = blend of σ_regime and σ̂_realized (w=0.40)
  Effect: Periods of high vol follow high vol

F3 — Price Anchoring
  Input: Price EMA (α=0.0001), 36k-tick anchor reset
  Output: Weak pull κ=0.00002 toward anchor
  Effect: Prevents indefinite drift, soft mean reversion

F4 — Order-Flow Imbalance
  Input: Bid/ask volume ratio, 10-tick delayed circular buffer
  Output: Δμ_imb = 0.15 × σ_eff × imbalance
  Effect: Lagged price impact of order flow

F5 — Asymmetric Book Depth
  Input: Current regime (BULL/BEAR/NEUTRAL)
  Output: Bid/ask depth multipliers (1.15/0.88 or 0.88/1.15)
  Effect: Regime-consistent order book shape

F6 — Hidden OU Drift
  Input: Ornstein-Uhlenbeck process (κ=0.001, ν=0.02)
  Output: Δμ_hidden = θ_t / N_tpy
  Effect: Slow-moving latent drift (mimics institutional flow)

F7 — Pareto Order Sizes
  Input: Pareto distribution α=1.3, Normal blend β=0.55
  Output: Heavy-tailed order sizes per LOB level
  Effect: Large orders appear with realistic frequency

F8 — Dynamic Spread Widening
  Input: Ratio σ̂_realized / σ_eff
  Output: f = 2e-6 × (1 + 0.5 × excess_vol), capped at 6e-6
  Effect: Spreads widen during volatile periods

F9 — Volume Clustering (OU)
  Input: Ornstein-Uhlenbeck (κ=0.005, V̄=1.0)
  Output: Volume multiplier V_t ∈ [0.1, 3.0]
  Effect: Quiet and active trading periods cluster

Connecting lines between extensions that interact:
  F1 ↔ F2 (regime affects vol clustering base)
  F1 ↔ F5 (regime drives depth biases)
  F2 ↔ F8 (realized vol drives spread widening)
  F6 → GBM Core (adds hidden drift component)
  F4 → GBM Core (adds imbalance drift component)
```

---

## 16. Deployment & Docker Compose Topology

### Purpose
Shows the Docker Compose service graph with startup dependencies, exposed ports, and network topology.

### Diagram Description
```
Create a Docker Compose deployment topology diagram.

Title: "Synthetic-Bull Docker Compose — 10 Services"

Network: "synthbull_default" (Docker bridge network, shown as outer container)

Infrastructure Services (bottom layer, grey):
  ┌──────────────┐    ┌──────────────┐
  │  postgres    │    │    redis     │
  │  Port 5432   │    │  Port 6379   │
  │ PostgreSQL 16│    │  Redis 7.2   │
  └──────────────┘    └──────────────┘

C++ Core Services (second layer, blue):
  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
  │ matching-engine  │  │ market-generator │  │  trigger-engine  │
  │  :9000 (internal)│  │  (no ext. port)  │  │  (no ext. port)  │
  │  depends: pg,red │  │  depends: ME,red │  │  depends: ME,pg, │
  │                  │  │                  │  │  red             │
  └──────────────────┘  └──────────────────┘  └──────────────────┘

Python Services (third layer, green):
  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
  │   api-gateway    │  │  candle-service  │  │ websocket-service│
  │ ★ Port 8000 ★    │  │  (no ext. port)  │  │ ★ Port 8001 ★    │
  │  depends: ME,pg, │  │  depends: red,pg │  │  depends: red    │
  │  red             │  │                  │  │                  │
  └──────────────────┘  └──────────────────┘  └──────────────────┘

Bot Services (top layer, yellow):
  ┌──────────────────┐  ┌──────────────────┐
  │ market-maker-bot │  │    alpha-bot     │
  │  (no ext. port)  │  │  (no ext. port)  │
  │  depends: AG,red │  │  depends: AG,red │
  └──────────────────┘  └──────────────────┘

External Access (outside the network box):
  Internet/Host
  ├── :8000 → api-gateway (REST API + Swagger UI)
  └── :8001 → websocket-service (WebSocket feeds)

Startup order arrows (dependency chain):
  postgres & redis → matching-engine → market-generator
                  ↗
  postgres & redis → trigger-engine
  matching-engine + postgres + redis → api-gateway
  redis + postgres → candle-service
  redis → websocket-service
  api-gateway + redis → market-maker-bot & alpha-bot
```

---

## 17. Authentication & JWT Flow

### Purpose
Shows the complete authentication flow from registration through token issuance and subsequent API usage.

### Mermaid Sequence Prompt
```
Create a Mermaid sequenceDiagram for authentication flow.

Participants: Client, APIGateway, PostgreSQL, JWTLib, BCrypt

== REGISTRATION ==

Client ->> APIGateway: POST /api/v1/auth/register\n{username, email, password}
APIGateway ->> APIGateway: Validate: username 3-50 chars,\nemail format, password ≥6 chars
APIGateway ->> PostgreSQL: SELECT id FROM users WHERE username=$1 OR email=$2
PostgreSQL -->> APIGateway: No rows (username/email available)
APIGateway ->> BCrypt: hash(password, rounds=12)
BCrypt -->> APIGateway: password_hash
APIGateway ->> PostgreSQL: INSERT INTO users\n(id=UUID4, username, email, password_hash, balance=100000)
PostgreSQL -->> APIGateway: user_id
APIGateway ->> JWTLib: create_token({sub: user_id, username, exp: now+24h})
JWTLib -->> APIGateway: JWT token (HS256)
APIGateway -->> Client: 201 {access_token, token_type, user_id, username}

== SUBSEQUENT API CALLS ==

Client ->> APIGateway: GET /api/v1/me\nAuthorization: Bearer <token>
APIGateway ->> JWTLib: verify_token(token, secret)
JWTLib -->> APIGateway: {sub: user_id, username, exp}
APIGateway ->> APIGateway: Check exp > now (not expired)
APIGateway ->> PostgreSQL: SELECT * FROM users WHERE id=user_id
PostgreSQL -->> APIGateway: User record
APIGateway -->> Client: 200 Account snapshot

== TOKEN EXPIRY ==

Client ->> APIGateway: GET /api/v1/me\nAuthorization: Bearer <expired_token>
APIGateway ->> JWTLib: verify_token(expired_token)
JWTLib -->> APIGateway: ExpiredSignatureError
APIGateway -->> Client: 401 Unauthorized "Token expired"
Note over Client: User must login again to get new token
```

---

## 18. Portfolio P&L Calculation Flow

### Purpose
Shows exactly how portfolio P&L is computed at query time, including VWAC and real-time price injection.

### Flowchart Description
```
Create a flowchart titled "Portfolio Snapshot & P&L Calculation"

Triggered by: GET /api/v1/me

[Load user record from PostgreSQL]
  cash_balance, username, email, created_at

[Load portfolio positions from PostgreSQL]
  SELECT symbol, quantity, avg_cost FROM portfolios WHERE user_id = $1

[Load current prices from Redis]
  For each symbol in portfolio:
    current_price = HGET price:{symbol} price

[For EACH position, compute:]

  market_value = current_price × quantity

  cost_basis = avg_cost × quantity

  unrealized_pnl = market_value - cost_basis
               = (current_price - avg_cost) × quantity

  pnl_pct = (unrealized_pnl / cost_basis) × 100

  Example:
    symbol: AAPL_S
    quantity: 10
    avg_cost: $179.95     [from VWAC at buy time]
    current_price: $182.50  [from Redis live price]
    market_value: $1,825.00
    cost_basis: $1,799.50
    unrealized_pnl: +$25.50
    pnl_pct: +1.42%

[Aggregate totals:]
  total_portfolio_value = Σ(market_value_i) for all positions
  total_unrealized_pnl  = Σ(unrealized_pnl_i)
  total_account_value   = cash_balance + total_portfolio_value

[Build and return response:]
  {
    cash_balance,
    portfolio: [PortfolioItem × N],
    total_portfolio_value,
    total_unrealized_pnl,
    total_account_value
  }

VWAC update box (separate, for reference):
  [On each trade fill by Fill Processor:]
  new_avg_cost = (old_avg_cost × old_qty + trade_price × trade_qty) /
                 (old_qty + trade_qty)

  Example progression:
    Trade 1: 10 shares @ $180.00 → avg=$180.00
    Trade 2: +5 shares @ $182.00 → avg=$180.67
    Trade 3: +5 shares @ $178.00 → avg=$180.00
```

---

## 19. Regime Switching State Machine

### Purpose
Detailed view of the Hidden Markov Model regime switching used in the market generator.

### Mermaid StateDiagram Prompt
```
Create a Mermaid stateDiagram-v2 for market regime switching.

States:

BULL : BULL Regime\nμ=+10% annual\nσ=22% annual\nBid depth bias ×1.15
NEUTRAL : NEUTRAL Regime\nμ=+0.1% annual\nσ=15% annual\nSymmetric depth
BEAR : BEAR Regime\nμ=-10% annual\nσ=25% annual\nAsk depth bias ×1.15

[*] --> NEUTRAL : Simulation starts in NEUTRAL

BULL --> BULL : p=0.9998 (stay)
BULL --> BEAR : p≈0.0001 (switch)
BULL --> NEUTRAL : p≈0.0001 (switch)

NEUTRAL --> NEUTRAL : p=0.9998 (stay)
NEUTRAL --> BULL : p≈0.0001 (switch)
NEUTRAL --> BEAR : p≈0.0001 (switch)

BEAR --> BEAR : p=0.9998 (stay)
BEAR --> BULL : p≈0.0001 (switch)
BEAR --> NEUTRAL : p≈0.0001 (switch)

note right of BULL
  Golden Cross tendency
  SMA(10) > SMA(50)
  Market maker more aggressive bids
  Volume: normal
end note

note right of BEAR
  Death Cross tendency
  SMA(10) < SMA(50)
  Market maker more aggressive asks
  Higher volatility (+3%)
end note

note right of NEUTRAL
  Default state
  Lowest volatility
  Symmetric order book
  Slight positive drift
end note

Legend:
  "Switch probability per tick: p=0.0002"
  "At 100 tps: expected duration per regime ≈ 50 seconds"
  "Transition is uniform — equal probability to each other regime"
```

---

## 20. End-to-End Buy Limit Order Sequence

### Purpose
Complete millisecond-by-millisecond trace of a buy limit order from submission to portfolio update.

### Mermaid Sequence Prompt
```
Create a detailed Mermaid sequenceDiagram for a buy limit order.

Participants: Client, APIGateway, PostgreSQL_AG, MatchEngine, Redis, FillProcessor, PostgreSQL_FP, CandleService, WSService

autonumber

Client ->> APIGateway: POST /api/v1/orders\n{"symbol":"AAPL_S","type":"limit","side":"buy","price":180.00,"qty":10}
APIGateway ->> APIGateway: Validate JWT token → user_id extracted
APIGateway ->> APIGateway: Validate: type=limit requires price field ✓\nquantity > 0 ✓, symbol in stocks.yaml ✓
APIGateway ->> PostgreSQL_AG: INSERT INTO orders\n(id=uuid1, user_id, symbol, type=limit, side=buy,\nprice=180.00, qty=10, status=open)
PostgreSQL_AG -->> APIGateway: OK (order persisted)
APIGateway ->> MatchEngine: TCP send:\n{"action":"place","order_id":"uuid1","user_id":"u1",\n"symbol":"AAPL_S","type":"limit","side":"buy",\n"price":180.00,"quantity":10}
APIGateway -->> Client: HTTP 200\n{"order_id":"uuid1","status":"submitted","price":180.00}

Note over MatchEngine: LOB Check: Best ask = $179.95\n$179.95 ≤ $180.00 (limit) → FILL!

MatchEngine ->> MatchEngine: Match 10 units @ $179.95\nCreate trade: id=t1, price=179.95, qty=10
MatchEngine ->> Redis: XADD stream:trades * {trade_id:t1, symbol:AAPL_S,\nprice:179.95, qty:10, buy_order_id:uuid1,\nsell_order_id:uuid2, buyer_id:u1, seller_id:bot1}
MatchEngine ->> Redis: PUBLISH trades:AAPL_S {same trade data}
MatchEngine ->> Redis: HSET price:AAPL_S price 179.95 volume 10 ts 1711987200000
MatchEngine ->> Redis: PUBLISH orderbook:AAPL_S {updated orderbook snapshot}

Redis ->> FillProcessor: XREADGROUP (consumer group pull)
FillProcessor ->> PostgreSQL_FP: BEGIN TRANSACTION
FillProcessor ->> PostgreSQL_FP: INSERT INTO trades VALUES (t1,...) ON CONFLICT DO NOTHING
FillProcessor ->> PostgreSQL_FP: UPDATE orders SET filled_qty=10, status=filled WHERE id=uuid1
FillProcessor ->> PostgreSQL_FP: UPDATE orders SET filled_qty=10, status=filled WHERE id=uuid2
FillProcessor ->> PostgreSQL_FP: COMMIT

FillProcessor ->> PostgreSQL_FP: UPSERT portfolios (buyer): qty+=10, avg_cost=179.95
FillProcessor ->> PostgreSQL_FP: UPDATE users SET balance=balance-1799.50 WHERE id=u1
FillProcessor ->> PostgreSQL_FP: INSERT balance_history (delta=-1799.50, reason=trade_buy)
FillProcessor ->> PostgreSQL_FP: UPDATE portfolios (seller): qty-=10
FillProcessor ->> PostgreSQL_FP: UPDATE users SET balance=balance+1799.50 WHERE id=bot1
FillProcessor ->> PostgreSQL_FP: INSERT balance_history (delta=+1799.50, reason=trade_sell)
FillProcessor ->> Redis: XACK stream:trades fill-processor-group t1

Redis ->> CandleService: XREADGROUP (consumer group pull)
CandleService ->> CandleService: bucket_1m = floor(ts/60000)*60000\nUpdate 1m candle: H=max, L=min, C=179.95, V+=10
CandleService ->> Redis: ZADD candles:AAPL_S:1m score=bucket {open,high,low,close,vol}
CandleService ->> PostgreSQL_FP: UPSERT candles (GREATEST high, LEAST low, +=volume)

Redis ->> WSService: Message on trades:AAPL_S channel
WSService ->> Client: WebSocket message:\n{"event":"trade","symbol":"AAPL_S","price":179.95,"qty":10}

Client ->> APIGateway: GET /api/v1/me
APIGateway ->> PostgreSQL_AG: SELECT portfolios + users WHERE user_id=u1
APIGateway ->> Redis: HGET price:AAPL_S price → 179.95
APIGateway -->> Client: {cash_balance:98200.50, portfolio:[{symbol:AAPL_S,qty:10,avg_cost:179.95,\ncurrent_price:179.95, unrealized_pnl:0}], total_account_value:100000.00}
```

---

## 21. End-to-End Stop-Limit Order Sequence

### Purpose
Full sequence trace of a stop-limit order from submission through price monitoring to trigger and execution.

### Mermaid Sequence Prompt
```
Create a Mermaid sequenceDiagram for stop-limit order lifecycle.

Participants: Client, APIGateway, PostgreSQL, Redis, TriggerEngine, MatchEngine, WSService, FillProcessor

autonumber

== ORDER SUBMISSION ==

Client ->> APIGateway: POST /api/v1/orders\n{"type":"stop_limit","side":"sell","symbol":"AAPL_S",\n"stop_price":175.00,"limit_price":174.80,"qty":10}
APIGateway ->> APIGateway: Validate: stop_limit requires\nstop_price AND limit_price ✓
APIGateway ->> PostgreSQL: INSERT INTO orders\n(id=stop1, status=pending_trigger,\nstop_price=175, limit_price=174.80,\nexpires_at=now+30days)
APIGateway ->> Redis: PUBLISH stop_orders:new\n{"order_id":"stop1","symbol":"AAPL_S",\n"side":"sell","stop_price":175,"limit_price":174.80,"qty":10}
APIGateway -->> Client: HTTP 200\n{"order_id":"stop1","status":"pending_trigger",\n"expires_at":"2026-05-01T00:00:00Z"}

== TRIGGER ENGINE PICKUP ==

Redis ->> TriggerEngine: Message: stop_orders:new channel
TriggerEngine ->> TriggerEngine: Store in memory:\norders["stop1"] = {symbol:AAPL_S, side:sell,\nstop:175.00, limit:174.80, qty:10}

== PRICE MONITORING ==

loop Price updates every ~10ms
    MatchEngine ->> Redis: HSET price:AAPL_S price 177.50
    Redis ->> TriggerEngine: price update: AAPL_S → 177.50
    TriggerEngine ->> TriggerEngine: Check SELL: 177.50 ≤ 175.00? NO → skip
end

MatchEngine ->> Redis: HSET price:AAPL_S price 175.00
Redis ->> TriggerEngine: price update: AAPL_S → 175.00
TriggerEngine ->> TriggerEngine: Check SELL: 175.00 ≤ 175.00? YES → TRIGGER!

== TRIGGER EXECUTION ==

TriggerEngine ->> PostgreSQL: UPDATE orders SET status=triggered\nWHERE id=stop1
TriggerEngine ->> MatchEngine: TCP: {"action":"place","symbol":"AAPL_S",\n"type":"limit","side":"sell",\n"price":174.80,"qty":10}
TriggerEngine ->> Redis: PUBLISH stop_triggered:{user_id}\n{"type":"stop_triggered","order_id":"stop1",\n"stop_price":175.00,"triggered_at":1711987200000}

Redis ->> WSService: Message: stop_triggered:{user_id}
WSService ->> Client: WebSocket:\n{"type":"stop_triggered","order_id":"stop1",\n"symbol":"AAPL_S","stop_price":175}

== FILL PROCESSING (same as limit order) ==

MatchEngine ->> Redis: XADD stream:trades (new trade from triggered limit)
Redis ->> FillProcessor: Consume trade
FillProcessor ->> PostgreSQL: INSERT trades + UPDATE orders + UPDATE portfolios + UPDATE balance
```

---

## 22. Technology Stack Layered Diagram

### Purpose
Visual representation of all technologies organized by layer and function.

### Diagram Description
```
Create a layered technology stack diagram titled "Synthetic-Bull Technology Stack"

Layer 1 — Client Interface (top, white/grey):
  REST: HTTP/JSON | OpenAPI Swagger | JWT Bearer Auth
  WebSocket: ws:// protocol | JSON messages | Pub/Sub pattern

Layer 2 — API Layer (blue):
  Left column (REST):
    FastAPI 0.111.0 (Python)
    Uvicorn ASGI Server
    Pydantic 2.7.1 (validation)
    pydantic-settings (config)
    python-jose (JWT)
    passlib + bcrypt (auth)
    httpx / requests (HTTP client)
    PyYAML (config)
  Right column (WebSocket):
    FastAPI WebSockets
    asyncio (async I/O)
    redis[asyncio] (async pub/sub)

Layer 3 — Business Logic / Core Services (green):
  Left (C++):
    C++17 (ISO standard)
    CMake (build system)
    nlohmann/json (JSON parsing)
    hiredis (Redis C client)
    libpq (PostgreSQL C client)
    pthread (threading)
    yaml-cpp (config)
    Lock-free queues (custom)
    CPU thread affinity (performance)
  Right (Python):
    asyncpg (async PostgreSQL)
    asyncio consumers
    OHLCV bucket aggregation
    VWAC calculation
    Fill settlement logic
    Data pruner (retention)

Layer 4 — Message Bus & Cache (orange):
  Redis 7.2:
    Pub/Sub (ephemeral events)
    Streams with consumer groups (durable)
    Sorted Sets (time-series candles)
    Hashes (price tickers)
    Strings with TTL (snapshot cache)

Layer 5 — Persistence (red):
  PostgreSQL 16:
    Tables: users, orders, trades, portfolios, candles, balance_history
    UUID primary keys
    DECIMAL(18,6) for price precision
    TIMESTAMPTZ for timezone-aware times
    Composite primary keys (candles)
    Partial indexes (pending_trigger orders)
    Schema migrations (versioned)

Layer 6 — Infrastructure (dark grey, bottom):
  Docker Compose (10 services, ordered startup)
  Docker Bridge Network (internal communication)
  Volume mounts (PostgreSQL persistence)
  Environment variables (.env configuration)
  Health checks (service readiness probes)
  Port exposure: 8000 (REST), 8001 (WebSocket)

Add icons for each technology where applicable.
Color code each layer distinctly.
Show arrows between layers indicating data flow direction.
```

---

## Usage Notes

### Recommended Tools by Diagram Type

| Diagram Type | Recommended Tool |
|-------------|-----------------|
| Architecture overview | Draw.io, Lucidchart, Miro |
| Sequence diagrams | Mermaid (in Markdown), PlantUML |
| State machines | Mermaid, PlantUML |
| ERD | dbdiagram.io, pgAdmin, ERDplus |
| Flowcharts | Draw.io, Mermaid, Excalidraw |
| Mind maps | XMind, Miro, Figma |
| Tech stack | Figma, Canva, PowerPoint |

### Mermaid Integration

All Mermaid prompts can be rendered directly in:
- GitHub Markdown files (native support)
- GitLab Markdown
- Notion (with Mermaid plugin)
- VSCode (Markdown Preview Mermaid Support extension)
- Mermaid Live Editor: https://mermaid.live

### Color Scheme Recommendation

For consistent visual identity across all diagrams:
- C++ services: `#1E3A5F` (dark blue) with white text
- Python services: `#2D6A4F` (dark green) with white text
- Redis: `#A61C00` (redis red) with white text
- PostgreSQL: `#003087` (postgres blue) with white text
- Bots: `#F4A261` (amber) with dark text
- External clients: `#6B705C` (grey-green) with white text
- Data flows: `#457B9D` (medium blue) arrows
- Critical paths: `#E63946` (red) arrows
