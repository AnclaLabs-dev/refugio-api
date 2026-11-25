-- Up Migration
ALTER TABLE transactions DROP CONSTRAINT transactions_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_from_currency_check
  CHECK (from_currency IS NOT NULL OR type::text IN ('INITIAL_DEPOSIT', 'DEPOSIT'));

-- Down Migration
ALTER TABLE transactions DROP CONSTRAINT transactions_from_currency_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_check
  CHECK (from_currency IS NOT NULL OR type = 'INITIAL_DEPOSIT');
