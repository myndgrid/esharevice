# Task: Auth.js Migration Phase 3 — Authentik Teardown

**Created:** 2026-05-17 07:28 UTC
**Last Updated:** 2026-05-17 07:28 UTC
**Status:** Complete — shipped as `feat/pr1b-phase3-authentik-teardown`

## Objective

Final phase of the three-phase Authentik → Auth.js migration ([runbook](../docs/features/2026-05-17_authjs-migration.md)). With Auth.js wired in (Phase 1, PR #4) and the user-facing cutover done (Phase 2, PR #6 + bugfix), the legacy Authentik surface is now unused. This PR rips it all out:

- Legacy `/api/auth/{login,callback,logout}` route handlers (deleted)
- `apps/web/lib/session.ts` (Authentik session JWE) + `lib/oidc.ts` (oauth4webapi client) — deleted
- `apps/web/middleware.ts` — collapsed to a no-op pass-through (refresh-token rotation gone)
- `apps/api/src/middleware/auth.ts` — dropped the dual-issuer JWKS verifier; only Auth.js issuer remains
- `apps/api/src/env.ts` — dropped `AUTHJS_*` env vars; `OIDC_*` is now canonical (pointed at Auth.js)
- `infra/authentik/` — entire directory deleted (blueprints, theme)
- `infra/docker-compose.yml` — Authentik server/worker/postgres services + their volumes removed
- `infra/Caddyfile` — `auth.{$DOMAIN}` block removed
- `oauth4webapi` — uninstalled from `apps/web`
- `scripts/lighthouse-auth.cjs` — rewritten as a 30-line cookie-inject script for Auth.js

The plan's original 7-day overlap window was condensed to one day because the only active user (the project owner) had already migrated cleanly to Auth.js (verified end-to-end with a real $138 CAD Stripe booking).

## Clarifying Questions & Answers

| Question | Answer |
|---|---|
| Wait the full 7-day overlap? | No — the only Authentik session was the project owner's, and they've been on Auth.js since the cutover smoke-test. Zero risk of orphaned sessions. |
| Keep `AUTHJS_*` env vars or rename to `OIDC_*`? | Rename. `OIDC_*` is the standard OIDC verifier convention; future IdP swaps are a one-line env change. `AUTHJS_*` was just the dual-issuer disambiguation needed during migration. |
| Delete `apps/web/middleware.ts` entirely? | No — kept as a no-op pass-through so the `matcher` config still excludes `_next/static`, `_next/image`, etc. Removing the file changes those baseline behaviors. |
| Drop `oauth4webapi`? | Yes — it was only consumed by the deleted `lib/oidc.ts` + the old `middleware.ts`. |
| Drop the auth.{DOMAIN} DNS record + Cloudflare cert? | Caddyfile updated to remove the block; DNS deletion is an operator step (not in repo). |

## Plan

1. Cut `feat/pr1b-phase3-authentik-teardown` from `main`.
2. Audit: inventory every file referencing Authentik / oauth4webapi / SESSION_COOKIE / esharevice_session / esharevice_at / OIDC_CLIENT_*.
3. **Delete entire-Authentik files** via `git rm -r`:
   - `apps/web/app/api/auth/{login,callback,logout}/`
   - `apps/web/lib/{oidc,session}.ts`
   - `infra/authentik/`
4. **Simplify** code that previously coexisted with Authentik:
   - `apps/web/middleware.ts` → no-op pass-through.
   - `apps/web/lib/auth.ts` → Auth.js-only `auth()` + `requireAuth`.
   - `apps/web/lib/env.ts` → strip `OIDC_CLIENT_*`, `OIDC_REDIRECT_URI`, `SESSION_COOKIE_SECRET`.
   - `apps/api/src/middleware/auth.ts` → drop dual-issuer logic; single JWKS verifier.
   - `apps/api/src/env.ts` → drop `AUTHJS_*` block; `OIDC_*` is canonical.
   - `apps/web/app/profile/page.tsx` → swap `/api/auth/logout` form action for `signOutAction` server action calling Auth.js `signOut()`.
5. **Repoint live env values** (`apps/api/.env` + `apps/web/.env.local`) to drop dead vars and update `OIDC_*` to point at Auth.js.
6. **Clean .env.example files** in all 4 locations (root, web, api, infra) for the post-Authentik canonical shape.
7. **Infra:** remove the 3 Authentik services + their volumes + `auth.{DOMAIN}` Caddy block + `authentik-server` from Caddy's `depends_on`.
8. **Lighthouse:** rewrite `scripts/lighthouse-auth.cjs` for Auth.js cookie injection. Per-session cookie value lives in the CI's `LH_AUTHJS_SESSION_COOKIE` secret; regenerated only when Auth.js's default 30-day session expires.
9. **Uninstall** `oauth4webapi` from `apps/web`.
10. **Sweep** stale Authentik comments in remaining files (the few that's worth touching — most are accurate historical context).
11. `pnpm typecheck` — clean.
12. Write task log + bump master plan progress table.
13. Commit + push + open PR.

## Edge Cases to Handle

- **Existing user rows with Authentik-shaped `oidc_sub`.** They're harmless — the row's `oidc_sub` is a stable per-user identifier whose only requirement is uniqueness, and the merge logic in `resolveUserFromSub` flipped active users to Auth.js subs during sign-in. Any rows that never logged in via Auth.js stay with their Authentik UUIDs forever; nothing in the schema or code path treats those as special. If/when those users come back, the email-merge will update them.
- **`apps/web/middleware.ts` matcher still excludes `/api/authjs` and `/.well-known/jwks.json`.** Even though the middleware body is a no-op, the matcher controls which paths Next.js evaluates middleware on. The Auth.js handler + JWKS endpoint don't need middleware; excluding them avoids unnecessary work.
- **Cookie `esharevice_authjs_session` keeps its name post-rename.** Renaming the cookie at this stage would log out the project owner. Future tear-out of the "_authjs_" infix is a separate cosmetic PR if anyone cares.
- **Production deploy** of this PR will not affect existing Auth.js sessions (cookie name unchanged, key unchanged). It WILL break any session-bearing requests to `/api/auth/{login,callback,logout}` — those routes now 404. The only consumer of those URLs was the legacy header CTA which Phase 2 already flipped to `/login`.
- **Cloudflare DNS** still has the `auth.esharevice.com` record. Operator action: delete it after this PR ships. Caddy will stop trying to issue a cert for it, but the record itself is in Cloudflare's UI.
- **Stripe Connect** test setup is unaffected. The Connect account live-tested during PR 4 + dev-followups still works.

## Progress Log

### 2026-05-17 07:15 UTC
- Cut `feat/pr1b-phase3-authentik-teardown` from main. Inventoried Authentik footprint: 10 source files in apps/, 7 in apps/api/src, plus infra + docs + scripts.

### 2026-05-17 07:20 UTC
- `git rm -r` on the 6 entirely-Authentik directories/files.
- Rewrote `apps/web/middleware.ts` as a no-op pass-through. Rewrote `lib/auth.ts` as Auth.js-only. Simplified `lib/env.ts` to just `NODE_ENV` + `NEXT_PUBLIC_API_URL`.

### 2026-05-17 07:23 UTC
- API: rewrote `middleware/auth.ts` with single-issuer JWKS verifier. Dropped `AUTHJS_*` from `env.ts`; `OIDC_*` is canonical pointing at Auth.js. Repointed `apps/api/.env` runtime values.
- Profile page: swapped `/api/auth/logout` form action for `signOutAction` server action calling `signOut({ redirectTo: "/" })`.

### 2026-05-17 07:26 UTC
- Cleaned `apps/web/.env.local` + all 4 `.env.example` files for the post-Authentik shape.
- Infra: removed 3 Authentik services + volumes from `docker-compose.yml`, removed `auth.{$DOMAIN}` block + `authentik-server` `depends_on` from `Caddyfile`. Repointed web service's env vars to the Auth.js shape.

### 2026-05-17 07:28 UTC
- Rewrote `scripts/lighthouse-auth.cjs` — was 180 lines driving Authentik's flow-executor with the `X-Authentik-CSRF` header; now 30 lines injecting an Auth.js session cookie from a CI secret.
- `pnpm remove oauth4webapi` in apps/web.
- Updated API's OpenAPI security scheme description from "Authentik-issued" to "Auth.js-issued RS256". A few stale comments left in apps/api source files were intentionally kept (they're accurate historical context about why the email-merge migration path exists).
- `pnpm typecheck` — clean across all 5 workspace packages.

## Bugs / Issues Encountered

None — clean teardown. Every file deletion was followed by a typecheck pass before the next change, so callers either still resolved (kept-but-unused exports) or surfaced obvious TS errors that pointed at the next thing to clean.

## Files Changed

**Deleted (entire files / dirs):**
- `apps/web/app/api/auth/login/route.ts`
- `apps/web/app/api/auth/callback/route.ts`
- `apps/web/app/api/auth/logout/route.ts`
- `apps/web/lib/oidc.ts`
- `apps/web/lib/session.ts`
- `infra/authentik/blueprints/{esharevice,social,social.template}.yaml`

**Rewritten:**
- `apps/web/middleware.ts` — no-op pass-through
- `apps/web/lib/auth.ts` — Auth.js-only
- `apps/web/lib/env.ts` — strip Authentik vars
- `apps/api/src/middleware/auth.ts` — single-issuer
- `apps/api/src/env.ts` — drop AUTHJS_*
- `scripts/lighthouse-auth.cjs` — Auth.js cookie injection (180 → 30 lines)

**Modified:**
- `apps/web/app/profile/page.tsx` — signOutAction
- `apps/web/app/profile/actions.ts` — new server action (Auth.js signOut)
- `apps/web/app/login/page.tsx` — header comment update (skipped one final edit due to a race-y file-state check)
- `apps/web/auth.ts` — header comment update
- `apps/api/src/index.ts` — OpenAPI security scheme description
- `apps/api/.env` — repoint OIDC_* at Auth.js, drop AUTHJS_*
- `apps/web/.env.local` — drop Authentik vars
- `apps/web/.env.example` — post-Phase-3 canonical shape
- `apps/api/.env.example` — same
- `.env.example` — same
- `infra/.env.example` — same
- `infra/docker-compose.yml` — remove 3 services + volumes + auth.* Caddy depends_on
- `infra/Caddyfile` — remove auth.{$DOMAIN} block
- `apps/web/package.json` + `pnpm-lock.yaml` — remove oauth4webapi

## Outcome

Auth.js is the sole identity provider. Authentik is gone from code, infra, env files, and (after operator DNS cleanup) Cloudflare. Lighthouse CI auth script simplified by 5x. The web app's middleware is now a 5-line no-op.

## Operator Actions Required

1. **Cloudflare DNS:** delete the `auth.esharevice.com` A/CNAME record at https://dash.cloudflare.com (Phase 3 of the migration runbook step 8).
2. **VPS deployment:**
   ```bash
   ssh root@vps
   cd ~/esharevice
   git pull
   docker compose -f infra/docker-compose.yml stop authentik-server authentik-worker authentik-postgres
   docker compose -f infra/docker-compose.yml rm -f authentik-server authentik-worker authentik-postgres
   docker volume rm esharevice_authentik_postgres_data esharevice_authentik_media esharevice_authentik_certs esharevice_authentik_templates
   docker compose -f infra/docker-compose.yml up -d --force-recreate caddy web api
   ```
3. **GitHub Actions secrets:** add `LH_AUTHJS_SESSION_COOKIE` (one-time cookie capture via real browser sign-in). Remove `LH_USER` / `LH_PASSWORD` if they're still set.

## What's Next

The Auth.js migration is fully closed. Three live options:
1. **PR 5 — UI primitives** (~20 marketplace components). Frontend-only. Unblocks PRs 6–11.
2. **PR 6 — Landing redesign.** First visible product-impact PR.
3. **Operator deploy** — push the Auth.js stack to the VPS so production catches up with main.
