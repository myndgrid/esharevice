-- Migration: 0003_0001_conversations_and_messages
--
-- Adds the messaging substrate: a conversation is tied to one
-- exchange_item and one prospective party (the non-owner who started
-- the thread). The listing owner is derivable via item.user_id — no
-- denormalised column to keep in sync. UNIQUE (item_id, initiator_id)
-- means a single non-owner has at most one conversation per item.
--
-- Messages reference the conversation; sender is one of the two
-- participants (validated at the API layer, not in SQL).
--
-- Apply on the VPS with:
--   docker exec -i esharevice-postgres-1 \
--     psql -U "${POSTGRES_USER:-esharevice}" -d "${POSTGRES_DB:-esharevice}" \
--     < packages/db/drizzle/0003_0001_conversations_and_messages.sql

CREATE TABLE IF NOT EXISTS "conversations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "item_id" uuid NOT NULL REFERENCES "exchange_items"("id") ON DELETE CASCADE,
    "initiator_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "last_message_at" timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE ("item_id", "initiator_id")
);

-- Listing index — "all conversations for this user, most-recent first."
-- The user query is `WHERE initiator_id = $me OR owner = $me`; the OR
-- forces a union-style scan, so we index both sides explicitly.
CREATE INDEX IF NOT EXISTS "conversations_initiator_idx"
    ON "conversations" ("initiator_id", "last_message_at" DESC);

CREATE INDEX IF NOT EXISTS "conversations_item_idx"
    ON "conversations" ("item_id");

CREATE TABLE IF NOT EXISTS "messages" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
    "sender_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "body" text NOT NULL CHECK (length("body") > 0 AND length("body") <= 4000),
    "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Per-conversation, oldest-first message scan — also serves cursor
-- pagination on (created_at, id) by descending.
CREATE INDEX IF NOT EXISTS "messages_conversation_idx"
    ON "messages" ("conversation_id", "created_at" DESC, "id" DESC);
