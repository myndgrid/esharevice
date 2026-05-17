-- 0009_0001 — Stripe Connect tables. Powers the marketplace payment flow:
--   * `stripe_accounts` — one row per provider, lazy-created on first booking
--     request against their listing. Tracks the Express account's onboarding
--     state so the UI can show the right next-step CTA.
--   * `stripe_events` — webhook idempotency store. Postgres PK on the Stripe
--     event id makes duplicate-delivery a no-op at the SQL layer (a retried
--     webhook fails the INSERT, the handler short-circuits).
--
-- Scope: schema-only. The booking flow's actual Stripe SDK calls land in
-- the same PR (4) but the route changes are additive — `bookings.stripe_*`
-- columns were placeholders since migration 0008 and now get populated.
-- Behind `FEATURE_STRIPE` flag; routes 404 + booking flow stays Stripe-free
-- when off (legacy "all bookings are status='requested' forever" mode).

-- ─────────────────────── Enum

DO $$ BEGIN
  CREATE TYPE stripe_account_status AS ENUM (
    'pending',      -- account created, onboarding not yet started
    'restricted',   -- onboarding incomplete or Stripe paused the account
    'active',       -- charges_enabled + payouts_enabled both true
    'rejected'      -- Stripe terminated the account
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────── stripe_accounts

CREATE TABLE IF NOT EXISTS "stripe_accounts" (
  "id"                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- One Stripe Connect account per provider. The UNIQUE on user_id makes the
  -- "create or fetch" semantic of POST /v1/payouts/account a simple upsert.
  "user_id"                  uuid NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,

  -- Stripe-side identifiers. `account_id` is the canonical acct_xxxx ID.
  "account_id"               text NOT NULL UNIQUE,

  -- Onboarding state. Stripe's webhook (`account.updated`) drives transitions.
  "status"                   stripe_account_status NOT NULL DEFAULT 'pending',

  -- Capability snapshot — mirrored from Stripe so the API doesn't have to
  -- hit Stripe's REST API on every read. Updated by the account.updated
  -- webhook handler.
  "charges_enabled"          boolean NOT NULL DEFAULT false,
  "payouts_enabled"          boolean NOT NULL DEFAULT false,
  "details_submitted"        boolean NOT NULL DEFAULT false,

  -- Country code for the Express account (CAD merchant for the Toronto
  -- launch; future markets will add USD via additional accounts).
  "country"                  text NOT NULL DEFAULT 'CA',
  "default_currency"         text NOT NULL DEFAULT 'CAD',

  -- Lifecycle
  "created_at"               timestamptz NOT NULL DEFAULT now(),
  "updated_at"               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "stripe_accounts_status_idx"
  ON "stripe_accounts" ("status");

-- ─────────────────────── stripe_events
--
-- Webhook idempotency. Stripe retries deliveries up to 3 days on non-2xx
-- responses, so the same event id can arrive multiple times. Inserting the
-- event id as a PK on receipt — and short-circuiting if it already exists —
-- guarantees each event is processed exactly once.
--
-- We DON'T cache the body — the webhook handler re-reads the raw payload
-- each call (Stripe re-signs it) and re-runs the work. The PK is purely a
-- "have I seen this event?" check.

CREATE TABLE IF NOT EXISTS "stripe_events" (
  "event_id"     text PRIMARY KEY,    -- evt_xxxx (Stripe's canonical id)
  "type"         text NOT NULL,        -- e.g. "payment_intent.succeeded"
  "received_at"  timestamptz NOT NULL DEFAULT now(),
  -- The handler ran successfully? Set true on the path-out, false on error.
  -- Failed events can be retried by the operator via Stripe's dashboard;
  -- we just record what we saw.
  "processed"    boolean NOT NULL DEFAULT false,
  "error_detail" text
);

CREATE INDEX IF NOT EXISTS "stripe_events_received_at_idx"
  ON "stripe_events" ("received_at" DESC);
