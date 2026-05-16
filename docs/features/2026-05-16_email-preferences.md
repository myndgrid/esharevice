# Feature: Email preferences + unsubscribe footer

**Created:** 2026-05-16 15:45 UTC
**Last Updated:** 2026-05-16 15:45 UTC
**Status:** Live. Every transactional email now carries an unsubscribe footer + `List-Unsubscribe` header; each send is gated on a per-category preference column on `users`; recipients can flip a single category via the public confirm page reached by the email link, or manage all three from `/settings/notifications` when signed in.

## Overview

Three transactional-email paths were already live (reserve owner email, saved-item-changed email to bookmarkers, new-message email between conversation participants). Until this feature, recipients had no way to opt out short of asking us to suppress their address — compliance-adjacent gap plus a real annoyance for anyone who wanted in-app updates but no email.

This change adds three independent toggles, an opaque per-user unsubscribe token embedded in every email link, a confirmation page that prevents accidental unsubscribes from link previews / scanners, and a signed-in preferences page.

## Routes / API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/me/email-prefs` | Bearer | Returns `{ new_message, reserved, saved_item_changed }` — all booleans. |
| PATCH | `/v1/me/email-prefs` | Bearer | Partial-update body. Only present keys are written; returns the resulting full state. |
| POST | `/v1/email/unsubscribe` | Public (token) | Body `{ token, category }`. Looks up the user by `users.email_token`, flips the matching `email_<category>_enabled` column to false. 204 on success; 404 if the token isn't recognised (intentionally indistinct from "wrong token shape"). RFC 8058 one-click POST (`List-Unsubscribe-Post: List-Unsubscribe=One-Click`) is intentionally not supported yet — easy to add by relaxing the route + adding the header. |

## Web routes

| Path | Auth | Description |
|---|---|---|
| `/unsubscribe?token=<uuid>&c=<category>` | Public | Renders a confirmation card with a `<form>` whose submit is a server action that POSTs to `/v1/email/unsubscribe`. Never flips state on GET — link previews + security scanners + browser prefetch would otherwise unsubscribe users by accident. On bad token shape OR bad category, renders an "Invalid unsubscribe link" card. |
| `/settings/notifications` | Auth | Three independent toggle-forms. Each submit is a server action that PATCHes `/v1/me/email-prefs` with a fixed `{ [category]: <new bool> }` payload — pure write, not a flip, so retrying is idempotent. |

## Modules / Classes Involved

| File | Role |
|---|---|
| [packages/db/drizzle/0005_0001_user_email_prefs.sql](../../packages/db/drizzle/0005_0001_user_email_prefs.sql) | Adds `email_token uuid` + three booleans to `users`. Unique index on `email_token`. |
| [packages/db/src/schema.ts](../../packages/db/src/schema.ts) | Drizzle schema additions matching the migration. |
| [packages/shared/src/schemas/email-prefs.ts](../../packages/shared/src/schemas/email-prefs.ts) | `EmailPrefs` + `EmailPrefsUpdate` + `EmailCategoryEnum` Zod schemas. |
| [apps/api/src/lib/email.ts](../../apps/api/src/lib/email.ts) | All four send helpers refactored: each takes `recipientId`, does its own user lookup (email + name + prefs + token in one query), gates on `email_<category>_enabled`, appends text + HTML unsubscribe footer, sets `List-Unsubscribe` header. |
| [apps/api/src/lib/saves-recipients.ts](../../apps/api/src/lib/saves-recipients.ts) | `getSaversToNotify` now returns just `{ user_id }[]` (down from full SaverRecipient) — name + email resolution moved into the email helper. |
| [apps/api/src/routes/v1/me.ts](../../apps/api/src/routes/v1/me.ts) | GET + PATCH `/v1/me/email-prefs`. |
| [apps/api/src/routes/v1/email-unsubscribe.ts](../../apps/api/src/routes/v1/email-unsubscribe.ts) | Public POST `/v1/email/unsubscribe`. |
| [apps/web/lib/api.ts](../../apps/web/lib/api.ts) | `getEmailPrefs` + `updateEmailPrefs` + `unsubscribeEmail` client methods. PATCH method now valid on the internal `Options` shape. |
| [apps/web/app/unsubscribe/page.tsx](../../apps/web/app/unsubscribe/page.tsx) | Public confirm page. |
| [apps/web/app/unsubscribe/actions.ts](../../apps/web/app/unsubscribe/actions.ts) | Server action that POSTs to the API and redirects with `?ok=1` or `?err=1`. |
| [apps/web/app/settings/notifications/page.tsx](../../apps/web/app/settings/notifications/page.tsx) | Preferences page (auth required). |
| [apps/web/app/settings/notifications/actions.ts](../../apps/web/app/settings/notifications/actions.ts) | Server action wrapping `api.updateEmailPrefs` + `revalidatePath`. |

