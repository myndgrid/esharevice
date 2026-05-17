# Feature: Authentik → Auth.js Migration

**Created:** 2026-05-17 05:48 UTC
**Last Updated:** 2026-05-17 05:48 UTC
**Status:** Draft — PR 1b ships the wire-up; cutover + Authentik teardown follow in 7-day windows.

## Overview

The legacy auth stack runs Authentik (containerized OIDC IdP) with a custom oauth4webapi flow in the Next.js app. Auth.js v5 replaces both layers: it's open source, free, Next.js-native, supports Google + magic-link + (future) Apple + credentials out of the box, runs *inside* `apps/web` (no extra container), and is dramatically simpler to maintain.

Migration is a three-phase sliding window so users don't get logged out mid-flight:

1. **Phase 1 (PR 1b, this doc):** Auth.js mounts at `/api/authjs/*` alongside the existing Authentik routes at `/api/auth/*`. Both work. New sign-ins can use either. The Hono API verifies tokens from BOTH issuers via iss-routed JWKS resolution.
2. **Phase 2 (cutover, separate PR after smoke-test):** Header + UI links flip from `/api/auth/login` → `/login` (the new branded page). Existing Authentik sessions continue working until they expire (~30 days), but new sign-ins go to Auth.js.
3. **Phase 3 (teardown, after the 7-day overlap):** Delete the Authentik routes from `apps/web/app/api/auth/`, delete `apps/web/lib/oidc.ts`, remove the Authentik branch from `apps/api/src/middleware/auth.ts`, tear down the Authentik + Authentik-Postgres containers from `infra/docker-compose.yml`, drop the `auth.esharevice.com` block from `infra/Caddyfile`.

## Routes / API Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET/POST` | `/api/authjs/[...nextauth]` | Auth.js catch-all handler (basePath set to `/api/authjs`) |
| `GET` | `/.well-known/jwks.json` | JWKS for the RS256 access token we sign — Hono API verifies against this |
| `GET` | `/login` | Branded login page (Google + magic-link buttons) |
| `GET` | `/login/check-email` | Magic-link interstitial after Resend send |
| `POST` | `/v1/me/provision` | Hono API endpoint Auth.js's signIn callback hits to upsert local users row |

Legacy Authentik routes (untouched in PR 1b): `/api/auth/login`, `/api/auth/callback`, `/api/auth/logout`.

## Modules / Classes Involved

| File | Role |
|---|---|
| `apps/web/auth.ts` | Auth.js v5 config — providers, callbacks, RS256 access-token minting |
| `apps/web/app/api/authjs/[...nextauth]/route.ts` | Auth.js handler (`export const { GET, POST } = handlers`) |
| `apps/web/app/.well-known/jwks.json/route.ts` | Public JWK set derived live from `AUTH_JWT_PRIVATE_KEY` |
| `apps/web/app/login/page.tsx` | Branded login UI |
| `apps/web/app/login/actions.ts` | Server actions: `signInGoogleAction`, `signInResendAction` |
| `apps/web/app/login/check-email/page.tsx` | Magic-link interstitial |
| `apps/web/middleware.ts` | Pass through for Auth.js sessions; preserve Authentik refresh dance |
| `apps/api/src/middleware/auth.ts` | Dual-issuer JWKS verifier — routes by `iss` claim |
| `apps/api/src/routes/v1/me.ts` | Hosts the new `POST /v1/me/provision` endpoint |
| `apps/api/src/lib/users.ts` | `resolveUserFromSub` extended to handle Auth.js sub formats + email-merge |
| `apps/api/src/env.ts` | New `AUTHJS_ISSUER` / `AUTHJS_JWKS_URL` / `AUTHJS_AUDIENCE` (optional) |

## Frontend Views / Functions Involved

- **`/login` (branded)** — Google button + email magic-link form. Both POST to server actions that call Auth.js `signIn()`.
- **`/login/check-email`** — informational page after a magic-link send.
- **Legacy header + sign-in links** — UNCHANGED in PR 1b. They still point to `/api/auth/login` (Authentik). The cutover PR flips them.

## Persistence (files or tables touched)

