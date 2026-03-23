# Synthetic-Bull – Real-Time Simulated Trading Exchange

## Quick Start

```bash
cd infra
cp .env.example .env        # edit passwords if needed
docker-compose up --build
```

Services:
- **API Gateway** → http://localhost:8000  (Swagger: http://localhost:8000/docs)
- **WebSocket**   → ws://localhost:8001/ws/{symbol}

## Architecture

```
Market Generator (C++ GBM) ──TCP:9000──► Matching Engine (C++)
                                                │
                                          Redis pub/sub + streams
                                         /             \
                               Candle Service     WebSocket Service
                               (OHLCV agg)        (→ frontend)
                                    │
                               PostgreSQL

API Gateway (FastAPI) ──TCP:9000──► Matching Engine
Market Maker Bot ──HTTP──► API Gateway
Alpha Bot        ──HTTP──► API Gateway
```

## Symbols

Defined in `shared/config/stocks.yaml`:
- `AAPL_S` – Apple Synthetic ($180, σ=2%)
- `GOOGL_S` – Google Synthetic ($140, σ=2.5%)
- `TSLA_S` – Tesla Synthetic ($200, σ=4%)
- `MSFT_S` – Microsoft Synthetic ($380, σ=1.8%)
- `AMZN_S` – Amazon Synthetic ($170, σ=2.2%)

## API Reference

### Auth
```
POST /api/v1/auth/register   {"username","email","password"}
POST /api/v1/auth/login      {"username","password"}  → {access_token}
```

### Orders (JWT required)
```
POST   /api/v1/orders                    place order
DELETE /api/v1/orders/{id}               cancel order
GET    /api/v1/orders?symbol=&status=    list my orders
```

### Market Data
```
GET /api/v1/stocks                       list all symbols
GET /api/v1/orderbook/{symbol}           top-20 orderbook
GET /api/v1/candles/{symbol}?interval=1m historical candles
GET /api/v1/ticker/{symbol}              latest price
GET /api/v1/trades/{symbol}              recent trades
GET /api/v1/portfolio                    my holdings
```

### WebSocket
Connect to `ws://localhost:8001/ws/{SYMBOL}`.

Default streams: `trades`, `orderbook`, `candles:1m`.

To change subscriptions send:
```json
{"subscribe": ["trades", "orderbook", "candles:1s", "candles:10s", "candles:1m"]}
```

## Redis Keys

| Key | Type | Description |
|-----|------|-------------|
| `trades:{symbol}` | Pub/Sub | Real-time trades |
| `orderbook:{symbol}` | Pub/Sub | Orderbook snapshots |
| `candles:{symbol}:{interval}` | Pub/Sub | Candle close events |
| `stream:trades` | Stream | Durable trade log |
| `candles:{symbol}:{interval}` | Sorted Set | Historical candles |
| `price:{symbol}` | Hash | Latest price/volume |
| `orderbook:snapshot:{symbol}` | String (TTL 5s) | Orderbook cache |

## Development

Build and run a single service:
```bash
# Matching engine only
cd matching-engine
cmake -B build && cmake --build build
./build/matching_engine

# API gateway only (requires Redis + Postgres + matching engine running)
cd api-gateway
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Test order flow:
```bash
# Register
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"test","email":"t@t.com","password":"test123"}'

# Login → copy token
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"test123"}'

# Place limit buy
curl -X POST http://localhost:8000/api/v1/orders \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"AAPL_S","type":"limit","side":"buy","price":180.0,"quantity":5}'

# Get orderbook
curl http://localhost:8000/api/v1/orderbook/AAPL_S

# Get candles
curl "http://localhost:8000/api/v1/candles/AAPL_S?interval=1m"
```
