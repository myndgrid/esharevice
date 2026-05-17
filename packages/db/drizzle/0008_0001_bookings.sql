-- 0008_0001 — Bookings: the time-range reservation table for rent + hire
-- (and sell purchases too, with NULL start_at/end_at since sells are
-- instantaneous). The load-bearing piece is the partial `EXCLUDE USING gist`
-- no-overlap constraint that makes "two renters can't both book the same
-- pressure washer for the same weekend" a SQL-layer guarantee, not an
-- application-layer one. SQL > Zod for invariants that must hold across
-- crashes, retries, admin scripts, and future cron jobs.
--
-- Scope discipline: this migration ships behind FEATURE_BOOKINGS. Schema
-- lives in prod from day one but every booking endpoint 404s until the
-- flag flips. PR 4 layers Stripe Connect onto the same table; PR 11 makes
-- the cron jobs do real work. PR 3 ships skeletons.
--
-- Stripe linkage columns are nullable placeholders here so PR 4 can drop
-- the IDs in without another ALTER TABLE.

-- ─────────────────────── Extensions

-- btree_gist gives gist the equality operator for simple types (uuid,
-- int, text). Without it, EXCLUDE USING gist (item_id WITH =, …) fails
-- with "data type uuid has no default operator class for access method gist".
-- This is the standard pattern for "no overlap of a range per group_key".
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ─────────────────────── Enums

DO $$ BEGIN
  CREATE TYPE booking_status AS ENUM (
    'requested',   -- renter requested; provider has not yet accepted
    'confirmed',   -- provider accepted; payment captured (or pending capture in PR 4)
    'active',      -- start_at reached; item in use
    'returned',    -- provider marked returned; 24h release window started
    'completed',   -- 24h passed without dispute; funds released
    'declined',    -- provider declined the request
    'cancelled'    -- either party cancelled pre-start
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────── Bookings table

CREATE TABLE IF NOT EXISTS "bookings" (
  "id"                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Three-way join: which listing, who's renting, who's providing.
  -- provider_id is denormalised from exchange_items.user_id so the
  -- "my incoming bookings" query is a single-table scan + index seek.
  -- Worth the redundancy because provider_id is immutable on a listing
  -- (a listing can't change owners; archived → cascade NULL on renter_id
  -- but provider's row stays for audit).
  "item_id"                 uuid NOT NULL REFERENCES "exchange_items"("id") ON DELETE RESTRICT,
  "renter_id"               uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "provider_id"             uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,

  -- ── State machine
  "status"                  booking_status NOT NULL DEFAULT 'requested',

  -- ── Time range (nullable for sell purchases — sells are instantaneous,
  --    no date range, no overlap concern)
  "start_at"                timestamptz,
  "end_at"                  timestamptz,

  -- ── Pricing snapshot (immutable post-create — guards against the provider
  --    raising the price mid-booking and the renter being on the hook)
  --    All amounts in cents-CAD per the Toronto launch decision.
  "price_cents"             integer NOT NULL,
  "price_unit"              price_unit,     -- nullable for sell ('fixed' is the implicit)
  "quantity"                integer NOT NULL DEFAULT 1,   -- days / hours / 1 for sell
  "subtotal_cents"          integer NOT NULL,             -- price_cents * quantity
  "platform_fee_cents"      integer NOT NULL,             -- 10% rent/sell, 12% hire
  "stripe_fee_cents"        integer,                       -- set at capture (PR 4)
  "deposit_cents"           integer NOT NULL DEFAULT 0,
  "total_cents"             integer NOT NULL,             -- subtotal + platform_fee + (stripe_fee ?? 0) + deposit
  "currency"                text    NOT NULL DEFAULT 'CAD',

  -- ── Stripe linkage (placeholders; PR 4 populates)
  "stripe_payment_intent_id" text,
  "stripe_charge_id"        text,
  "stripe_transfer_id"      text,

  -- ── Notes
  "message_to_provider"     text,
  "decline_reason"          text,
  "cancel_reason"           text,
  "cancelled_by"            uuid REFERENCES "users"("id") ON DELETE SET NULL,

  -- ── Lifecycle timestamps (each transition sets one)
  "requested_at"            timestamptz NOT NULL DEFAULT now(),
  "confirmed_at"            timestamptz,
  "active_at"               timestamptz,
  "returned_at"             timestamptz,
  "completed_at"            timestamptz,
  "declined_at"             timestamptz,
  "cancelled_at"            timestamptz,

  -- ── Audit
  "created_at"              timestamptz NOT NULL DEFAULT now(),
  "updated_at"              timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────── Invariants

-- Quantity strictly positive — guards "free 0-day rentals" + arithmetic sanity.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_quantity_positive" CHECK ("quantity" > 0);

-- Money sanity — never negative.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_money_nonneg" CHECK (
    "price_cents" >= 0 AND "subtotal_cents" >= 0 AND
    "platform_fee_cents" >= 0 AND "deposit_cents" >= 0 AND
    "total_cents" >= 0 AND
    ("stripe_fee_cents" IS NULL OR "stripe_fee_cents" >= 0)
  );

-- Date sanity — end_at must follow start_at when both present.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_date_range" CHECK (
    "start_at" IS NULL OR "end_at" IS NULL OR "end_at" > "start_at"
  );

-- start/end are either BOTH null (sell) or BOTH non-null (rent/hire).
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_date_pair" CHECK (
    ("start_at" IS NULL AND "end_at" IS NULL)
    OR
    ("start_at" IS NOT NULL AND "end_at" IS NOT NULL)
  );

