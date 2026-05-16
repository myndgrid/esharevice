-- Migration: 0002_0001_exchange_items_archived_at
--
-- Adds soft-delete to exchange_items. `archived_at` is NULL for active
-- listings and a timestamp for hidden ones. Every list/read query gets a
-- `WHERE archived_at IS NULL` filter; once set, the row stays in the table
-- but is invisible to the application — FKs from `exchange_item_saves`
-- and `reserved_by` keep their referential integrity without orphaning.
--
-- Partial index — most queries scan the "active" subset, so indexing only
-- the rows with archived_at IS NULL is cheaper than a full index that
-- includes the archived tail.
--
-- Apply on the VPS with:
--   docker exec -i esharevice-postgres-1 \
--     psql -U "${POSTGRES_USER:-esharevice}" -d "${POSTGRES_DB:-esharevice}" \
--     < packages/db/drizzle/0002_0001_exchange_items_archived_at.sql

ALTER TABLE "exchange_items"
    ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;

-- Partial index — only the active rows. NULL is what queries filter on.
CREATE INDEX IF NOT EXISTS "exchange_items_active_idx"
    ON "exchange_items" ("created_at" DESC, "id" DESC)
    WHERE "archived_at" IS NULL;
