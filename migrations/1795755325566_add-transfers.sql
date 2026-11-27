-- Up Migration
ALTER TYPE transaction_type ADD VALUE 'TRANSFER';

ALTER TABLE transactions
  ALTER COLUMN to_currency DROP NOT NULL,
  ALTER COLUMN to_amount DROP NOT NULL,
  ALTER COLUMN to_balance_after DROP NOT NULL,
  ADD COLUMN counterparty_wallet_id UUID REFERENCES wallets (id) DEFERRABLE INITIALLY IMMEDIATE,
  ADD COLUMN transfer_id UUID;

ALTER TABLE transactions DROP CONSTRAINT transactions_from_currency_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_from_currency_check
  CHECK (from_currency IS NOT NULL OR type::text IN ('INITIAL_DEPOSIT', 'DEPOSIT', 'TRANSFER'));
ALTER TABLE transactions ADD CONSTRAINT transactions_to_currency_check
  CHECK (to_currency IS NOT NULL OR type::text = 'TRANSFER');
ALTER TABLE transactions ADD CONSTRAINT transactions_sides_complete_check
  CHECK (
    (from_currency IS NULL) = (from_amount IS NULL) AND (from_currency IS NULL) = (from_balance_after IS NULL)
    AND (to_currency IS NULL) = (to_amount IS NULL) AND (to_currency IS NULL) = (to_balance_after IS NULL)
  );
ALTER TABLE transactions ADD CONSTRAINT transactions_transfer_check
  CHECK (
    CASE WHEN type::text = 'TRANSFER'
      THEN (from_currency IS NULL) <> (to_currency IS NULL)
        AND counterparty_wallet_id IS NOT NULL
        AND counterparty_wallet_id <> wallet_id
        AND transfer_id IS NOT NULL
      ELSE counterparty_wallet_id IS NULL AND transfer_id IS NULL
    END
  );

-- Down Migration
ALTER TABLE transactions DROP CONSTRAINT transactions_transfer_check;
ALTER TABLE transactions DROP CONSTRAINT transactions_sides_complete_check;
ALTER TABLE transactions DROP CONSTRAINT transactions_to_currency_check;
ALTER TABLE transactions DROP CONSTRAINT transactions_from_currency_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_from_currency_check
  CHECK (from_currency IS NOT NULL OR type::text IN ('INITIAL_DEPOSIT', 'DEPOSIT'));
ALTER TABLE transactions
  DROP COLUMN transfer_id,
  DROP COLUMN counterparty_wallet_id,
  ALTER COLUMN to_currency SET NOT NULL,
  ALTER COLUMN to_amount SET NOT NULL,
  ALTER COLUMN to_balance_after SET NOT NULL;
