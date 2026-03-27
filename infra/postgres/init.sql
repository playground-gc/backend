-- Synthetic-Bull PostgreSQL schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE users (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    username      VARCHAR(50) UNIQUE NOT NULL,
    email         VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    balance       DECIMAL(18,2) NOT NULL DEFAULT 100000.00,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Portfolios ───────────────────────────────────────────────────────────────
CREATE TABLE portfolios (
    id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol   VARCHAR(20) NOT NULL,
    quantity DECIMAL(18,6) NOT NULL DEFAULT 0,
    avg_cost DECIMAL(18,6) NOT NULL DEFAULT 0,
    UNIQUE (user_id, symbol)
);

-- ─── Orders ───────────────────────────────────────────────────────────────────
CREATE TABLE orders (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
    symbol      VARCHAR(20) NOT NULL,
    order_type  VARCHAR(15) NOT NULL CHECK (order_type IN ('limit','market','stop_limit','stop_market')),
    side        VARCHAR(4)  NOT NULL CHECK (side IN ('buy','sell')),
    price       DECIMAL(18,6),                      -- NULL for market orders
    stop_price  DECIMAL(18,6),                      -- trigger price for stop orders
    limit_price DECIMAL(18,6),                      -- limit price forwarded to engine on trigger (stop_limit only)
    quantity    DECIMAL(18,6) NOT NULL,
    filled_qty  DECIMAL(18,6) NOT NULL DEFAULT 0,
    status      VARCHAR(20)  NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','partial','filled','cancelled','failed','pending_trigger','triggered')),
    expires_at  TIMESTAMPTZ,                        -- NULL = GTC; stop orders default to 30 days
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_user             ON orders(user_id);
CREATE INDEX idx_orders_symbol_status    ON orders(symbol, status);
CREATE INDEX idx_orders_created          ON orders(created_at DESC);
CREATE INDEX idx_orders_pending_trigger  ON orders(status) WHERE status = 'pending_trigger';

-- ─── Trades ───────────────────────────────────────────────────────────────────
CREATE TABLE trades (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol        VARCHAR(20) NOT NULL,
    buy_order_id  UUID,
    sell_order_id UUID,
    price         DECIMAL(18,6) NOT NULL,
    quantity      DECIMAL(18,6) NOT NULL,
    buyer_id      UUID,
    seller_id     UUID,
    timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trades_symbol_ts ON trades(symbol, timestamp DESC);
CREATE INDEX idx_trades_buyer     ON trades(buyer_id);
CREATE INDEX idx_trades_seller    ON trades(seller_id);

-- ─── Candles ──────────────────────────────────────────────────────────────────
CREATE TABLE candles (
    symbol    VARCHAR(20)   NOT NULL,
    interval  VARCHAR(5)    NOT NULL CHECK (interval IN ('1s','10s','1m')),
    open      DECIMAL(18,6) NOT NULL,
    high      DECIMAL(18,6) NOT NULL,
    low       DECIMAL(18,6) NOT NULL,
    close     DECIMAL(18,6) NOT NULL,
    volume    DECIMAL(18,6) NOT NULL DEFAULT 0,
    timestamp TIMESTAMPTZ   NOT NULL,
    PRIMARY KEY (symbol, interval, timestamp)
);

CREATE INDEX idx_candles_lookup ON candles(symbol, interval, timestamp DESC);

-- ─── Trigger: keep orders.updated_at fresh ────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Bot users (seeded at startup) ────────────────────────────────────────────
-- Actual password hashes are set by the api-gateway on first run via /auth/register.
-- These are placeholder rows so bots can log in immediately.
-- Passwords: 'mmbot_pass' and 'alphabot_pass' (overridden by env vars).
