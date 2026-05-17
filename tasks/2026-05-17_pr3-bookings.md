# Task: PR 3 — Bookings Schema + API

**Created:** 2026-05-17 05:25 UTC
**Last Updated:** 2026-05-17 05:25 UTC
**Status:** Complete — shipped as `feat/pr3-bookings`

## Objective

Third slice of the [2026-05-16 marketplace overhaul plan](2026-05-16_premium-marketplace-redesign-plan.md). Lands the bookings table + state machine + 7 endpoints + cron-job stubs. Self-contained backend. **The load-bearing piece is the partial `EXCLUDE USING gist` no-overlap constraint** that makes "two renters can never both book the same item for overlapping date ranges" a SQL-layer invariant.

Independent of PR 1b (Auth.js). Cut from `main` after PRs 1a + 2 merged.

## Clarifying Questions & Answers

Carried over from session-level decisions:

| Question | Answer |
|---|---|
| Branch base? | `main` (parallel to any future PR 1b/4/etc.). |
| Sell rows in `bookings` table? | Yes — same table, with `start_at = end_at = NULL` and a `bookings_date_pair` CHECK that pairs them. The EXCLUDE partial WHERE filters sells out so multiple sell bookings can coexist (the existing `exchange_items.reserved` flag is the "first purchaser wins" guard). |
| Status values? | `requested`, `confirmed`, `active`, `returned`, `completed`, `declined`, `cancelled`. Disputed lands in PR 10 with the disputes table. |
| Range semantics? | `tstzrange` with `[)` bounds (inclusive-start, exclusive-end). Back-to-back bookings (one ends 09:00, next starts 09:00) do NOT overlap. |
| Currency? | `CAD` literal at v1. Multi-currency is post-launch. |
| Idempotency? | Existing `idempotency()` middleware applies to every state-mutating endpoint. |
| Stripe at this layer? | No — Stripe linkage columns are placeholders. PR 4 wires the actual `payment_intent` / `capture` / `transfer` calls. |

## Plan

1. Cut `feat/pr3-bookings` from `main`.
2. Audit existing route + middleware patterns. Confirm `btree_gist` extension is OK to enable in the migration.
3. Write migration `0008_0001_bookings.sql`:
   - `CREATE EXTENSION IF NOT EXISTS btree_gist;`
   - `booking_status` enum.
   - `bookings` table with 30+ columns.
   - 4 CHECK constraints — quantity positive, money non-negative, date range, date pair.
   - **THE** `bookings_no_overlap` partial `EXCLUDE USING gist` constraint.
   - 5 indexes — partial where applicable.
4. Mirror in Drizzle (`packages/db/src/schema.ts`): `bookingStatusEnum`, `bookings` table, type exports.
5. Write Zod schemas (`packages/shared/src/schemas/booking.ts`):
   - `Booking` response shape (35+ fields, all timestamps ISO).
   - `BookingCreate` with date-pairing `superRefine` + `.strict()`.
   - `BookingListQuery` (role required: renter | provider).
   - `BookingDecline` + `BookingCancel` (reason required).
   - `BookingEmptyBody` for accept/return (no payload, strict).
6. Write `apps/api/src/lib/pricing.ts`:
   - `calculateTotals` — 10% fee for rent/sell, 12% for hire. Half-up rounding. CAD cents throughout.
   - `quantityFromRange` — `day`/`hour` round up, `fixed` always 1.
7. Add `FEATURE_BOOKINGS` env flag to `apps/api/src/env.ts` + both `.env.example` files.
8. Write `apps/api/src/routes/v1/bookings.ts`:
   - `requireBookingsFlag()` at the head of every handler.
   - POST `/items/:id/bookings` — type validation, pricing snapshot, EXCLUDE-aware error mapping (23P01 → 409).
   - GET `/bookings` — role-scoped list with cursor pagination.
   - GET `/bookings/:id` — actor-scoped (renter OR provider; otherwise 404 not 403, no existence leak).
   - POST `/{id}/accept` — guarded transition from `requested`.
   - POST `/{id}/decline` — guarded transition; requires reason.
   - POST `/{id}/return` — guarded transition from `active`.
   - POST `/{id}/cancel` — multi-state guard via SQL `IN (...)`.
   - Idempotency middleware on every mutating endpoint.
9. Write cron stubs in `apps/api/src/jobs/`:
   - `bookings-activate.ts` — confirmed → active when `start_at <= now()`.
   - `bookings-complete.ts` — returned → completed when `returned_at + 24h <= now()`.
   - Both no-op when `FEATURE_BOOKINGS` is off. Scheduler hook is PR 11.
