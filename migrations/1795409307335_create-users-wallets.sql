-- Up Migration
CREATE TYPE currency_type AS ENUM ('fiat', 'crypto');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid VARCHAR(128) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users (id) DEFERRABLE INITIALLY IMMEDIATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE currencies (
  code VARCHAR(10) PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  type currency_type NOT NULL,
  decimals SMALLINT NOT NULL
);

INSERT INTO currencies (code, name, type, decimals) VALUES
  ('ARS', 'Peso argentino', 'fiat', 2),
  ('USD', 'Dólar estadounidense', 'fiat', 2),
  ('USDT', 'Tether', 'crypto', 6),
  ('BTC', 'Bitcoin', 'crypto', 8);

CREATE TABLE balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets (id) DEFERRABLE INITIALLY IMMEDIATE,
  currency_code VARCHAR(10) NOT NULL REFERENCES currencies (code) DEFERRABLE INITIALLY IMMEDIATE,
  amount NUMERIC(30, 8) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ON balances (wallet_id, currency_code);

-- Down Migration
DROP TABLE balances;
DROP TABLE currencies;
DROP TABLE wallets;
DROP TABLE users;
DROP TYPE currency_type;
