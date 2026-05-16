-- 0005_0001 — Per-user email preferences + one-click unsubscribe token.
--
-- Each user gets:
--   * `email_token` — a UUID embedded in unsubscribe links. Looking up by
--     this token (instead of e.g. user_id directly) means the unsubscribe
--     URL is opaque + non-enumerable.  pgcrypto's gen_random_uuid() is
--     already available (initial migration enables the extension).
--   * Three boolean prefs, one per category. Default TRUE for every
--     existing row so today's behaviour (every email enabled) is preserved
--     for current users.
--
-- Categories — distinct user mental models so they get distinct toggles:
--   new_message         — "someone DM'd me about a listing"
--   reserved            — "the listing I posted just got reserved by someone"
--   saved_item_changed  — "an item I bookmarked was reserved or archived"

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "email_token" uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS "email_new_message_enabled" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "email_reserved_enabled" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "email_saved_item_changed_enabled" boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_token_uq" ON "users" ("email_token");
