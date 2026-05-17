# Task: PR 4 — Stripe Connect Canada

**Created:** 2026-05-17 06:10 UTC
**Last Updated:** 2026-05-17 06:10 UTC
**Status:** Complete — shipped as `feat/pr4-stripe-connect`

## Objective

Wire Stripe Connect Canada into the marketplace. Completes the revenue backend: providers onboard via Stripe Express, renters pay through Stripe Elements (PR 9 UI), funds split at capture time via `transfer_data.destination`, refunds reverse the transfer. All gated behind `FEATURE_STRIPE` so the feature can ride in prod without exposing until UI is ready (PR 9–11).

Independent of PR 1b. Cut from `main` after PRs 1a + 2 + 3 merged. PR 1b's Auth.js code is on its own branch and doesn't intersect here.

## Clarifying Questions & Answers

| Question | Answer |
|---|---|
| Escrow vs instant transfer? | **Instant transfer at capture** via `transfer_data.destination`. Simpler money flow, Stripe handles the routing. "24h release window" becomes a UI/dispute concept, not a money-flow concept. Disputes (PR 10) get their own table + separate refund logic. |
| Currency? | CAD only at v1. Multi-currency post-launch. |
| Account type? | Express (Stripe-hosted onboarding). Standard would require providers to have their own Stripe accounts; Express is the Connect best-practice for marketplaces. |
| Manual or automatic capture? | Manual. The provider's accept call triggers capture. Decline cancels the auth (no refund visible on renter's statement). |
| Application fee? | Per the plan: 10% rent + sell, 12% hire. Already encoded in `apps/api/src/lib/pricing.ts` from PR 3. PR 4 passes `application_fee_amount` to the PaymentIntent. |
| Webhook events to handle? | `account.updated`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`. PR 10/12 add disputes + subscriptions. |
| Test keys location? | `.env.creds` (gitignored). The build env-gates so absence is OK during development. |

## Plan

1. Cut `feat/pr4-stripe-connect` from `main`. Confirm no Stripe keys in `.env.creds` — gate behind env presence.
2. Migration `0009_0001_stripe_connect.sql`:
   - `stripe_account_status` enum (pending/restricted/active/rejected).
   - `stripe_accounts` table — one per provider, UNIQUE on user_id + account_id, mirror of Stripe's capability state.
   - `stripe_events` table — PK on event_id for webhook idempotency.
3. Mirror in Drizzle (`packages/db/src/schema.ts`).
4. Zod schemas (`packages/shared/src/schemas/stripe.ts`): `StripeAccountStatus`, `PayoutAccount`, `PayoutAccountLink`. Plus `BookingCreateResponse` extension in `booking.ts`.
5. Install `stripe` SDK in `apps/api`.
6. Add `FEATURE_STRIPE`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_ACCOUNT_COUNTRY` to `apps/api/src/env.ts`.
7. Write `apps/api/src/lib/stripe.ts`:
   - `stripeConfigured()` + lazy `getStripe()` singleton.
   - `createExpressAccount` + `createAccountOnboardingLink`.
   - `createBookingPaymentIntent` with manual capture + transfer_data + application_fee + idempotency-key.
   - `capturePaymentIntent`, `cancelPaymentIntent`, `refundPaymentIntent` (with `refund_application_fee` + `reverse_transfer`).
   - `constructWebhookEvent` for signature verification.
8. Write `apps/api/src/routes/v1/payouts.ts`:
   - `POST /v1/payouts/account` — lazy-create the Express account + return onboarding link.
   - `GET /v1/payouts/status` — read the mirror row.
9. Write `apps/api/src/routes/v1/webhooks-stripe.ts`:
   - Signature-verify raw body BEFORE any work.
   - Idempotency via `stripe_events` PK insert.
   - Dispatch by event type → handler functions. ALWAYS 200 on signature-valid events (Stripe retries on non-2xx for 3 days).
   - Mounted as a non-OpenAPI route (`route.post()`) to keep `c.req.text()` access to the raw body.
10. Wire Stripe into `bookings.ts`:
    - POST creates PaymentIntent after the DB insert (EXCLUDE protects first). Provider must have `status='active'` Stripe account; if not, roll back the booking + 400. Return `{ booking, client_secret }`.
    - Accept captures the intent (best-effort; webhook reconciles).
    - Decline cancels the intent (best-effort).
    - Cancel issues a refund (post-confirmed) or a void (pre-capture); branch on `priorStatus`.
