# Feature: Web app + OIDC login flow

**Created:** 2026-05-14 21:00 UTC
**Last Updated:** 2026-05-14 21:00 UTC
**Status:** Stable — login is live at app.esharevice.com

The Next.js web app gets its design system, its layout shell, and a fully working OIDC login flow against Authentik.

---

## Overview

`apps/web` is the reference client for the public `/v1` API. It uses Next.js 15 (App Router, React 19, standalone output) and authenticates users via **Authentik** with the OIDC authorization code flow + PKCE — implemented directly with `oauth4webapi`, NOT NextAuth/Auth.js.

The web app is **one of three peer clients** that talk to the API. It has zero special access; whatever the future iOS app sees, the web app sees. Auth tokens are interchangeable.

---

## Routes / API Endpoints (web-internal)

| Method | Path | Description |
|---|---|---|
| GET | `/` | Home — server component fetches `/v1/exchange-items?limit=20`, renders cards |
| GET | `/profile` | Protected page — calls `auth()` → 307s to `/api/auth/login?return_to=/profile` if no session |
| GET | `/api/auth/login` | Generates PKCE verifier + state + nonce, sets short-lived `esharevice_oidc_state` cookie, 307s to Authentik's `authorization_endpoint` |
| GET | `/api/auth/callback` | Validates `state` + `nonce`, exchanges authorization code for tokens (PKCE), sets long-lived signed `esharevice_session` cookie, redirects to `return_to` |
| GET | `/api/auth/logout` | Clears session cookie locally, then redirects to Authentik's `end_session_endpoint` with `id_token_hint` for SSO logout |

The `/api/auth/refresh` route in the original plan isn't a separate endpoint — refresh happens inline inside the `auth()` server helper whenever an access token is within 60 s of expiring.

---

## Modules / Classes Involved

| Layer | File | Role |
|---|---|---|
| Env | `apps/web/lib/env.ts` | Lazy Zod-validated env (`getEnv()`). MUST be lazy — see Edge Cases. |
| OIDC client | `apps/web/lib/oidc.ts` | Discovery (cached) + Hono-compatible `Client` + `ClientAuth` helpers |
| Session | `apps/web/lib/session.ts` | Signed HttpOnly cookies — long-lived session JWT + short-lived state JWT |
| Auth helper | `apps/web/lib/auth.ts` | `auth()` returns valid session (refreshing if needed); `requireAuth()` redirects to login |
| API client | `apps/web/lib/api.ts` | Typed fetch wrapper using `@esharevice/shared` Zod schemas; attaches Bearer token from session |
| UI primitives | `packages/ui/src/*` | `cn`, `Button`, `Avatar`, `Card` — CVA-based, themed via oklch tokens |
| Layout shell | `apps/web/app/layout.tsx`, `apps/web/components/header.tsx`, `apps/web/components/theme-toggle.tsx` | Header, theme bootstrap, Suspense boundary |
| Pages | `apps/web/app/page.tsx`, `apps/web/app/profile/page.tsx` | Home + protected profile |
| Styling | `apps/web/app/globals.css` | Tailwind v4 `@theme inline` block maps Tailwind utilities (`bg-bg`, `text-fg`, etc.) to our oklch CSS variables |

---

## Authentication flow (sequence)

```
User                Web (Next.js)              Authentik              API
 |                       |                         |                   |
 | Click "Sign in"       |                         |                   |
 |---------------------->|                         |                   |
 |                       | GET /api/auth/login     |                   |
 |                       | - generate verifier+S256 challenge          |
 |                       | - generate state + nonce                    |
 |                       | - set esharevice_oidc_state cookie (10m)    |
 |                       | 307 → /authorize?client_id=…&state=…&PKCE…  |
 |<----------------------|                         |                   |
 |                       |                         |                   |
 |        GET /authorize (with PKCE challenge)     |                   |
 |------------------------------------------------>|                   |
 |        login screen (Authentik flow UI)         |                   |
 |<------------------------------------------------|                   |
 |        username + password / Google / GitHub    |                   |
 |------------------------------------------------>|                   |
 |        302 → /api/auth/callback?code=…&state=…  |                   |
 |<------------------------------------------------|                   |
 |                       |                         |                   |
 |        GET /api/auth/callback?code=…            |                   |
 |---------------------->|                         |                   |
 |                       | - validateAuthResponse (state matches)      |
 |                       | - POST /token (code + verifier + creds)    |
 |                       |------------------------>|                   |
 |                       | { access, refresh, id_token, expires_in }   |
 |                       |<------------------------|                   |
 |                       | - verify id_token nonce + signature         |
 |                       | - set esharevice_session cookie (30d)       |
 |                       | 307 → /                                     |
 |<----------------------|                         |                   |
 |                       |                         |                   |
 | Subsequent requests:  |                         |                   |
 |  cookie + auth() helper attaches Bearer to /v1 calls                |
 |---------------------->|                         |                   |
 |                       | GET /v1/me with Bearer  |                   |
 |                       |------------------------------------------>  |
 |                       | { id, email, name, ... }                    |
 |                       |<------------------------------------------  |
```

When the access token expires (~15 min):

