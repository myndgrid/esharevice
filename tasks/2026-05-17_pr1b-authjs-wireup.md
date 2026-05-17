# Task: PR 1b — Auth.js Wire-up (Google + Magic-Link)

**Created:** 2026-05-17 05:48 UTC
**Last Updated:** 2026-05-17 05:48 UTC
**Status:** Complete — shipped as `feat/pr1b-authjs-wireup`

## Objective

Land the deferred-from-PR-1a Auth.js wire-up. Auth.js mounts alongside the existing Authentik OIDC flow so both work during a 7-day migration window. New sign-ins can use either path; the Hono API verifies tokens from BOTH issuers via iss-routed JWKS resolution.

Phase 1 of three (this PR). Phase 2 = cutover (flip header links to `/login`). Phase 3 = teardown (delete Authentik containers + legacy code). Detailed runbook lives at [docs/features/2026-05-17_authjs-migration.md](../docs/features/2026-05-17_authjs-migration.md).

## Clarifying Questions & Answers

| Question | Answer |
|---|---|
| Providers in v1? | Google + Resend magic-link. Apple deferred (no Developer Program enrollment yet). Credentials deferred (no password-signup UI). |
| basePath for Auth.js? | `/api/authjs` (not the default `/api/auth`) so the existing Authentik routes keep working. |
| Cookie name? | `esharevice_authjs_session` (custom, distinct from Authentik's `esharevice_session`). |
| Session strategy? | JWT (default v5 without an adapter). Session cookie is JWE-encrypted symmetric (AUTH_SECRET). Separately, we mint RS256 access tokens for the API to verify. |
| Where does the access token come from? | Auth.js's `jwt` callback re-mints an RS256 JWT on every page load using `AUTH_JWT_PRIVATE_KEY`. The session callback exposes it on `session.accessToken` for server-side code. The JWKS endpoint serves the matching public key. |
| Touch the live auth path? | No. The `/api/auth/*` Authentik routes are unchanged. The header + login links still point there. Cutover is Phase 2. |
| Update Lighthouse CI script? | No, follow-up after cutover. The current script tests Authentik flow-executor; it's still valid. |

## Plan

1. Cut `feat/pr1b-authjs-wireup` from `main`.
2. Install `next-auth@beta` + `bcryptjs` + `@types/bcryptjs` in `apps/web`.
3. Write `apps/web/auth.ts` — Auth.js v5 config:
   - `basePath: "/api/authjs"`, `cookies.sessionToken.name: "esharevice_authjs_session"`, `session.strategy: "jwt"`.
   - Providers: Google (env-gated), Resend (env-gated).
   - `mintAccessToken` helper — RS256 JWT signed with `AUTH_JWT_PRIVATE_KEY`. Iss = `AUTH_ISSUER`, aud = `AUTH_AUDIENCE`, kid = `authjs-rs256`, exp 1h.
   - `deriveSub` — provider-prefixed sub format (`google:1234…`, `email:user@example.com`).
   - `signIn` callback → calls `POST /v1/me/provision` to upsert local users row.
   - `jwt` callback → re-mints access token on every touch; stores on `token.access_token`.
   - `session` callback → exposes `session.user.id` (= sub) + `session.accessToken`.
4. Create JWKS endpoint at `apps/web/app/.well-known/jwks.json/route.ts` — derives public JWK from `AUTH_JWT_PRIVATE_KEY` at runtime, strips private components, 24h Cache-Control.
5. Create `apps/web/app/api/authjs/[...nextauth]/route.ts` — re-exports Auth.js handlers.
6. Build `/login` page with branded UI (Google + magic-link). Provider visibility env-gated.
7. Build `/login/check-email` interstitial for magic-link.
8. Server actions in `apps/web/app/login/actions.ts` — `signInGoogleAction`, `signInResendAction`.
9. Update `apps/web/middleware.ts` — short-circuit when Auth.js cookie is present; preserve Authentik refresh logic when only the legacy cookie is present.
10. API: add `AUTHJS_ISSUER` / `AUTHJS_JWKS_URL` / `AUTHJS_AUDIENCE` env vars (all optional — legacy-only mode when absent).
11. Rewrite `apps/api/src/middleware/auth.ts` with dual-issuer logic. Decode `iss` claim → pick JWKS → verify.
12. Extend `apps/api/src/lib/users.ts::resolveUserFromSub` to handle Auth.js sub formats + email-merge for magic-link users colliding with existing Authentik rows by email.
13. New `POST /v1/me/provision` endpoint in `apps/api/src/routes/v1/me.ts` — auth-required, body `sub` must match token `sub` (else 403), returns `UserPublic` on success.
14. Document all the new env vars in `.env.example` files.
15. Append `AUTH_ISSUER` + `AUTH_AUDIENCE` to `apps/web/.env.local`, and `AUTHJS_*` to `apps/api/.env` so the dev stack works end-to-end.
16. Write the migration runbook (`docs/features/2026-05-17_authjs-migration.md`).
17. `pnpm typecheck` — clean.
18. Commit + push + open PR.

## Edge Cases to Handle

- **`exactOptionalPropertyTypes: true` strictness** — Auth.js v5's NextAuthConfig type doesn't allow `secret: string | undefined`, only `string | string[]`. Solved by throwing at module load if `AUTH_SECRET` isn't set. Same pattern for the optional-property fields in `mintAccessToken` + `provisionLocalUser` — build the input object conditionally, never assigning `undefined`.
- **Two auth systems on the same domain** — the legacy `/api/auth/*` and new `/api/authjs/*` both exist. Next 15's catch-all routing matches the more specific path first, so `/api/auth/login/route.ts` (Authentik) takes precedence over `/api/authjs/[...nextauth]/route.ts` for that exact URL. No collision in practice.
- **Cookie collision** — both systems set cookies on the same domain. Different names: `esharevice_session` (Authentik) vs `esharevice_authjs_session` (Auth.js). Middleware routes by which is present.
- **JWKS endpoint cold start** — `/.well-known/jwks.json` derives the JWK live each request. The HTTP `Cache-Control: max-age=86400` lets clients (the Hono API's jose `createRemoteJWKSet`) cache. First call after a deploy hits the live derive; after that, jose's in-memory cache serves it.
- **Email-merge in `resolveUserFromSub`** — if an Auth.js magic-link user signs in with an email that already has an Authentik-provisioned row (different sub), we update that existing row's `oidc_sub` to the Auth.js form. Avoids double-rowing the same human across the migration. Only triggers for `email:` subs — Google subs are stable per-provider and a different Google account at the same email IS a different identity.
- **`/v1/me/provision` sub-cross-check** — even though the endpoint is auth-required (the bearer token's sub has already been verified against the JWKS), it explicitly cross-checks that the request body's `sub` field matches. Defence-in-depth against any future signin callback bug that might pass mismatched values.
- **Re-minting access token on every page load** — Auth.js's `jwt` callback runs frequently (every page request that needs the session). Re-minting on every call keeps the access token short-lived (1h) without a refresh-token dance. The cost is one `SignJWT` per request, which is fast.
- **Provider visibility on `/login`** — both Google and email magic-link are env-gated. If neither is configured, the page shows a "Sign-in isn't configured yet" notice. Useful smoke-check for fresh-clone dev environments.

## Progress Log

### 2026-05-17 05:35 UTC
- Merged PR #3 to main. Cut `feat/pr1b-authjs-wireup` from the post-PR-3 main.

### 2026-05-17 05:38 UTC
- Installed `next-auth@5.0.0-beta.31` + `bcryptjs@3.0.3` + `@types/bcryptjs`.
- Wrote `apps/web/auth.ts`. Discovered + fixed two cwd-stuck `mkdir` mistakes that created `apps/web/apps/web/...` (cleaned up with `rm -rf`); the actual route files landed in the right place via absolute-path Writes.

### 2026-05-17 05:43 UTC
- JWKS endpoint, Auth.js handler route, branded `/login` page, `/login/check-email`, server actions.
- Updated middleware.ts to pass-through when Auth.js cookie is present.

### 2026-05-17 05:46 UTC
- API: added `AUTHJS_*` env vars, rewrote `apps/api/src/middleware/auth.ts` with dual-issuer logic, extended `resolveUserFromSub` for Auth.js sub formats + email-merge.
- New `POST /v1/me/provision` endpoint with sub cross-check.

### 2026-05-17 05:48 UTC
- First typecheck found 4 errors from `exactOptionalPropertyTypes: true`. Fixed by:
  - Throwing at module load if `AUTH_SECRET` is missing (instead of `secret: string | undefined`).
  - Building `mintAccessToken` claims + `provisionLocalUser` body objects conditionally, never assigning `undefined`.
- Second typecheck clean. All 5 packages pass.
- Wrote `docs/features/2026-05-17_authjs-migration.md` with three-phase runbook (PR 1b → cutover → teardown).

## Bugs / Issues Encountered

| Bug | Category | Resolution |
|---|---|---|
| Two `mkdir -p` commands ran with cwd stuck at `apps/web/`, creating directories under `apps/web/apps/web/...`. Write tool used absolute paths so route files landed correctly; only empty parallel dirs were the issue. | [Build] | `rm -rf apps/web/apps`, recreated with absolute paths. Generalisation: avoid `cd` in the working session and use absolute paths for mkdir. |
| `exactOptionalPropertyTypes: true` rejects assigning `undefined` to optional properties; Auth.js v5's `NextAuthConfig.secret` is `string \| string[]` (no undefined). | [Type] | Throw if `AUTH_SECRET` missing; build optional-property objects conditionally. Same pattern across the file. |

## Files Changed

**New:**
- `apps/web/auth.ts` — Auth.js v5 config + helpers
- `apps/web/app/.well-known/jwks.json/route.ts` — public JWK endpoint
- `apps/web/app/api/authjs/[...nextauth]/route.ts` — Auth.js handler
- `apps/web/app/login/page.tsx` — branded login UI
- `apps/web/app/login/actions.ts` — server actions
- `apps/web/app/login/check-email/page.tsx` — magic-link interstitial
- `docs/features/2026-05-17_authjs-migration.md` — three-phase runbook
- `tasks/2026-05-17_pr1b-authjs-wireup.md` — this task log

**Modified:**
- `apps/web/package.json` — added `next-auth@beta`, `bcryptjs`, `@types/bcryptjs`
- `pnpm-lock.yaml`
- `apps/web/middleware.ts` — Auth.js cookie pass-through + matcher updated to exclude /api/authjs and /.well-known/jwks.json
- `apps/web/.env.example` — Auth.js env var docs updated for "live in PR 1b" status
- `.env.example` — `AUTHJS_*` documented
- `apps/api/.env.example` — `AUTHJS_*` documented
- `apps/api/src/env.ts` — optional `AUTHJS_ISSUER` / `AUTHJS_JWKS_URL` / `AUTHJS_AUDIENCE`
- `apps/api/src/middleware/auth.ts` — dual-issuer JWKS verifier (iss-routed)
- `apps/api/src/lib/users.ts` — Auth.js sub formats + email-merge in `resolveUserFromSub`
- `apps/api/src/routes/v1/me.ts` — new `POST /v1/me/provision` endpoint

## Outcome

PR opened, typecheck green. Auth.js code is in place but **not yet primary** — header + sign-in links still point at the legacy Authentik flow. The cutover PR (Phase 2) flips those links once smoke-tested.

## What's Next

Three options:
1. **Cutover (Phase 2 of the migration)** — flip header CTAs to `/login`. Small focused PR. Requires Google OAuth redirect URI update in the Cloud Console.
2. **PR 4 — Stripe Connect Canada.** Backend revenue path. Self-contained, no auth dependency.
3. **PR 5 — UI primitives.** Marketplace components (Heart, RatingStar, ActionPanel, etc.). Frontend-only.

The plan's natural ordering is PR 4 next (continues the backend momentum and unblocks PR 9's booking flow UI). The cutover can land in parallel.