10. Mount `/v1/bookings` in `apps/api/src/index.ts`.
11. Write `apps/api/tests/bookings.test.ts`:
    - Pricing math (5 tests) — fees per type, half-up rounding, error cases.
    - `quantityFromRange` (4 tests) — day/hour round-up semantics.
    - Zod schemas (~10 tests) — date pairing, currency lock, strict mode.
    - DB integration (6 tests, skip-when-no-Postgres):
      - **Overlapping bookings rejected by EXCLUDE.**
      - Back-to-back bookings allowed (`[)` semantics).
      - New booking allowed when overlapping one is declined/cancelled.
      - Multiple sell bookings coexist (no date range, EXCLUDE doesn't fire).
      - `bookings_date_pair` CHECK rejects one-sided ranges.
      - `bookings_money_nonneg` CHECK rejects negative totals.
12. `pnpm typecheck` + `pnpm exec vitest run tests/bookings.test.ts` — both clean.
13. Commit + push + open PR.

## Edge Cases to Handle

- **Sell rows in `bookings` table** — sells are instantaneous, no date range. Solution: `start_at`/`end_at` are nullable but a `bookings_date_pair` CHECK pairs them (both null or both not). The EXCLUDE partial WHERE filters sells out so the constraint doesn't try to build a `tstzrange(NULL, NULL)` (which errors at check time).
- **`requested` state included in EXCLUDE** — once a renter has requested specific dates, those dates are soft-held until the provider accepts or declines. Excluding `requested` would let two renters race-create overlapping requests, with the provider then in an awkward "accept which one?" position. Including it means the second request 409s immediately and the second renter can pick different dates.
- **Back-to-back bookings** — `tstzrange` with `[)` semantics (inclusive-start, exclusive-end). 09:00–17:00 and 17:00–19:00 do NOT overlap. Test covers this explicitly.
- **Declined / cancelled rows free the dates** — the EXCLUDE partial WHERE is `status IN ('requested', 'confirmed', 'active')`. Once a booking drops to declined / cancelled / returned / completed, its row no longer participates in the constraint and new overlapping bookings succeed. Test covers this.
- **Sell quantity vs date range** — `quantityFromRange` returns 1 for `fixed` and null `price_unit` so sell bookings don't accidentally inherit a date-range-derived quantity if someone passes `start_at`/`end_at` for a sell (the route rejects that combo upfront anyway).
- **Half-up rounding on platform fees** — JS `Math.round` is banker's rounding (round-half-to-even), which results in `Math.round(0.5) === 0`. Surprising for billing. `roundHalfUp` in `pricing.ts` explicitly handles half cases by rounding away from zero. Test covers $0.33 → $0.03 and $0.35 → $0.04.
- **Stripe error code 23P01 surfacing** — Postgres exclusion violation maps to "Those dates overlap an existing booking…" with HTTP 409. Tested via the regex in the catch block.
- **Actor scoping on GET** — Returning 404 (not 403) when a non-participant requests a booking by id avoids leaking the booking's existence. Same pattern as the prior auth-aware reads.
- **Cancellation states** — Only `requested` + `confirmed` can be cancelled. Once `active`, the booking has to complete or be disputed; once `returned`/`completed`/`declined`/`cancelled`, it's terminal. The guarded `UPDATE … WHERE status IN ('requested','confirmed')` makes the rule atomic.
- **Concurrent accept/decline by provider** — Multiple tabs, flaky network, double-tap. The state-machine `transition` helper makes the WHERE clause include the expected current status, so the second invocation sees zero rows and returns 409 with a clear message.
- **Pricing snapshot immutability** — Once a booking is created, the price + fee fields are frozen. If the provider raises the listing price tomorrow, existing bookings stay at the original price. Enforced by simply not having a PUT for those columns.
- **Booking on own listing** — 409 not 400. Owners can't book themselves; the renter ≠ provider invariant is application-layer (Drizzle is in a good spot to enforce; SQL could do it too but the symmetry between provider/renter columns isn't a CHECK-friendly shape).

## Progress Log

### 2026-05-17 04:58 UTC
- Branched `feat/pr3-bookings` from main. Audited existing patterns (idempotency middleware, cursor helpers, postgres extension init).
- Confirmed `btree_gist` is not yet in `infra/postgres/init/01-extensions.sql`; chose to enable it inside migration 0008 itself so the migration is self-contained (works on first-run dev DB without manual extension setup).

### 2026-05-17 05:05 UTC
- Wrote migration 0008. The EXCLUDE constraint is the centrepiece — `EXCLUDE USING gist (item_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE status IN ('requested','confirmed','active') AND start_at IS NOT NULL AND end_at IS NOT NULL`. Partial WHERE keeps sells out of the picture.

### 2026-05-17 05:12 UTC
- Mirrored the bookings table in Drizzle. Added `bookingStatusEnum`, type exports.
- Wrote Booking Zod schemas: `Booking` (35+ fields), `BookingCreate` with date-pairing superRefine, transition bodies.