```
 auth() helper                                     Authentik
   |  detects access_expires_at - 60s < now           |
   |  POST /token (grant_type=refresh_token)          |
   |------------------------------------------------->|
   |  { new access, possibly new refresh, expires }   |
   |<-------------------------------------------------|
   |  re-sign session JWT, write new cookie           |
```

If the refresh fails (revoked / Authentik down / expired): `clearSessionCookie()` + return `null`. Server components see no session → redirect to login.

---

## Cookies

| Name | Type | Lifetime | Contents |
|---|---|---|---|
| `esharevice_session` | HttpOnly, Secure (prod), SameSite=Lax | 30 days | Signed JWT `{ sub, access_token, access_expires_at, refresh_token, id_token? }` |
| `esharevice_oidc_state` | HttpOnly, Secure (prod), SameSite=Lax | 10 minutes | Signed JWT `{ state, nonce, code_verifier, return_to }` — wiped on callback |

Both signed with `SESSION_COOKIE_SECRET` via `jose` HS256. Same `jose` library the API uses to verify Authentik JWTs.

---

## Design system

Layout consumes the existing oklch tokens (light + dark) from `@esharevice/ui/styles.css` via Tailwind v4's `@theme inline` directive. Every Tailwind utility like `bg-bg`, `text-fg-muted`, `border-border-strong`, `bg-accent` maps to a CSS variable on `:root` / `[data-theme="dark"]`. Theme flip is instant (no React re-render).

Primitives shipped in this slice:

| Component | Purpose | Status |
|---|---|---|
| `Button` | CVA variants: primary / secondary / ghost / danger / link; sizes sm / md / lg / icon | Stable |
| `Avatar` | Falls back to initials when no `src` | Stable |
| `Card` + `CardContent` | Bg-elevated surface w/ border + shadow | Stable |
| `ThemeToggle` | Client component, toggles `[data-theme]` + `localStorage.theme` | Stable |
| `Header` | Server component (auth-aware); logo + ThemeToggle + Sign-in/Avatar | Stable |

More primitives (Dialog, Input, DropdownMenu, Skeleton) land alongside the form-building features in week 5+.

---

## Persistence (files or tables touched)

None directly. The web app is stateless beyond the cookies. All persistence is via the `/v1` API, which writes to Postgres (`users` for `/v1/me`, `exchange_items` for the rest).

---

## Edge Cases & Gotchas

- **Env must be lazy.** Top-level `const env = EnvSchema.parse(...)` failed `next build` because Next 15 statically evaluates module-level code in API route handlers during "Collecting page data" — but the OIDC vars aren't in the Docker build context. Solution: `getEnv()` accessor that parses on first call. See `apps/web/lib/env.ts`.
- **`apps/web/public/` must exist** (even empty). The Dockerfile COPYs it.
- **`typedRoutes`** is now top-level in `next.config.mjs` (not under `experimental`). Next 15 deprecated the experimental location.
- **Theme bootstrap script runs BEFORE React mounts.** It's `dangerouslySetInnerHTML` in `<head>`. Don't refactor it to a React effect — that causes a flicker.
- **`ThemeToggle` defers rendering icons until after mount** to avoid SSR/client hydration mismatch (server doesn't know which theme localStorage will resolve to).
- **`auth()` may rotate refresh tokens.** Authentik rotates them; we always use whichever one came back from the latest token endpoint call.
- **The session cookie can be larger than expected.** Authentik's access tokens are JWTs (~1.5 KB). Stay under the 4 KB cookie limit by NOT also storing the userinfo response — fetch from the API on demand.
- **CORS is not relevant for web → API calls** in production. Both share the `esharevice.com` parent domain; cookies aren't sent cross-origin to the API, but the Bearer token IS the auth source for API calls.

---

## Environment Variables Required

The web app fails at first request if any required vars are missing or malformed (Zod-parsed lazily):

```
NODE_ENV=development|test|production
NEXT_PUBLIC_API_URL=https://api.esharevice.com   # browser-visible API base
OIDC_ISSUER=https://auth.esharevice.com/application/o/e-sharevice-web/
OIDC_CLIENT_ID=e-sharevice-web
OIDC_CLIENT_SECRET=...                            # from Authentik web provider
OIDC_REDIRECT_URI=https://app.esharevice.com/api/auth/callback
SESSION_COOKIE_SECRET=...                         # 32+ chars; openssl rand -hex 32
```

In production these come from `infra/.env`; in local dev, set them in `apps/web/.env.local`.

---

## Authentik provider configuration

Already provisioned via blueprint (`infra/authentik/blueprints/esharevice.yaml`). The `e-sharevice-web` OAuth2 provider has both redirect URIs registered:

- `https://app.esharevice.com/api/auth/callback` (production)
- `http://localhost:3000/api/auth/callback` (local dev)

If we add staging or another environment, add the URI to the blueprint AND re-apply.

---

## Changelog

| Date | Change |
|---|---|
| 2026-05-14 21:00 UTC | Initial flow shipped: oauth4webapi-based auth code + PKCE, signed cookie session, theme-aware layout shell, home page consuming `/v1/exchange-items`, protected `/profile` |