11. Mount `/v1/payouts` + `/v1/webhooks/stripe` in `apps/api/src/index.ts`.
12. Document env vars in all three `.env.example` files.
13. Apply migration to dev DB. Run all tests against real Postgres.
14. Write Stripe Connect tests (`apps/api/tests/stripe.test.ts`): Zod schemas + DB UNIQUE constraints + event idempotency PK.
15. Write feature doc + task log + update master plan.
16. Commit + push + open PR.

## Edge Cases to Handle

- **Booking insert FIRST, Stripe call SECOND.** The EXCLUDE constraint catches double-bookings before any money moves. If the Stripe call fails after the DB insert, the booking row is deleted (rolled back) before the route returns. Avoids the "phantom booking with no payment intent" state.
- **Provider's Stripe account isn't `active` yet.** If a renter tries to book against a provider who hasn't finished Stripe onboarding, the booking is rolled back + 400 with a clear message. The provider gets nudged to finish onboarding via the payouts UI (PR 11).
- **Stripe API call fails mid-flight.** Booking is in `'requested'` state with `stripe_payment_intent_id = null`; the route returns 502. The renter retries; idempotency-key on the booking-create middleware short-circuits if the request signature matches. If different, they get a new booking attempt.
- **Webhook signature verification fails.** 400 immediately — no body read, no DB write. Sentry-eligible (real attacker probing or misconfigured webhook secret).
- **Duplicate webhook delivery.** `stripe_events` PK on event_id rejects the second INSERT with `23505`; handler short-circuits + returns 200 with `{duplicate: true}`. Stripe stops retrying.
- **Webhook handler fails downstream.** Booking row update fails, etc. Handler logs + Sentry-captures, sets `processed=false` + `error_detail` on the event row, returns 200. Stripe doesn't retry; operator retries via Stripe dashboard once the underlying issue is fixed.
- **Webhook arrives out of order.** Every handler is self-idempotent — checks current DB state before writing. E.g. `payment_intent.canceled` arriving before the route handler's own `transition()` call is harmless; both result in `status='declined'`.
- **Provider account terminated by Stripe.** `account.updated` webhook fires with `requirements.disabled_reason` containing `rejected|listed|terms_of_service`. We map to status='rejected'. Existing bookings on the account need manual cleanup; not automated in PR 4.
- **Cancellation refund: pre- vs post-capture.** The route branches on `priorStatus`. Pre-capture (status was 'requested'): `cancelPaymentIntent` (void the auth). Post-capture (status was 'confirmed'): `refundPaymentIntent` with `refund_application_fee` + `reverse_transfer` (full refund + reverse the Stripe-side fee + reverse the transfer to the provider's account).
- **Application fee is OUR take, not Stripe's processing fee.** The 10%/12% platform fee in the PaymentIntent's `application_fee_amount` field is what the platform retains. Stripe's actual processing fee (2.9% + $0.30 CAD per charge) comes out of the application fee at settlement — we never see it in our DB until the `charge.refunded` or settlement webhook reports it. PR 4 stores `stripe_fee_cents` as nullable; later PRs can populate from the webhook.
- **CAD-only at v1.** PayoutAccount Zod schema has `currency: z.literal("CAD")`. Multi-currency would require additional Stripe accounts per merchant country.

## Progress Log

### 2026-05-17 05:55 UTC
- Merged PRs 1a + 2 + 3 to main. Cut `feat/pr4-stripe-connect`.
- User asked for Stripe-key acquisition steps; documented the 6-step Stripe Dashboard walkthrough (test mode, secret/publishable keys, Connect platform setup, webhook signing secret via `stripe listen`, Stripe Tax for CRA GST/HST).

### 2026-05-17 06:00 UTC
- Wrote migration 0009 — enum, two tables, indexes. Idempotent (`CREATE … IF NOT EXISTS`, `DO $$ BEGIN … EXCEPTION WHEN duplicate_object THEN NULL`).
- Mirrored in Drizzle. Added `BookingCreateResponse` to Zod for the `{ booking, client_secret }` POST shape.

### 2026-05-17 06:04 UTC
- Installed `stripe` SDK. Built `apps/api/src/lib/stripe.ts` with the full helper set + `stripeConfigured()` gate.
- Wrote `payouts.ts` (POST /account, GET /status) and `webhooks-stripe.ts` (signature verification + idempotency PK + dispatch table).

### 2026-05-17 06:08 UTC
- Wired Stripe into bookings.ts: POST creates PaymentIntent + returns client_secret; accept captures; decline cancels; cancel refunds or voids based on priorStatus.
- Mounted new routes in `apps/api/src/index.ts`.
- Documented env vars in all three .env.example files.
- pnpm typecheck — clean across 5 packages.

### 2026-05-17 06:10 UTC
- Applied migration 0009 to dev Postgres. Wrote `apps/api/tests/stripe.test.ts` — Zod schema tests + DB UNIQUE constraint tests + idempotency PK test (7 tests).
- DATABASE_URL=... pnpm exec vitest run — **66/66 pass** (33 listing-taxonomy + 26 bookings + 7 stripe), zero skips.

## Bugs / Issues Encountered

| Bug | Category | Resolution |
|---|---|---|
| First Stripe singleton had `apiVersion: "2025-02-24.acacia" as Stripe.LatestApiVersion` which forced a type cast that might break across SDK upgrades. | [Build] | Dropped explicit apiVersion — let SDK use its default. Pinning is the right call once we hit prod traffic; for v1 the SDK default is fine. |
| Initial response shape for POST /v1/items/:id/bookings returned just `Booking`; PR 9 UI needs the `client_secret` too. | [Type] | Added `BookingCreateResponse` Zod schema as a wrapper `{ booking, client_secret }`. POST returns this; all other endpoints still return `Booking` directly. Caller-facing change documented in the route description. |

## Files Changed

**New:**
- `packages/db/drizzle/0009_0001_stripe_connect.sql` — the migration
- `packages/shared/src/schemas/stripe.ts` — Zod schemas
- `apps/api/src/lib/stripe.ts` — SDK singleton + helpers
- `apps/api/src/routes/v1/payouts.ts` — provider onboarding endpoints
- `apps/api/src/routes/v1/webhooks-stripe.ts` — webhook receiver
- `apps/api/tests/stripe.test.ts` — 7 tests

**Modified:**
- `packages/db/src/schema.ts` — `stripeAccountStatusEnum`, `stripeAccounts`, `stripeEvents`, type exports
- `packages/shared/src/index.ts` — re-export stripe
- `packages/shared/src/schemas/booking.ts` — new `BookingCreateResponse`
- `apps/api/package.json` — `stripe` added
- `pnpm-lock.yaml`
- `apps/api/src/env.ts` — `FEATURE_STRIPE`, `STRIPE_*`
- `apps/api/src/index.ts` — mount new routes
- `apps/api/src/routes/v1/bookings.ts` — payment intent on create, capture on accept, cancel on decline, refund-or-void on cancel
- `apps/api/.env.example`, `.env.example` — Stripe env vars documented

## Outcome

PR opened, typecheck green, 66/66 tests pass against real Postgres.

## Next steps for the reviewer/operator

1. Drop test keys into `.env.creds`:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PUBLISHABLE_KEY=pk_test_...     # for PR 9
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```
2. Set `FEATURE_STRIPE=true` in `apps/api/.env`.
3. Run `stripe listen --forward-to localhost:8080/v1/webhooks/stripe` to forward webhooks locally.
4. Smoke-test:
   - `curl -X POST localhost:8080/v1/payouts/account -H "Authorization: Bearer …"` — should return an onboarding URL.
   - Visit the URL, complete Stripe's test-mode onboarding (use test SSN 000-00-0000, routing 110000000, account 000123456789).
   - `curl GET localhost:8080/v1/payouts/status` — should return `status: "active"` after onboarding completes (the `account.updated` webhook updates the mirror).
   - Create a paid listing (PR 2's API), then a booking via `POST /v1/items/:id/bookings`. Should return 201 with a `client_secret`.

## What's Next

Three options:
1. **PR 5 — UI primitives.** All the marketplace components (Heart, RatingStar, SearchPill, ActionPanel, DateRangePicker, PriceBreakdown, StripeElement wrapper). Frontend-only; no backend dependency. Unblocks PRs 6–11.
2. **Phase 2 cutover for Auth.js** — flip header CTAs to /login. Tiny PR. Requires Google OAuth redirect URI update in Cloud Console.
3. **Smoke-test PR 4 end-to-end with real Stripe** — drop test keys, run the live flow.
