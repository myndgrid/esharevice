# Feature: Email owner on item reservation

**Created:** 2026-05-16 06:30 UTC
**Last Updated:** 2026-05-16 07:00 UTC
**Status:** Live. Three email triggers wired:
1. Owner of an item gets notified when it's reserved (the original slice).
2. Everyone who saved the item gets notified when it's reserved by someone else.
3. Everyone who saved the item gets notified when the owner archives the listing.

Production VPS has `RESEND_API_KEY` + `EMAIL_FROM=e-Sharevice <noreply@esharevice.com>` set. Domain `esharevice.com` is verified on Resend (was already in use for Authentik password-reset emails).

## Routes / Modules

| File | Role |
|---|---|
| [apps/api/src/lib/email.ts](../../apps/api/src/lib/email.ts) | Lazy Resend client + three exported helpers (`sendReservedEmail`, `sendItemReservedEmailToSaver`, `sendItemArchivedEmailToSaver`) on a shared `sendTransactional` core. Every helper is non-throwing — all failures logged + reported to Sentry. |
| [apps/api/src/lib/saves-recipients.ts](../../apps/api/src/lib/saves-recipients.ts) | `getSaversToNotify(itemId, excludeUserIds)` — joins `exchange_item_saves` with `users` for everyone who bookmarked `itemId` minus the actors who already know. `recipientDisplayName` builds the friendly greeting. |
| [apps/api/src/routes/v1/exchange-items.ts](../../apps/api/src/routes/v1/exchange-items.ts) | Reserve handler fires the owner email and then fans out to savers (`exclude=[reserver, owner]`). DELETE handler fans out to savers (`exclude=[owner]`) only on the first archive (re-DELETE is a no-op, no re-spam). All sends happen inside a `void (async () => { ... })()` so the 2xx response to the actor is never delayed. |
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

## Saver fan-out details

- **Recipient set on reserve:** `getSaversToNotify(itemId, [reserverId, ownerId])`. The reserver is the actor; the owner gets the primary reserved-email already. Anyone else who saved the item gets one notification.
- **Recipient set on archive:** `getSaversToNotify(itemId, [ownerId])`. The owner is archiving their own listing; everyone else who saved it learns the listing is gone.
- **No batching.** The send is a `for ... of savers` loop, one email per recipient. Each call is awaited inside the IIFE but the IIFE itself isn't awaited by the handler. Total wall-time scales linearly with saves count; for an item with N savers, the IIFE finishes well after the handler's response. Bound: we expect single-digit savers per item for the foreseeable future. If saves explode for a viral listing, switch to a Redis/BullMQ queue worker.
- **Deduplication.** `notInArray` on the user_id excludes the actors. No risk of double-emailing a user who's both the reserver and a saver of their own item (edge case, but the exclusion handles it).
- **No CTA on the archive email.** The listing is gone — no link to show. The text body says so and points the user back to the home page.

## Changelog

| Date | Change |
|---|---|
| 2026-05-16 06:30 UTC | Initial documentation; live with `noreply@esharevice.com` (verified) on production. Owner email on reserve. |
| 2026-05-16 07:00 UTC | Saver fan-out — savers get notified on reserve (by someone other than themselves) and on archive (by the owner). Reserve handler now sends owner email + savers loop; DELETE handler fires the savers loop on first archive only. |
