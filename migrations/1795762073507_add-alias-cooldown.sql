-- Up Migration
ALTER TABLE users ADD COLUMN alias_updated_at TIMESTAMPTZ;
ALTER TABLE users DROP CONSTRAINT users_alias_format;
ALTER TABLE users ADD CONSTRAINT users_alias_format
  CHECK (length(alias) BETWEEN 3 AND 30 AND alias ~ '^[a-z0-9]+(\.[a-z0-9]+)*$');

-- Down Migration
ALTER TABLE users DROP CONSTRAINT users_alias_format;
ALTER TABLE users ADD CONSTRAINT users_alias_format
  CHECK (length(alias) BETWEEN 5 AND 30 AND alias ~ '^[a-z0-9]+(\.[a-z0-9]+)*$');
ALTER TABLE users DROP COLUMN alias_updated_at;
