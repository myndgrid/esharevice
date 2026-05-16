-- Migration: 0001_0001_exchange_item_saves
--
-- Adds the exchange_item_saves table — a many-to-many mapping of which user
-- has bookmarked which exchange_item. Composite PK on (user_id, item_id)
-- makes the relationship idempotent: INSERT … ON CONFLICT DO NOTHING is the
-- canonical "save this item" pattern.
--
-- Both FKs CASCADE on delete so removing a user (account-deletion path) or
-- an exchange_item (listing-removed path) cleans up associated saves
-- without an orphan-row sweep.
--
-- Apply on the VPS with:
--   docker exec -i esharevice-postgres-1 \
--     psql -U "${POSTGRES_USER:-esharevice}" -d "${POSTGRES_DB:-esharevice}" \
--     < packages/db/drizzle/0001_0001_exchange_item_saves.sql

CREATE TABLE IF NOT EXISTS "exchange_item_saves" (
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "item_id" uuid NOT NULL REFERENCES "exchange_items"("id") ON DELETE CASCADE,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY ("user_id", "item_id")
);

-- Listing index: "what items has this user saved, most-recent first?"
-- (user_id, created_at DESC) — the composite PK already covers (user_id, item_id)
-- lookups but Postgres can't use the PK index in DESC creation order for the
-- list-by-recency query without an extra sort step.
CREATE INDEX IF NOT EXISTS "exchange_item_saves_user_id_idx"
    ON "exchange_item_saves" ("user_id", "created_at" DESC);
