# Feature: Email owner on item reservation

**Created:** 2026-05-16 06:30 UTC
**Last Updated:** 2026-05-16 06:30 UTC
**Status:** Live. Production VPS has `RESEND_API_KEY` + `EMAIL_FROM=e-Sharevice <noreply@esharevice.com>` set. Domain `esharevice.com` is verified on Resend (was already in use for Authentik password-reset emails).

When a user reserves an item, the owner gets an email saying so. First piece of transactional email from the app itself (Authentik already sends password-reset / verification emails on its own SMTP wiring).

## Routes / Modules

| File | Role |
|---|---|
| [apps/api/src/lib/email.ts](../../apps/api/src/lib/email.ts) | Lazy Resend client + `sendReservedEmail({ to, ownerName, reserverName, itemService, itemUrl })`. Never throws — all failures logged + reported to Sentry. |
| [apps/api/src/routes/v1/exchange-items.ts](../../apps/api/src/routes/v1/exchange-items.ts) | Reserve handler now looks up the owner's email + name from `users` after the race-safe UPDATE succeeds and fires the email **fire-and-forget**. The 200 response to the reserver is never delayed by an email round-trip. |
| [apps/api/src/env.ts](../../apps/api/src/env.ts) | Optional `RESEND_API_KEY`, `EMAIL_FROM`, `WEB_PUBLIC_URL`. `emailConfigured()` helper. Empty-string → undefined transforms (same pattern as R2 vars). |
| [infra/docker-compose.yml](../../infra/docker-compose.yml) | Threads the three env vars into the api service with empty defaults + `${DOMAIN}`-based fallback for `WEB_PUBLIC_URL`. |

## Edge Cases & Gotchas

- **Domain must be verified on Resend BEFORE this works.** Captured in the bug registry (`[Environment] Outbound Transactional Email Requires Domain Verification`). Until verification, Resend returns `403 validation_error`; the helper logs + Sentry-captures and the reserve itself still returns 200.
- **Fire-and-forget pattern.** The reserve handler wraps the email send in `void (async () => { ... })()` so a slow Resend round-trip can't delay the user's response. Errors inside the IIFE are swallowed at two layers: `sendReservedEmail` itself never throws, and the IIFE also has a try/catch. The handler returns the 200 the moment the SQL UPDATE commits.
- **Idempotency interplay.** The reserve route's idempotency middleware caches 2xx responses; a replay returns the cached response WITHOUT re-running the handler — so a flaky-network retry doesn't trigger a duplicate email. Natural property of the existing idempotency design.
- **WEB_PUBLIC_URL fallback.** The compose default is `https://${DOMAIN}`. If unset, the helper falls back to deriving from `OIDC_ISSUER` (strip the `/application/o/<slug>/` suffix). Worst case: the email link goes to `auth.esharevice.com` instead of `esharevice.com` — still recoverable, never broken.
- **Why text + HTML both?** Plain-text body is the fallback for clients that don't render HTML (or rule out HTML for security). The HTML body is intentionally minimal — no external CSS, no images — so it renders consistently across Gmail / Outlook / Apple Mail without bespoke per-client hacks. HTML user-controlled values (provider + service names) are manually escaped since we don't pull in a templating lib for one email.
- **Owner lookup happens AFTER the UPDATE.** Rationale: the UPDATE is the source of truth ("did the reservation actually succeed?"). If we read the owner BEFORE the UPDATE and the race-safe WHERE clause loses, we'd be sending an email for a reservation that never happened. Post-update read pulls fresh data.

## Environment Variables Required

| Variable | Notes |
|---|---|
| `RESEND_API_KEY` | Send-only API key from resend.com/api-keys |
| `EMAIL_FROM` | FROM address — must be on a verified domain. Recommended: `e-Sharevice <noreply@your-domain.com>` (display name + address) |
| `WEB_PUBLIC_URL` | Public URL for link building. Optional; compose defaults to `https://${DOMAIN}` |

## Changelog

| Date | Change |
|---|---|
| 2026-05-16 06:30 UTC | Initial documentation; live with `noreply@esharevice.com` (verified) on production. |
