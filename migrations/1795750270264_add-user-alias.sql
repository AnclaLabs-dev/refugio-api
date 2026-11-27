-- Up Migration
ALTER TABLE users ADD COLUMN alias VARCHAR(30);

UPDATE users
SET alias = COALESCE(
    NULLIF(trim(BOTH '.' FROM left(regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9]+', '.', 'g'), 21)), ''),
    'usuario'
  ) || '.' || substr(md5(id::text), 1, 6);

ALTER TABLE users ALTER COLUMN alias SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_alias_key UNIQUE (alias);
ALTER TABLE users ADD CONSTRAINT users_alias_format
  CHECK (length(alias) BETWEEN 5 AND 30 AND alias ~ '^[a-z0-9]+(\.[a-z0-9]+)*$');

-- Down Migration
ALTER TABLE users DROP COLUMN alias;
