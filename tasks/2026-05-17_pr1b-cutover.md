# Task: Auth.js Cutover (Phase 2)

**Created:** 2026-05-17 06:35 UTC
**Last Updated:** 2026-05-17 06:35 UTC
**Status:** Complete — shipped as `feat/pr1b-cutover`

## Objective

Phase 2 of the three-phase Authentik → Auth.js migration ([runbook](../docs/features/2026-05-17_authjs-migration.md)). PR 1b mounted Auth.js alongside Authentik; this PR flips the user-facing CTAs to the new `/login` page and updates the server-side `auth()` wrapper to prefer Auth.js sessions while falling back to Authentik. Existing Authentik sessions continue working through their full 30-day lifetime.

Phase 3 (Authentik teardown — container removal, legacy code deletion) follows after a 7-day overlap window with no Authentik traffic.

## Clarifying Questions & Answers

| Question | Answer |
|---|---|
| Touch the API verifier? | No. The API's dual-issuer JWKS verifier already accepts both `OIDC_ISSUER` (Authentik) and `AUTHJS_ISSUER` (Auth.js). The cutover is purely web-side. |
| Delete the legacy `/api/auth/*` route handlers? | No. They stay live for the migration window so existing Authentik sessions can refresh + log out via the same URLs the legacy middleware expects. Phase 3 deletes them. |
| Rename `return_to` to `callbackUrl` in all callers? | No churn. /login accepts both as aliases (callbackUrl wins when both present). Cleaner diff. |
| Update Google OAuth redirect URI in Cloud Console? | Operator action — not in this PR. Adds `http://localhost:3000/api/authjs/callback/google` (dev) and `https://esharevice.com/api/authjs/callback/google` (prod) to the authorized redirect URIs list. The legacy Authentik redirect URI stays alongside until Phase 3. |

## Plan

1. Cut `feat/pr1b-cutover` from `main`.
2. Audit every `/api/auth/login` caller in `apps/web/**/*.{ts,tsx}` — 7 callers found.
3. Update `apps/web/lib/auth.ts::auth()`:
   - Try `NextAuth.auth()` first; if a session exists, return `{ sub, access_token }` built from `session.user.id` + `session.accessToken`.
   - Fall back to the legacy `readSession()` + `readAccessToken()` path.
   - `requireAuth` redirects to `/login` instead of `/api/auth/login`, using `callbackUrl` query param.
4. Update `apps/web/app/login/page.tsx` to accept `return_to` as an alias for `callbackUrl` (callbackUrl wins when both present) — keeps legacy callers' query-param shape working without rewrite.
5. Sweep 7 callsites: header.tsx (2 links), items/[id]/page.tsx (1 link), 4 server actions (message-owner, save, reserve, delete).
6. `pnpm typecheck` — clean.
7. Write task log + update master plan progress table.
8. Commit + push + open GitHub PR.
9. Tell user the exact Google Cloud Console redirect URIs to add.

## Edge Cases to Handle

- **Auth.js session exists but `session.accessToken` is undefined.** Brief window after sign-in before the `jwt` callback mints the access token. The wrapper falls through to the Authentik path (which returns null) so the user gets bounced to /login again — a clean re-auth rather than rendering with no access_token.
- **Auth.js session AND Authentik session both present.** The user signed in via Auth.js but the legacy Authentik cookie is still alive (cookie expires in 30 days). The wrapper prefers Auth.js — the legacy path never runs because the early return fires first. Authentik cookie will expire naturally + be cleared by middleware's existing refresh-failure path.
- **Auth.js's `auth()` throws.** Defensive `.catch(() => null)` falls through to Authentik. Same behavior as a session-less anonymous request.
- **`return_to` alias on /login.** Legacy callers pass `?return_to=/items/123`; new callers pass `?callbackUrl=/items/123`. Both work. callbackUrl takes precedence when both are set. Documented in a header comment so future maintainers don't drop one of the two.
- **Legacy `/api/auth/*` routes still mounted.** Existing Authentik sessions can still refresh + log out via the legacy handlers. Phase 3 deletes them. Until then, the only `/api/auth/login` references in the codebase are JSDoc comments (no code paths).

## Progress Log

### 2026-05-17 06:30 UTC
- Merged PR 4 (Stripe) to main. Cut `feat/pr1b-cutover`.
- Audited callers — 7 source-code references to `/api/auth/login` outside of comments + .next build artifacts.

### 2026-05-17 06:33 UTC
- Updated `apps/web/lib/auth.ts`: Auth.js first, Authentik fallback. `requireAuth` redirects to `/login?callbackUrl=…`.
- Updated `apps/web/app/login/page.tsx`: `return_to` accepted as alias for `callbackUrl`.

### 2026-05-17 06:34 UTC
- Swept 7 callers. All now point at `/login?callbackUrl=…`.
- `pnpm typecheck` — clean across all 5 packages.

## Bugs / Issues Encountered

| Bug | Category | Resolution |
|---|---|---|
| n/a | — | Smooth cutover. Only the dual-session-resolution path in `auth()` required care; the rest was mechanical s/replace. |

## Files Changed

**Modified:**
- `apps/web/lib/auth.ts` — Auth.js-first wrapper, `/login` redirect target
- `apps/web/app/login/page.tsx` — `return_to` alias
- `apps/web/components/header.tsx` — 2 link updates
- `apps/web/app/items/[id]/page.tsx` — 1 link update
- `apps/web/app/items/[id]/message-owner-action.ts` — 1 redirect update
- `apps/web/app/items/[id]/save-action.ts` — 1 redirect update
- `apps/web/app/items/[id]/reserve-action.ts` — 1 redirect update
- `apps/web/app/items/[id]/edit/delete-action.ts` — 1 redirect update
- `tasks/2026-05-16_premium-marketplace-redesign-plan.md` — progress tracker

## Outcome

PR opened, typecheck green. After Google OAuth redirect URI is added in Cloud Console, the live flow at `/login` → Google → home is end-to-end functional. Existing Authentik sessions continue working — no user disruption.

## Operator Actions Required Before Live Test

1. **Google Cloud Console — add Auth.js redirect URIs to the OAuth 2.0 client:**
   - Open: https://console.cloud.google.com/apis/credentials
   - Pick the OAuth 2.0 client used by `AUTH_GOOGLE_ID`.
   - Add both to "Authorized redirect URIs":
     - `http://localhost:3000/api/authjs/callback/google` (dev)
     - `https://esharevice.com/api/authjs/callback/google` (prod)
   - **Keep the legacy Authentik URI alongside** until Phase 3.
2. Restart `pnpm --filter @esharevice/web dev` if it's running so it picks up the new code.
3. Visit `http://localhost:3000/login`, click "Continue with Google", complete the consent screen. You should land at `/` authenticated, with the cookie `esharevice_authjs_session` set.

## What's Next

- **Smoke-test the booking flow end-to-end** — log in via /login, hit `POST /v1/payouts/account` to provision your Stripe Connect account, finish Stripe Express onboarding (test mode), create a paid listing, then a booking.
- **Phase 3 (teardown).** After 7 days of clean Auth.js traffic (no remaining Authentik logins), delete the legacy routes + Authentik containers. See migration runbook for the full checklist.