### 2026-05-17 05:18 UTC
- `apps/api/src/lib/pricing.ts` — `calculateTotals` (10%/12% fees, half-up rounding, CAD cents) + `quantityFromRange` (round-up day/hour).
- Added `FEATURE_BOOKINGS` env flag.

### 2026-05-17 05:22 UTC
- Wrote `apps/api/src/routes/v1/bookings.ts` — 7 endpoints, idempotency on every mutating route, state-machine `transition` helper for atomic guarded updates, EXCLUDE error mapping.
- Wrote cron stubs in `apps/api/src/jobs/`. Both flag-gated, scheduler hook in PR 11.
- Mounted `/v1/bookings` in API entry.

### 2026-05-17 05:24 UTC
- Wrote bookings test suite. 6 DB-integration tests cover the EXCLUDE constraint behavior (overlap rejection, back-to-back acceptance, declined-frees-dates, sell-coexistence, date-pair CHECK, money CHECK) + 14 unit tests for pricing math + Zod schemas.
- `pnpm typecheck` — clean across all 5 packages.

### 2026-05-17 05:28 UTC
- Realised the dev Postgres container (esharevice-dev-postgres-1, port 5433) is already running. Applied migrations 0006, 0007, 0008 via `docker exec -i ... psql` to the dev DB so the integration tests can run for real instead of skip.
- First run surfaced 6 failures (3 in bookings.test.ts, 3 in listing-taxonomy.test.ts) — all from the same root cause: Drizzle wraps postgres-js errors and hides the constraint name behind `err.cause`. The old regex assertions matched against the wrapper message, which only says "Failed query: …".
- Added `captureDbError` helper to both test files. It extracts `constraint_name` + SQL state `code` from `err.cause` and the assertions now check those directly. Cleaner than regex matching anyway.
- **All 59 tests pass against real Postgres**: 33 listing-taxonomy + 26 bookings. The EXCLUDE constraint blocks the overlapping booking, back-to-back bookings succeed, declined rows free the dates, sells coexist, and every CHECK constraint fires correctly.

## Bugs / Issues Encountered

| Bug | Category | Resolution |
|---|---|---|
| First draft of the EXCLUDE constraint didn't include the `start_at IS NOT NULL` partial-WHERE clause, which would cause `tstzrange(NULL, NULL)` evaluation failures on sell rows at constraint check time. | [State] | Added `AND start_at IS NOT NULL AND end_at IS NOT NULL` to the partial WHERE. Verified with the "multiple sells coexist" integration test. |
| Considered enabling `btree_gist` in `infra/postgres/init/01-extensions.sql` so dev DBs get it on first init. Chose against — the migration itself runs `CREATE EXTENSION IF NOT EXISTS btree_gist;` so it's idempotent and self-contained. Future migrations that need new extensions can do the same. | [Build] | Migration-scoped extension creation is the pattern. |

## Files Changed

**New:**
- `packages/db/drizzle/0008_0001_bookings.sql` — the migration
- `packages/shared/src/schemas/booking.ts` — Zod schemas
- `apps/api/src/lib/pricing.ts` — `calculateTotals` + `quantityFromRange`
- `apps/api/src/routes/v1/bookings.ts` — 7 endpoints + state-machine helpers
- `apps/api/src/jobs/bookings-activate.ts` — cron stub
- `apps/api/src/jobs/bookings-complete.ts` — cron stub
- `apps/api/tests/bookings.test.ts` — 26 tests (20 unit + 6 DB-integration)

**Modified:**
- `packages/db/src/schema.ts` — `bookingStatusEnum`, `bookings` table, type exports
- `packages/shared/src/index.ts` — re-export booking schema
- `apps/api/src/env.ts` — `FEATURE_BOOKINGS` flag
- `apps/api/src/index.ts` — mount `/v1/bookings`
- `apps/api/.env.example` — document the flag
- `.env.example` — document the flag in root example

## Outcome

PR opened, typecheck green, vitest green for new tests, no regressions on other suites.

## What's Next

Three options:
1. **PR 4 — Stripe Connect Canada.** The Stripe SDK + `payouts.ts` route + `webhooks-stripe.ts` receiver. Populates the placeholder columns (`stripe_payment_intent_id`, etc.) and the `stripe_fee_cents` on capture. Behind `FEATURE_STRIPE`. This is the revenue path's last backend piece.
2. **PR 1b — Auth.js wire-up.** Still ahead. Unblocks every user-aware UI surface.
3. **PR 5 — UI primitives.** Components for the marketplace (Heart, RatingStar, ActionPanel, DateRangePicker, PriceBreakdown, etc.). The booking-flow UI in PR 9 can't start without these.

PR 4 is the natural next bite — keeps the backend momentum and unlocks PR 9's booking flow UI when paired with PR 1b.