-- THE load-bearing invariant: no overlapping bookings on the same item
-- while a booking holds an "active" claim. Active claims = states where
-- the dates are spoken-for: requested (renter is holding the slot pending
-- provider response), confirmed (provider accepted, dates locked), active
-- (item physically in use). Once status drops to declined/cancelled/returned/
-- completed, the slot is free again.
--
-- Range type: tstzrange with `[)` boundary (inclusive start, exclusive end)
-- so back-to-back bookings (one ends 09:00, next starts 09:00) don't overlap.
-- Partial WHERE excludes sell rows (start_at/end_at NULL) entirely — the
-- range expression `tstzrange(NULL, NULL)` would error at constraint check
-- time, and "the same physical item is sold once" is enforced by the
-- existing exchange_items.reserved flag instead.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "item_id" WITH =,
    tstzrange("start_at", "end_at", '[)') WITH &&
  )
  WHERE (
    "status" IN ('requested', 'confirmed', 'active')
    AND "start_at" IS NOT NULL
    AND "end_at" IS NOT NULL
  );

-- ─────────────────────── Indexes

-- "Show me MY bookings as a renter" — cursor-paginated by created_at desc.
CREATE INDEX IF NOT EXISTS "bookings_renter_created_idx"
  ON "bookings" ("renter_id", "created_at" DESC, "id" DESC);

-- "Show me incoming bookings on MY listings" — same shape, different actor.
CREATE INDEX IF NOT EXISTS "bookings_provider_created_idx"
  ON "bookings" ("provider_id", "created_at" DESC, "id" DESC);

-- Per-item lookups (the calendar's "what dates are taken on this item").
-- Partial WHERE matches the EXCLUDE — the planner uses one or the other
-- depending on the cardinality, and both stay lean as completed/cancelled
-- bookings accumulate.
CREATE INDEX IF NOT EXISTS "bookings_item_active_idx"
  ON "bookings" ("item_id", "start_at")
  WHERE "status" IN ('requested', 'confirmed', 'active');

-- Cron-job scans: "confirmed bookings whose start_at has passed → activate"
-- and "returned bookings whose returned_at is more than 24h ago → complete".
-- Both rely on a status filter; partial index is the right shape.
CREATE INDEX IF NOT EXISTS "bookings_status_idx"
  ON "bookings" ("status");

-- Stripe webhook receiver looks up by payment_intent — must be fast.
CREATE INDEX IF NOT EXISTS "bookings_stripe_pi_idx"
  ON "bookings" ("stripe_payment_intent_id")
  WHERE "stripe_payment_intent_id" IS NOT NULL;