- `users.password_hash` (already present from PR 1a's migration 0006) — currently unused; will be populated when password signup ships.
- `users.oidc_sub` — accepts both legacy (Authentik plain ID) and new (Auth.js `google:`, `apple:`, `email:`) formats. Email-merge logic in `resolveUserFromSub` heals same-email-different-sub collisions for magic-link users.

## Edge Cases & Gotchas

- **Cookie disambiguation.** Authentik uses `esharevice_session` + `esharevice_at`. Auth.js uses `esharevice_authjs_session`. Middleware detects which is present and routes accordingly. No collision.
- **basePath = `/api/authjs`.** Auth.js v5 supports `basePath` config; we deliberately use a non-default to avoid clobbering the legacy `/api/auth/*` routes. After teardown, this CAN be changed back to `/api/auth` if desired (Auth.js default), but leaving it as-is is the lower-risk path.
- **Dual-issuer verifier latency.** The first request after process boot to each issuer hits the live JWKS endpoint to fetch keys. jose caches them in-memory per `createRemoteJWKSet` instance. Worst case: one cold fetch per issuer per process. The Auth.js JWKS comes from our own web app — same network — so the cost is negligible.
- **AUTH_JWT_PRIVATE_KEY rotation.** Rotating this invalidates every active Auth.js session (their access tokens become unverifiable). DON'T rotate during active operation unless you're OK forcing a global logout. The fingerprint of the public key is recorded in `.env.creds` for verification.
- **Access token vs session cookie.** Two separate concepts:
  - *Session cookie* (`esharevice_authjs_session`) — JWE-encrypted using `AUTH_SECRET` (symmetric). Auth.js manages it.
  - *Access token* (Authorization: Bearer) — RS256 JWT signed with `AUTH_JWT_PRIVATE_KEY` (asymmetric). Re-minted on every JWT callback (every page load). Server-side code grabs it from `session.accessToken` and passes it to the API.
- **JWKS deriving on cold start.** The `/.well-known/jwks.json` route reads `AUTH_JWT_PRIVATE_KEY` and derives the public JWK at request time. Caching is via HTTP `Cache-Control` (24h), so callers respect the cache. If you `kill -HUP` the process, the next JWKS request triggers a fresh derive.
- **Apple Sign-In.** Deferred. The plan calls for it but the Apple Developer Program enrollment isn't done yet. When it lands, add `AUTH_APPLE_*` env values + add `Apple` to the providers array in `auth.ts` — no other changes required.
- **Credentials provider.** Deferred. The `users.password_hash` column already exists (PR 1a migration 0006) but password signup UI isn't built. Adding it later requires a Credentials provider in `auth.ts` + a `POST /v1/auth/password-login` API endpoint that does `bcrypt.compare`.
- **Lighthouse CI auth script.** Currently drives Authentik's flow-executor (`scripts/lighthouse-auth.cjs`). UNCHANGED in PR 1b — still tests against the legacy login. Rewriting it for Auth.js cookie injection is a follow-up after the cutover PR.

## Environment Variables Required

| Var | Where | Notes |
|---|---|---|
| `AUTH_SECRET` | apps/web | 32-byte base64. Encrypts the session cookie. **Required at boot** — auth.ts throws if absent. |
| `AUTH_JWT_PRIVATE_KEY` | apps/web | RS256 PKCS#8 PEM, base64-encoded. Signs access tokens; the JWKS endpoint derives the public key live. **Required at boot.** |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | apps/web | OAuth client credentials. Gates the "Continue with Google" button (absent → hidden). |
| `RESEND_API_KEY` | apps/web | Gates the magic-link form (absent → hidden). |
| `AUTH_RESEND_FROM` | apps/web | From-address for magic-link emails. Must be on a domain verified at resend.com/domains. |
| `AUTH_ISSUER` | apps/web | Defaults to web origin. Embedded as `iss` claim on RS256 access tokens. |
| `AUTH_AUDIENCE` | apps/web | Defaults to `esharevice-api`. Embedded as `aud` claim. |
| `AUTHJS_ISSUER` | apps/api | Optional. When set, API trusts tokens with matching `iss`. |
| `AUTHJS_JWKS_URL` | apps/api | Where the API fetches the public JWK. Usually `${web_origin}/.well-known/jwks.json`. |
| `AUTHJS_AUDIENCE` | apps/api | Defaults to `esharevice-api`. Must match `AUTH_AUDIENCE`. |

## Changelog

| Date | Change |
|---|---|
| 2026-05-17 05:48 UTC | Initial documentation. PR 1b wires Auth.js alongside Authentik. |

## Cutover Runbook (Phase 2 — separate PR)

When ready to flip the header + sign-in CTAs to the new Auth.js path:

1. Update `apps/web/components/header.tsx` — change `<Link href="/api/auth/login">` to `<Link href="/login">`.
2. Update any other login-redirect callers (search for `"/api/auth/login"` across the codebase).
3. Update `apps/web/lib/auth.ts` so the `auth()` wrapper checks for the Auth.js session FIRST, falling back to the Authentik session — server components keep working through the cutover.
4. Apply Google OAuth redirect URI update on the Google Cloud Console: add `http://localhost:3000/api/authjs/callback/google` AND `https://esharevice.com/api/authjs/callback/google` to the authorized redirect URIs.
5. Verify Resend domain is still verified.
6. Deploy.
7. Verify `/login` works in prod end-to-end with a real Google sign-in + a real magic-link.

## Teardown Runbook (Phase 3 — after 7-day overlap)

1. Delete `apps/web/app/api/auth/login/`, `callback/`, `logout/`.
2. Delete `apps/web/lib/oidc.ts` and the Authentik bits in `apps/web/lib/session.ts`.
3. Simplify `apps/web/middleware.ts` — drop the Authentik refresh dance; keep just the Auth.js pass-through (or remove the middleware entirely if Auth.js's default suffices).
4. Drop the Authentik branch from `apps/api/src/middleware/auth.ts` — `pickIssuer` returns only `"authjs"`.
5. Drop `OIDC_CLIENT_*` env vars (web), `OIDC_*` env vars (api). Keep `AUTHJS_*` as the canonical names — rename them to `OIDC_*` if you want the simpler post-migration naming.
6. Stop the Authentik containers: `docker compose -f infra/docker-compose.yml stop authentik-server authentik-worker authentik-postgres && docker compose -f infra/docker-compose.yml rm -f authentik-server authentik-worker authentik-postgres`.
7. Remove the corresponding sections from `infra/docker-compose.yml` + the `auth.esharevice.com` block from `infra/Caddyfile`.
8. Delete the Cloudflare DNS record for `auth.esharevice.com`.
9. Delete `infra/authentik/` (blueprints, theme overrides).
10. Rewrite `scripts/lighthouse-auth.cjs` to drive Auth.js's credentials callback instead of Authentik's flow-executor.
