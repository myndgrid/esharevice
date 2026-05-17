# Feature: Stripe Connect — Local Dev Runbook

**Created:** 2026-05-17 07:00 UTC
**Last Updated:** 2026-05-17 07:00 UTC
**Status:** Stable — used during PR 4's end-to-end smoke test.

## Overview

Operating notes for running the Stripe Connect Canada payment flow in local development. The first time we ran a real end-to-end smoke test, three sharp edges showed up that aren't obvious from the Stripe docs. This doc records them so the next dev (or future-you) doesn't rediscover them.

## Routes / API Endpoints

| Method | Path | Notes |
|---|---|---|
| `POST` | `/v1/payouts/account` | Lazy-create the caller's Stripe Connect Express account + return onboarding link. |
| `GET` | `/v1/payouts/status` | Read the cached mirror row (kept in sync via webhook). |
| `POST` | `/v1/webhooks/stripe` | Webhook receiver — signature-verified, idempotent via `stripe_events` PK. |

## Required env vars (apps/api/.env)

```
FEATURE_STRIPE=true                      # gates the routes + booking payment leg
FEATURE_BOOKINGS=true                    # gates POST /v1/items/:id/bookings (paired flag)
STRIPE_SECRET_KEY=sk_test_...            # from dashboard.stripe.com → Developers → API keys
STRIPE_WEBHOOK_SECRET=whsec_...          # from `stripe listen --print-secret` (dev) or dashboard
STRIPE_ACCOUNT_COUNTRY=CA                # country for newly-provisioned Express accounts
```

**Joint flag requirement:** `FEATURE_STRIPE` and `FEATURE_BOOKINGS` must BOTH be `true` for the live revenue path. See `apps/api/.env.example` for the full breakdown of half-state combinations.

## Local webhook forwarding — the sharp edge

Stripe Connect events on the *connected* account (e.g. `account.updated` for a provider's account) are NOT in the default forward set of `stripe listen`. The default forwards only **platform-level** events, which is enough for `payment_intent.*` (created by the platform on behalf of a connected account) but NOT for `account.updated`.

**Wrong** — misses `account.updated` from provider onboarding:
```bash
stripe listen --forward-to http://localhost:8080/v1/webhooks/stripe
```

**Right** — forwards both platform AND Connect events:
```bash
stripe listen \
  --forward-to http://localhost:8080/v1/webhooks/stripe \
  --forward-connect-to http://localhost:8080/v1/webhooks/stripe
```

The `stripe listen` command prints the same `whsec_…` value for both forwarders, so a single `STRIPE_WEBHOOK_SECRET` is sufficient.

**Diagnostic** when `account.updated` doesn't arrive after onboarding completion:
1. Confirm `payouts_enabled=true` via direct REST: `curl -u $SK: https://api.stripe.com/v1/accounts/acct_XXX`.
2. If yes, the event fired Stripe-side but our forwarder didn't catch it. Restart `stripe listen` with `--forward-connect-to`.
3. To unstick the mirror, see the reconcile pattern below.

## Reconciling the mirror after a missed webhook

Two paths.

**Manual SQL** (one-off, fastest):
```sql
UPDATE stripe_accounts
SET status='active', charges_enabled=true, payouts_enabled=true,
    details_submitted=true, updated_at=now()
WHERE account_id='acct_XXX';
```

**Re-deliver from Stripe** — find the event, resend through your active listener:

`stripe events resend` delivers to **configured dashboard webhook endpoints**, NOT to active `stripe listen` connections. So resending doesn't work for local dev. Either:
- a) Set up a real webhook endpoint in the Stripe dashboard pointing at an ngrok URL → `events resend` then works.
- b) Use the manual SQL reconcile above for local dev. (This is the documented dev pattern; future PRs may add a `/v1/payouts/account/refresh` endpoint that fetches live state from Stripe + updates the mirror in a single transaction.)

## Onboarding test-mode credentials (Canada)

Stripe Express tests reject obviously-fake values like all-zeros for some fields. Working set for Canada:

