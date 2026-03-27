-- Migration 001: Add stop order support
-- Run this against an already-running database instance.
-- Safe to run multiple times (IF NOT EXISTS / IF EXISTS guards throughout).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS stop_price  DECIMAL(18,6);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS limit_price DECIMAL(18,6);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS expires_at  TIMESTAMPTZ;

-- Widen order_type column to fit 'stop_limit' / 'stop_market'
ALTER TABLE orders ALTER COLUMN order_type TYPE VARCHAR(15);

-- Replace CHECK constraints
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_type_check;
ALTER TABLE orders ADD  CONSTRAINT orders_order_type_check
    CHECK (order_type IN ('limit','market','stop_limit','stop_market'));

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD  CONSTRAINT orders_status_check
    CHECK (status IN ('open','partial','filled','cancelled','failed','pending_trigger','triggered'));

-- Partial index for fast pending trigger lookups
CREATE INDEX IF NOT EXISTS idx_orders_pending_trigger
    ON orders(status) WHERE status = 'pending_trigger';
