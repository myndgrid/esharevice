# Task: PR 2 — Listing Taxonomy Schema + API Extensions

**Created:** 2026-05-17 04:56 UTC
**Last Updated:** 2026-05-17 04:56 UTC
**Status:** Complete — shipped as `feat/pr2-listing-taxonomy`

## Objective

Second slice of the [2026-05-16 marketplace overhaul plan](2026-05-16_premium-marketplace-redesign-plan.md). Lands the **5-listing-type taxonomy** as additive schema + API surface — schema lives in prod, additive response fields ship to every client immediately, the dedicated `/v1/categories` endpoint stays 404 behind `FEATURE_LISTING_TYPES` until UI consumes it.

Independent of PR 1a (cut from `main`); when both PRs merge, the only overlap is a small `schema.ts` and `.env.example` diff that resolves cleanly (each PR adds to different tables / env sections).

## Clarifying Questions & Answers

Carried over from the session-level decisions (no new questions for PR 2):

| Question | Answer |
|---|---|
| Branch base? | `main` (parallel to PR 1a, not stacked) — keeps PR sizes small and reviews independent. |
| Where to put the `wants` field for trade listings? | Dual exposure: `exchange` (legacy) + `wants` (new) on the response shape. DB column stays `exchange`, now nullable. |
| Feature flag scope? | Gates only `/v1/categories`. Additive response fields ship unconditionally because old clients ignore unknown keys (forward-compat). |
| Backfill strategy? | None needed — `listing_type` defaults to `'trade'` so every legacy row stays a trade listing. Other new columns are nullable. |
| Hire pricing — allow `day`? | No. Per the plan, hire is `hour` or `fixed`; rentals get `day`. SQL CHECK + Zod superRefine both enforce. |
| `sell` allows `price_unit='hour'`? | No. Sell is a fixed total. `price_unit='fixed'` or omit it entirely. |

## Plan

1. Cut `feat/pr2-listing-taxonomy` from `main`.
2. Audit existing exchange-items route, Zod schemas, test patterns to understand the extension surface.
3. Write migration `0007_0001_listing_taxonomy.sql`:
   - Postgres enums: `listing_type`, `price_unit`, `item_condition`, `location_precision`.
   - New `categories` table with 40-row idempotent seed (`ON CONFLICT (slug) DO NOTHING`).
   - `exchange_items.exchange` flips nullable.
   - Add `listing_type` (default `'trade'`), `price_cents`, `price_unit`, `deposit_cents`, `condition`, `available_from/to`, `location_lat/lng/precision`, `category_id` FK.
   - SQL CHECK constraints: non-negative prices, lat/lng range, `available_to >= available_from`, and the load-bearing `exchange_items_paid_requires_price` (paid types ⇔ price_cents non-null).
   - Partial indexes on `listing_type`, `category_id`, `price_cents`, `(location_lat, location_lng)` — all `WHERE archived_at IS NULL`.
4. Mirror in Drizzle (`packages/db/src/schema.ts`): `pgEnum` exports, new `categories` table, all 12 new columns on `exchangeItems`.
5. Write Zod schemas:
   - `packages/shared/src/schemas/category.ts` — full `Category` + skinny `CategoryRef`.
   - Rewrite `exchange-item.ts` — extended `ExchangeItem` response shape (with `wants`, all new fields, plus `rating`/`distance_km`/`neighbourhood`/`neighbour_favourite` PR 9/5 stubs), type-discriminated `ExchangeItemCreate` with `superRefine`, immutable-listing_type `ExchangeItemUpdate`, extended `ExchangeItemListQuery` with new filters.
