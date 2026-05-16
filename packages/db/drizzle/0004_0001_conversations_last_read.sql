-- Migration: 0004_0001_conversations_last_read
--
-- Adds two timestamps to `conversations` that track the last time each
-- participant viewed (or sent in) the thread. Used by the email-on-new-
-- message helper to suppress notifications when the recipient is actively
-- engaged: if their last_read_at is within the threshold (2 min) when a
-- new message arrives, skip the email — the SSE stream is already
-- delivering it in real time.
--
-- Denormalised onto the conversations row (rather than a separate
-- conversation_reads table) because there are exactly two participants
-- and the access pattern is "read alongside the conversation row." A
-- separate table would force an extra join on every list + thread view.
--
-- NULL means "never seen." Existing rows (pre-migration threads) get
-- NULL, which means everyone gets an email on the next message — better
-- than silently dropping notifications on old threads.
--
-- Apply on the VPS with:
--   docker exec -i esharevice-postgres-1 \
--     psql -U "${POSTGRES_USER:-esharevice}" -d "${POSTGRES_DB:-esharevice}" \
--     < packages/db/drizzle/0004_0001_conversations_last_read.sql

ALTER TABLE "conversations"
    ADD COLUMN IF NOT EXISTS "initiator_last_read_at" timestamp with time zone,
    ADD COLUMN IF NOT EXISTS "owner_last_read_at" timestamp with time zone;