## Persistence (tables touched)

- **`users` (additive — migration 0005):**
  - `email_token uuid NOT NULL DEFAULT gen_random_uuid()` — opaque per-user capability embedded in every unsubscribe link. Non-enumerable. `pgcrypto.gen_random_uuid()` is already enabled by the initial migration. Unique index `users_email_token_uq`.
  - `email_new_message_enabled boolean NOT NULL DEFAULT true`
  - `email_reserved_enabled boolean NOT NULL DEFAULT true`
  - `email_saved_item_changed_enabled boolean NOT NULL DEFAULT true`
- All four columns are backfilled by the `DEFAULT` clause for existing rows, so today's "everything enabled" behaviour is preserved for current users.

## Edge Cases & Gotchas

- **GET vs POST on unsubscribe.** Browsers, link previews, virus scanners, and email-security pre-checkers all hit links in transactional emails before the user does. Any GET endpoint with side effects gets called by them. We render a confirmation page on GET (no DB writes) and only flip the column on POST via the form submit. RFC 8058 one-click POST is intentionally deferred — would require a Gmail/iOS-specific `List-Unsubscribe-Post` header + a token-only body — easy to add when we're sending enough volume to qualify for the bulk-sender requirements.
- **Token rotation.** Today the `email_token` is set once at row creation and never rotated. If a user wants to invalidate previously-sent unsubscribe links (e.g. they shared an email widely), a follow-up endpoint can do `UPDATE users SET email_token = gen_random_uuid() WHERE id = ?`. Not wired yet.
- **404 vs 401 on bad tokens.** The public POST returns 404 (not 401/403) on an unknown token. This is deliberate — confirming "the shape is right but the token isn't live" leaks the existence of a token format to anyone fishing. From outside the system, every wrong attempt is just "Token not recognised".
- **Helper signature change is a breaking API contract for callers.** All four send helpers used to take pre-resolved `to: string` + name fields; they now take `recipientId: string` and do their own lookup. Two call sites updated (`exchange-items.ts` reserve + archive, `conversations.ts` new-message). `getSaversToNotify` return shape narrowed to `{ user_id }[]` — the only consumer was the loop that fans out saver emails.
- **Active-view suppression remains layered on top of the preference gate.** The new-message helper still does the per-conversation `last_read_at` suppression check; the helper-level pref check is additional. Both need to pass for the email to actually go out.
- **`List-Unsubscribe` header format.** Header value is `<https://...>` — RFC 2369 angle brackets are mandatory. Most mail clients (Gmail, Apple Mail, iOS Mail, Outlook) will surface this as a one-click "Unsubscribe" link in their chrome.
- **Default for new users.** All three prefs default `true` so first-time users get every transactional email. If we later add an explicit onboarding step that asks, the toggles map directly to the PATCH endpoint.

## Environment Variables Required

None new. The unsubscribe URL is built from `WEB_PUBLIC_URL` (already present) with `OIDC_ISSUER`-origin fallback.

## Changelog

| Date | Change |
|---|---|
| 2026-05-16 15:45 UTC | Initial documentation; shipped as commits `e0d63b6` (API) + `1ac0572` (web). Migration 0005 applied to production Postgres. API image `sha256:5f70019a…`; web image `sha256:6085728f…`. |