6. Add `FEATURE_LISTING_TYPES` env flag to `apps/api/src/env.ts`. Document in all `.env.example` files.
7. Extend `apps/api/src/routes/v1/exchange-items.ts`:
   - GET — accept new query params (`listing_type`, `category_slug`, `min_price_cents`, `max_price_cents`, `bbox`), join categories in one round-trip (`hydrateCategories`), populate every new response field.
   - POST — validate `category_id` FK upfront (400 not 500), store `wants ?? exchange` in `exchange` column, persist all type fields.
   - PUT — sparse update, `wants`/`exchange` alias on the column, listing_type rejected via the Zod schema's `.omit({listing_type})`.
   - Keep `PUT /reserve` alive (deprecated for 30 days until PR 3's bookings API lands).
8. Add `apps/api/src/routes/v1/categories.ts` — `GET /v1/categories` with `Cache-Control: max-age=86400`, flag-gated 404.
9. Mount the new route in `apps/api/src/index.ts`.
10. Write integration tests (`apps/api/tests/listing-taxonomy.test.ts`):
    - Pure Zod `superRefine` matrix — every per-type rule, immutability, strict-mode unknown-key rejection, bbox + numeric coercion.
    - DB round-trip (skip-when-no-Postgres pattern): legacy-shape insert defaults to `trade`, rent insert with price + category FK, CHECK-constraint blocks for missing price / negative price / priced gift.
11. Pre-existing `apps/web/app/items/[id]/page.tsx` + `edit-item-form.tsx` need null-coalesce because `exchange` is nullable now.
12. `pnpm typecheck` + `pnpm exec vitest run tests/listing-taxonomy.test.ts` — both clean.
13. Commit + push + open PR.

## Edge Cases to Handle

- **`wants` vs `exchange` dual-name.** Plan renames the trade-listing "what you want" field from `exchange` to `wants` at the API layer but keeps the DB column. Implemented as: response exposes both (`exchange` populated for backward compat, `wants` non-null only for trade listings). Create/update accept either, store in `exchange`.
- **Legacy clients posting old body shape.** No `listing_type` field, no `wants` — just `provider/service/date/exchange/description/rate_type`. `listing_type` defaults to `'trade'` in the Zod schema, so legacy posts continue to work unchanged.
- **`exchange` nullable migration with NOT NULL existing data.** `ALTER TABLE … ALTER COLUMN exchange DROP NOT NULL` is strictly looser; existing non-null values stay non-null. No backfill needed.
- **`category_id` FK validation.** A POST referencing a non-existent category previously would 500 with an FK violation. Pre-check returns 400 with a clear message.
- **`location_lat`/`lng` are Drizzle `numeric` — return as strings.** The route converts via `Number(row.location_lat)` for the wire shape. Drizzle stores `numeric` as string in TS to preserve precision.
- **`bbox` query parsing.** Zod regex validates `minLng,minLat,maxLng,maxLat` shape upfront; the route splits + parses + injects 4 separate `gte/lte` conditions rather than a single SQL expression so Drizzle's parameter binding stays clean (avoids the `record vs uuid[]` ANY-cast pitfall the bug registry documents).
- **`exchange_items_paid_requires_price` CHECK.** Paid types must carry `price_cents`; gift/trade must NOT. SQL is the final word — Zod superRefine catches at the boundary, but the CHECK protects against direct SQL inserts (admin scripts, future cron, manual fixes).
- **`rating` / `distance_km` / `neighbourhood` / `neighbour_favourite` stubs.** PR 9 (reviews) and PR 5/6 (geo) populate these. Shipping the response shape now means web components can wire UI against the final response from PR 2 onward; old clients see `null` / `false` and render nothing.
- **`hire` with `price_unit='day'`.** Plan explicitly forbids — hire is per-hour or per-fixed-job, not per-day (use `rent` for daily). Tested.
- **`sell` with `price_unit='hour'`.** Same — sell is a fixed total, not a rate. Tested.
- **Date sanity.** `available_to >= available_from` enforced both in SQL CHECK and Zod superRefine.

## Progress Log

### 2026-05-17 04:34 UTC
- User chose PR 2 over PR 1b as the next slice (safer, self-contained backend work).
- Cut `feat/pr2-listing-taxonomy` from `main`. Audited existing route + schemas + tests.

### 2026-05-17 04:38 UTC
- Wrote migration `0007_0001_listing_taxonomy.sql` — 4 enums, 40-row category seed, 12 new exchange_items columns, 5 CHECK constraints, 4 partial indexes.

### 2026-05-17 04:42 UTC
- Mirrored schema in Drizzle. Added `Category` + `CategoryRef` Zod, rewrote `ExchangeItemCreate` with the per-type `superRefine` rule set, made `ExchangeItemUpdate` reject `listing_type` via `.omit()`, extended `ExchangeItemListQuery` with new filters.

### 2026-05-17 04:46 UTC
- Added `FEATURE_LISTING_TYPES` env flag. Documented in `.env.example` files.
- Rewrote `apps/api/src/routes/v1/exchange-items.ts` with `hydrateCategories` helper for the one-round-trip join, new query param plumbing, bbox parser, `wants`/`exchange` alias handling.
- Added `apps/api/src/routes/v1/categories.ts` (flag-gated 404, 24h cache header).

### 2026-05-17 04:50 UTC
- Wrote 33 tests in `apps/api/tests/listing-taxonomy.test.ts`. 28 pure unit + 5 DB-integration (skip-when-no-Postgres pattern).

### 2026-05-17 04:54 UTC
- First typecheck found two web-side null errors (`exchange` is now nullable). Fixed via null-coalesce on `edit-item-form.tsx` and conditional render on `items/[id]/page.tsx`.
- Second typecheck clean. All 5 packages pass.
- `vitest run tests/listing-taxonomy.test.ts` — 28 passed, 5 skipped.

## Bugs / Issues Encountered

| Bug | Category | Resolution |
|---|---|---|
| `apps/web` typecheck failed because `item.exchange` became `string \| null`. Two callsites: `<input defaultValue={item.exchange} />` and `<Pair value={item.exchange} />`. | [Type] | Null-coalesce the input default, conditional-render the Pair (a non-trade listing shouldn't show an "Exchange for" row at all). |
| Drizzle `numeric` columns round-trip as strings in TS. Direct `Number()` cast at the wire boundary loses no precision since lat/lng cap at 9 digits total. | [Type] | Explicit `Number(row.location_lat)` in `toApiItem`. Documented in the column comment. |
| `sharp-pipeline.test.ts` fails because it imports the env-validating module directly without setting required env vars. | [Build] | Pre-existing on `main` — NOT introduced by this PR. Captured here so the next person doesn't blame PR 2. Fix is a separate concern (set NODE_ENV=test + minimal env in vitest setup). |

## Files Changed

**New:**
- `packages/db/drizzle/0007_0001_listing_taxonomy.sql` — the migration
- `packages/shared/src/schemas/category.ts` — Category + CategoryRef Zod
- `apps/api/src/routes/v1/categories.ts` — `GET /v1/categories` (flag-gated)
- `apps/api/tests/listing-taxonomy.test.ts` — 33 tests

**Modified:**
- `packages/db/src/schema.ts` — pgEnums, categories table, 12 new exchangeItems columns
- `packages/shared/src/schemas/exchange-item.ts` — full rewrite with type-discriminated body
- `packages/shared/src/index.ts` — re-export category schema
- `apps/api/src/env.ts` — `FEATURE_LISTING_TYPES` flag
- `apps/api/src/index.ts` — mount `/v1/categories`
- `apps/api/src/routes/v1/exchange-items.ts` — extended response + new query params + type-discriminated body
- `apps/api/.env.example` — document the flag
- `.env.example` — document the flag in the root example
- `apps/web/app/items/[id]/page.tsx` — null-safe `exchange` render
- `apps/web/app/items/[id]/edit/edit-item-form.tsx` — null-coalesce `exchange` default

## Outcome

PR opened, typecheck green, listing-taxonomy.test.ts green (28 unit tests pass, 5 DB tests skip without local Postgres).

## Master Plan Progress Update — Deferred

Master plan (`tasks/2026-05-16_premium-marketplace-redesign-plan.md`) lives on `feat/pr1a-visual-foundation` and isn't on this branch's tree. The Progress table update for PR 2 will land as a doc-only commit after both PR 1a and PR 2 merge to `main` — keeps the merge clean and the table accurate.

## What's Next

PR 3 — schema 0008 bookings (with `EXCLUDE USING gist` no-overlap constraint) + bookings API + pricing helpers + activate/complete cron jobs. Backend-only, behind `FEATURE_BOOKINGS`. Cut from `main` (parallel to PR 1a + PR 2 + PR 1b).

Or PR 1b — Auth.js wire-up — if the user wants the auth swap behind them before more feature work.
