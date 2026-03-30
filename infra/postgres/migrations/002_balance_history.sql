-- Migration 002: Add balance_history ledger table
-- Tracks every credit/debit to a user's cash balance.
-- Safe to run multiple times (IF NOT EXISTS guards throughout).

CREATE TABLE IF NOT EXISTS balance_history (
    id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delta      DECIMAL(18,2) NOT NULL,       -- positive = credit (sell proceeds), negative = debit (buy cost)
    balance    DECIMAL(18,2) NOT NULL,       -- cash balance AFTER this event
    reason     VARCHAR(20)   NOT NULL        -- 'trade_buy' | 'trade_sell'
                 CHECK (reason IN ('trade_buy', 'trade_sell')),
    symbol     VARCHAR(20),
    quantity   DECIMAL(18,6),
    price      DECIMAL(18,6),
    trade_id   UUID,
    created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_balance_history_user
    ON balance_history(user_id, created_at DESC);