| Field | Value |
|---|---|
| Phone | Any number; SMS verification code = `000000` |
| Email | Your real one is fine; nothing is actually sent in test mode |
| Name | Any |
| DOB | Any (use ≥ 18) |
| Address | Any plausible Canadian address |
| Industry | Anything (e.g. "Software") |
| SIN / Tax ID | `000 000 000` (all zeros) |
| Bank account | Transit `11000`, Institution `000`, Account `000123456789` |

For the bank account, Stripe test mode accepts the canonical test routing/account numbers from their docs. The success flow ends with `charges_enabled=true` + `payouts_enabled=true` + `details_submitted=true` within seconds.

## End-to-end smoke-test recipe

```bash
# 1. Boot the API with FEATURE_STRIPE=true + FEATURE_BOOKINGS=true
pnpm --filter @esharevice/api dev

# 2. Boot the webhook forwarder (Connect events included)
stripe listen \
  --forward-to http://localhost:8080/v1/webhooks/stripe \
  --forward-connect-to http://localhost:8080/v1/webhooks/stripe

# 3. As an authenticated user (Auth.js Google sign-in via /login),
#    POST /v1/payouts/account → get onboarding URL → complete in browser.

# 4. After "Submitted" page redirects to /payouts/done, GET /v1/payouts/status
#    should return status='active'.
#    If still 'pending', the listener was missing --forward-connect-to. Restart
#    + run the manual SQL reconcile above.

# 5. Create a paid listing (POST /v1/exchange-items, listing_type=rent,
#    price_cents=4000, price_unit=day, deposit_cents=5000).

# 6. As a different authenticated user (renter), POST /v1/items/:id/bookings
#    with start_at + end_at. Response includes `booking` + `client_secret`.
#    Booking row's stripe_payment_intent_id matches Stripe's PaymentIntent.
```

## Modules / Classes Involved

| File | Role |
|---|---|
| `apps/api/src/lib/stripe.ts` | SDK singleton + helpers |
| `apps/api/src/routes/v1/payouts.ts` | `POST /account` + `GET /status` |
| `apps/api/src/routes/v1/webhooks-stripe.ts` | Webhook receiver (signature verify + idempotency PK) |
| `apps/api/src/routes/v1/bookings.ts` | Payment lifecycle wiring (create intent, capture, refund/void) |
| `apps/web/app/payouts/done/page.tsx` | Stripe return URL (placeholder) |
| `apps/web/app/payouts/setup/page.tsx` | Stripe refresh URL (placeholder; PR 11 builds the real dashboard) |

## Edge Cases & Gotchas

- **First `stripe accounts create` call may fail with "You can only create new accounts if you've signed up for Connect"** even though Connect IS enabled. This happened once during initial setup and never reproduced — likely a Stripe-side caching transient. Retry succeeds.
- **AccountLinks are short-lived (~5 min).** Refresh by calling `POST /v1/payouts/account` again — it's idempotent and returns a fresh link.
- **Stripe Connect Express in Canada** requires the platform's CRA Business Number for live mode. Test mode skips this.
- **Test-mode `stripe trigger` events** create fake accounts/intents in your Stripe dashboard. They're harmless but accumulate; clean up periodically via `stripe accounts delete acct_XXX` if they bother you.

## Environment Variables Required

See `apps/api/.env.example` for the canonical list. The minimum for a working dev setup:

```
DATABASE_URL=postgresql://esharevice:esharevice@localhost:5433/esharevice
REDIS_URL=redis://localhost:6379
OIDC_ISSUER=… OIDC_AUDIENCE=… OIDC_JWKS_URL=…   # for verifying Auth.js tokens
AUTHJS_ISSUER=http://localhost:3000
AUTHJS_JWKS_URL=http://localhost:3000/.well-known/jwks.json
AUTHJS_AUDIENCE=esharevice-api
FEATURE_BOOKINGS=true
FEATURE_STRIPE=true
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

## Changelog

| Date | Change |
|---|---|
| 2026-05-17 07:00 UTC | Initial documentation. Captures the `--forward-connect-to` + reconcile patterns discovered during PR 4's first end-to-end smoke test. |
