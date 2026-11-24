-- Up Migration
CREATE TYPE transaction_type AS ENUM ('BUY', 'SELL', 'EXCHANGE', 'INITIAL_DEPOSIT');
CREATE TYPE rate_type AS ENUM ('oficial', 'mep', 'blue', 'cripto', 'spot');
CREATE TYPE rate_side AS ENUM ('buy', 'sell');
CREATE TYPE email_status AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets (id) DEFERRABLE INITIALLY IMMEDIATE,
  type transaction_type NOT NULL,
  from_currency VARCHAR(10) REFERENCES currencies (code) DEFERRABLE INITIALLY IMMEDIATE,
  from_amount NUMERIC(30, 8),
  from_balance_after NUMERIC(30, 8),
  to_currency VARCHAR(10) NOT NULL REFERENCES currencies (code) DEFERRABLE INITIALLY IMMEDIATE,
  to_amount NUMERIC(30, 8) NOT NULL,
  to_balance_after NUMERIC(30, 8) NOT NULL,
  rate NUMERIC(30, 10),
  rate_type rate_type,
  rate_side rate_side,
  spread NUMERIC(6, 4) NOT NULL DEFAULT 0,
  rate_source VARCHAR(50),
  rate_fetched_at TIMESTAMPTZ,
  idempotency_key VARCHAR(64) UNIQUE NOT NULL,
  email_status email_status NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_currency IS NOT NULL OR type = 'INITIAL_DEPOSIT')
);

CREATE INDEX ON transactions (wallet_id, created_at);

CREATE TABLE savings_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) DEFERRABLE INITIALLY IMMEDIATE,
  name VARCHAR(100) NOT NULL,
  target_usd NUMERIC(20, 2) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ON savings_goals (user_id) WHERE is_active;

CREATE TABLE exchange_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_currency VARCHAR(10) NOT NULL REFERENCES currencies (code) DEFERRABLE INITIALLY IMMEDIATE,
  quote_currency VARCHAR(10) NOT NULL REFERENCES currencies (code) DEFERRABLE INITIALLY IMMEDIATE,
  rate_type rate_type NOT NULL,
  buy NUMERIC(30, 10) NOT NULL,
  sell NUMERIC(30, 10) NOT NULL,
  source VARCHAR(50) NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX ON exchange_rates (base_currency, quote_currency, rate_type);

CREATE TABLE rate_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  base_currency VARCHAR(10) NOT NULL REFERENCES currencies (code) DEFERRABLE INITIALLY IMMEDIATE,
  quote_currency VARCHAR(10) NOT NULL REFERENCES currencies (code) DEFERRABLE INITIALLY IMMEDIATE,
  rate_type rate_type NOT NULL,
  buy NUMERIC(30, 10) NOT NULL,
  sell NUMERIC(30, 10) NOT NULL,
  source VARCHAR(50) NOT NULL
);

CREATE UNIQUE INDEX ON rate_history (date, base_currency, quote_currency, rate_type);

-- Down Migration
DROP TABLE rate_history;
DROP TABLE exchange_rates;
DROP TABLE savings_goals;
DROP TABLE transactions;
DROP TYPE email_status;
DROP TYPE rate_side;
DROP TYPE rate_type;
DROP TYPE transaction_type;
