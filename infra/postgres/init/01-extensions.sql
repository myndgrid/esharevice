-- Postgres extensions that the app schema relies on.
-- Runs once on first DB init (idempotent).

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Future:
-- CREATE EXTENSION IF NOT EXISTS postgis;   -- enable when geo features land
