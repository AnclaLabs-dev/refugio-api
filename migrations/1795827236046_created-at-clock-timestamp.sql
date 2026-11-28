-- Up Migration
ALTER TABLE transactions ALTER COLUMN created_at SET DEFAULT clock_timestamp();

-- Down Migration
ALTER TABLE transactions ALTER COLUMN created_at SET DEFAULT now();
