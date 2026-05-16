# Task: TypeScript Migration & Frontend Redesign Plan

**Created:** 2026-05-11 00:00 UTC
**Last Updated:** 2026-05-14 21:00 UTC
**Status:** v3.4 — weeks 1-3 shipped + first web slice live (OIDC login + design system + home/profile pages)

---

## Objective

Produce an actionable plan to (1) migrate `e-Sharevice` (React + Vite frontend) and `e-Sharevice-backend` (Node + Express + Knex/MySQL) to a unified TypeScript stack, and (2) redesign the frontend to be minimal, modern, mobile-first, and support dark + light themes. Plan must be rooted in what is actually present in the repo — no generic advice.

---

## v2 Addendum (2026-05-12) — User Decisions & Plan Revisions

> This addendum **supersedes** the original plan where it conflicts, and **extends** it everywhere else. The v1 sections below remain intact for traceability.

### Locked-in decisions (from user)

1. **Non-web clients are anticipated** — mobile native, third-party integrations. The API is no longer an internal implementation detail; it is a product.
2. **Self-hosted on the user's own VPS** — no Vercel, no Netlify, no managed PaaS at the platform level.
3. **Auth.js (NextAuth v5)** — chosen for OAuth provider coverage.

### What changes in the original plan

#### A. The Express + Next split is the right call (was previously questioned)

The v1 plan treated the API/Web split as a hedge. Given non-web clients, it is now load-bearing:

- Keep **Express 5 + Drizzle** as `apps/api` — the public, versioned product surface.
- Keep **Next.js 15** as `apps/web` — the reference client (it consumes the same public API as mobile and third-party).
- Web does **not** get privileged access. Whatever endpoints mobile sees, web sees.

#### B. The API becomes a versioned product — additions to Week 2

The original plan did not treat the API as externally consumed. These are now non-negotiable:

| Requirement | Implementation |
|---|---|
| **Versioning** from day one | All routes mounted under `/v1/...` (`/v1/exchange-items`, `/v1/auth/login`, etc.). Cheap to add now, expensive to retrofit. |
| **OpenAPI spec** generated from Zod | Use `@asteasolutions/zod-to-openapi`. Schemas in `packages/shared` produce both runtime validators and the spec. Serve at `GET /v1/openapi.json` and Swagger UI at `/v1/docs`. |
| **RFC 7807 error shape** | All errors return `application/problem+json` with `{ type, title, status, detail, instance }`. Wrap Zod failures, 401/403/404, and 500s in one error handler. |
| **Cursor-based pagination** | `GET /v1/exchange-items?cursor=...&limit=20` returning `{ items, nextCursor }`. Offset pagination breaks under mobile infinite scroll. |
| **Idempotency keys** on writes | Accept `Idempotency-Key` header on `POST /v1/exchange-items`, `PUT /v1/exchange-items/:id/reserve`, `POST /v1/messages`. Store key + response in Redis for 24h. Replay returns cached response. (Stripe's pattern.) |
| **Auth-only for native clients** | Native iOS/Android do not send `Origin` reliably. CORS allowlist is browser-only. Native clients authenticate by token — that's the protection boundary. |

#### C. Auth.js choice — accepted, with future-proofing

Auth.js is tightly coupled to Next.js. Given the API has third-party consumers, this introduces real friction. We are going with Auth.js as decided, **with** these guardrails:

1. **JWT claims are OIDC-standard only** — `sub`, `iss`, `aud`, `exp`, `iat`, `nbf`, plus `email` and `email_verified`. **No app-specific fields** (no `roles`, no `is_admin`, no `provider_user_id`) in the token. App-specific data is fetched by `sub` from the DB on each request. This keeps the door open to swap Auth.js for a self-hosted OIDC provider (Authentik / Zitadel / Keycloak) later without breaking clients.
2. **The API does not depend on Auth.js.** `apps/api` only validates JWTs against the issuer's JWKS (`process.env.AUTH_JWKS_URL`). Auth.js is the issuer; the API is a verifier. Mobile clients hit the same JWKS endpoint.
3. **Document the OIDC fallback** in the README so that "swap auth provider" is a known operation, not a re-architecture.

#### D. Token strategy across clients

| Client | Access token | Refresh token | Session |
|---|---|---|---|
| **Web (Next)** | 15-min JWT, in HttpOnly cookie + Authorization header for API calls | 30-day rotating, HttpOnly + Secure + SameSite=Lax cookie | Yes — for SSR on first paint |
| **Mobile native** | 15-min JWT, in OS keychain | 30-day rotating, OS keychain | No |
| **Third-party** | Long-lived API token OR OAuth 2.0 client credentials flow (decide per integrator) | n/a | No |

Refresh tokens are stored in Redis (key = hash(refresh_token), value = `{ user_id, device, issued_at, last_used }`) so revocation is one `DEL`. The API middleware resolves any valid path (cookie OR Authorization header) to `req.user`.

#### E. Self-hosted VPS stack (replaces "Deploy to Vercel/Fly" in v1 §Week 5)

| Layer | Choice | Why |
|---|---|---|
| VPS | **Hetzner CX22 / CX32** | Cheapest viable specs; EU-hosted |
| Reverse proxy / TLS | **Caddy 2** | Automatic Let's Encrypt; one-file config; HTTP/3 by default |
| Orchestration | **Docker Compose** | k8s is overkill for one node |
| Deploy UX | **Coolify** (recommended) or **Dokploy** | Git-push-to-deploy; env management; one-click rollbacks; self-hosted Heroku-like |
| CI | **GitHub Actions** → **ghcr.io** image push → Coolify webhook OR SSH deploy script | |
| DB | **Postgres 16** in Compose | See §F |
| Cache / rate-limit / refresh-token store / idempotency store | **Redis 7** in Compose | Single dependency does four jobs |
| Object storage (images) | **Cloudflare R2** (preferred — zero egress) | The sha256 dedup logic from `exchangeController.js:117-129` moves into the upload layer: object key = `sha256(content).webp` |
| Image processing | **sharp** in `apps/api` to convert to webp on upload | Removes the multipart-disk round trip; serve via R2 + Cloudflare CDN |
| Backups | `pg_dump` on cron → Backblaze B2 (S3-compatible) | ~$0.005/GB/month; **quarterly restore drill** required |
| Uptime | **Uptime Kuma** (self-hosted, also in Compose) | |
| Errors | **Sentry** (free tier or self-hosted) for both `web` and `api` | |
| Logs | **Better Stack** free tier, or self-host Loki + Grafana | |
| DNS | Cloudflare in front of the VPS | DDoS, caching, free TLS edge |

**Next.js on a VPS gotchas to remember:**
- Use `output: 'standalone'` in `next.config.mjs` — produces a self-contained server with only the deps it needs.
- `next/image` needs `sharp` and a writable cache dir mounted as a Compose volume.
- The Edge runtime is unavailable — don't use `export const runtime = "edge"` anywhere.
- ISR works but its disk cache must be a volume, or you lose it on every redeploy.

#### F. MySQL → Postgres (recommended swap, not mandatory)

The v1 plan kept MySQL. Given we're rewriting the data layer anyway, Postgres is worth swapping for:

- **Better Drizzle support and ergonomics** (Drizzle's Postgres dialect is the most mature).
- **JSONB columns** for the messaging metadata (read receipts, attachments) you'll add.
- **Built-in full-text search** (`tsvector` + `tsquery` + GIN indexes) — eliminates the need for a separate Meilisearch/Elasticsearch service for v1 of the search feature. See §G.
- **PostGIS** if location filtering becomes a serious feature — currently out of scope but worth knowing the upgrade path.
- `drizzle-kit introspect` can generate the schema from a live MySQL DB to start, then convert types manually.

If you'd rather stay on MySQL, the plan still works — only §G's FTS implementation changes (use MySQL `FULLTEXT` indexes or add Meilisearch).

#### G. Missing feature categories — fold into the plan

These were absent from v1 and matter for a community marketplace:

| Category | What to add | Notes |
|---|---|---|
| **Search** | The current `Header` component has a search input wired to nothing. Add `GET /v1/exchange-items?q=...` backed by Postgres FTS (`tsvector` over `provider`, `service`, `description`). | If MySQL, add `FULLTEXT(provider, service, description)`. Meilisearch is the upgrade path. |
| **Location** | Add `postal_code`, `latitude`, `longitude` to `users` (and optionally `exchange_items` for travel-allowed items). Geocode on signup via a free API (Nominatim with cache, or Mapbox free tier). Filter list endpoint by `?within_km=10`. | Schema-ready even if UI lags. |
| **Notifications** | Email on reservation, message received, item completed. Use **Resend** (cleanest API) or **Postmark**. Templates in `apps/api/emails/` via `react-email`. Web push later. | Don't ship the reservation feature without this — the provider currently has no way to know. |
| **Image moderation** | Cloudflare AI Workers (`@cf/openai/clip-vit-base-patch32` or NSFW filter) on upload. Fail-closed (reject if check fails). | Community platforms get abused fast. |
| **Bot protection** | **Cloudflare Turnstile** on signup and password reset. Free. Drop-in. | Community apps get spammed. |
| **GDPR-adjacent** | `DELETE /v1/users/me` (hard delete with cascade), `GET /v1/users/me/export` (zipped JSON of all the user's data). | Now is the cheap moment. |
| **Observability** | Sentry SDK in `apps/web` and `apps/api`; structured JSON logs via `pino` shipped to Better Stack. | Don't ship without this. |
| **Rate limiting** | Beyond `/auth`: `POST /v1/exchange-items` (10/hr/user), image upload (20/hr/user), `PUT /v1/exchange-items/:id/reserve` (30/hr/user), `POST /v1/messages` (60/min/user). All keyed in Redis. | |
| **PWA basics** | `apps/web/public/manifest.json`, icons, simple service worker (Workbox precaching of the shell). Adds "Install" prompt on mobile. | ~30 lines of config; large UX win for a mobile-first app. |

#### H. Operational additions

- **Backup + rollback for the `data.json` / `reserved.json` deletion** (v1 §1.8): before deletion, diff `data.json` rows against MySQL `exchange_items`. Log any rows present in the JSON but missing from MySQL. Migrate those rows into MySQL first; only then delete the JSON files. Document the rollback (re-create JSON from `SELECT *`) in `tasks/`.
- **Image dedup logic moves into the storage layer** — object key is `sha256(content).webp`; the deduplication is implicit (R2 is content-addressable when keyed this way). Drop the `fs.readdirSync(UPLOADS_DIR).find(...)` scan from `exchangeController.js:118`.
- **oklch over HSL** for the design tokens — perceptual lightness gives consistent contrast in both themes. The v1 §2.2 HSL table should be rewritten in `oklch(l c h)` form (Tailwind v4 supports it natively). The tokens themselves don't change shape, only the color space.

### Revised timeline — 8–10 weeks (was 5)

The v1 5-week estimate did not account for: search, geo, notifications, moderation, PWA, OpenAPI generation, idempotency, refresh-token rotation, VPS bootstrap, backup drill, observability wiring, or production debugging iteration. Realistic estimate: **8–10 weeks for 1–2 engineers**, including bake time. If aggressive cutover is required, drop the redesign to weeks 9–10 and ship the typed/secured backend + a minimally-restyled frontend first.

### Revised week-by-week roadmap (supersedes v1 §PHASE 3)

| Week | Theme | Deliverables |
|---|---|---|
| **1** | **Quick wins + monorepo bootstrap.** | Day-1 fixes from the Quick-Win Checklist; pnpm + Turborepo skeleton; `tsconfig.base.json`; Playwright smoke spec covering current behavior. |
| **2** | **VPS & infra spike** (in parallel with Week 1 if 2 engineers). | Hetzner box provisioned; Caddy + Compose + Postgres + Redis + Coolify running; staging environment reachable; Sentry + Uptime Kuma wired; pg_dump cron + first restore drill. |
| **3** | **Typed backend core.** | Drizzle schema (Postgres if chosen, with `drizzle-kit introspect` from MySQL); `apps/api` skeleton: helmet, rate-limit, RFC 7807 errors, `/v1` mounting, OpenAPI gen from Zod; ported auth routes with JWT issuer behavior; refresh tokens in Redis. |
| **4** | **Typed backend features.** | All CRUD routes ported under `/v1` with cursor pagination, idempotency keys, multer + sharp + R2 upload; **kill `data.json`/`reserved.json`** (with the diff-and-migrate step from §H); legacy backend retired. |
| **5** | **Auth.js + Next.js skeleton.** | `apps/web` scaffolded; Auth.js v5 wired with Google + GitHub providers; tokens issued match the JWT contract from §C; design tokens (oklch) and `ThemeToggle` shipped; mobile bottom-tab and top header in both themes. |
| **6** | **Page migration (part 1).** | Home (server component, FTS-backed search), Photo detail, Login/Signup with Turnstile, Profile. All accessible (axe pass), keyboard-friendly. |
| **7** | **Page migration (part 2) + messaging.** | Exchanges page (with optimistic reserve), Messages with real backend (replace the hard-coded conversations in `MessagesPage.jsx:7-83`), Saved, Reservation confirmed. Email notifications via Resend on reserve. |
| **8** | **Search + geo + moderation.** | Postgres FTS index + ranked results; postal-code-based filtering on listing endpoint; image moderation on upload; data-export + account-deletion endpoints. |
| **9** | **PWA, a11y audit, perf, visual regression.** | Manifest + service worker; Lighthouse budgets in CI (LCP < 2.5s, CLS < 0.05); Playwright `toHaveScreenshot` baselines for both themes; load-test the reserve + upload paths. |
| **10** | **Production cutover.** | DNS flip; old repos archived; runbook for restore/rollback/secret-rotation written into `tasks/`; quarterly restore drill scheduled. |

### Net additions checklist (so nothing falls through)

- [ ] `/v1` prefix on every route from the first commit
- [ ] `@asteasolutions/zod-to-openapi` integrated; `GET /v1/openapi.json` live
- [ ] RFC 7807 error handler is the **only** error response shape
- [ ] Cursor pagination on every list endpoint
- [ ] `Idempotency-Key` accepted on every POST/PUT that mutates state
- [ ] JWT claims OIDC-standard only; no app-specific fields
- [ ] Refresh tokens in Redis with revocation by key delete
- [ ] Hetzner box + Caddy + Compose + Coolify provisioned in week 2
- [ ] R2 bucket + sharp pipeline replaces local `uploads/`
- [ ] Postgres FTS index over `provider`, `service`, `description`
- [ ] `users.postal_code`, `users.latitude`, `users.longitude` columns
- [ ] Resend (or Postmark) wired; email on reserve + new-message
- [ ] Cloudflare AI image moderation on upload
- [ ] Cloudflare Turnstile on signup + password-reset
- [ ] `DELETE /v1/users/me` and `GET /v1/users/me/export`
- [ ] Sentry SDK in both apps; pino → Better Stack
- [ ] Rate limits beyond auth (item create, upload, reserve, messages)
- [ ] `manifest.json` + service worker (Workbox precaching)
- [ ] `data.json` → MySQL diff-and-migrate documented before deletion
- [ ] Quarterly pg_dump restore drill on the calendar

---

## v3 Addendum (2026-05-12) — Authentik + Postgres locked in

> This addendum **supersedes** §C (Auth.js choice) and §F (MySQL flexibility) in the v2 addendum. Everything else in v2 stands.

### Decisions locked in

1. **Authentik** is the identity provider (self-hosted OIDC) — replaces Auth.js entirely.
2. **Postgres 16** is the database — MySQL fallback removed from the plan.

### What this simplifies vs. v2

| v2 said | v3 says | Why simpler |
|---|---|---|
| Auth.js (Next-coupled) in `apps/web` + JWT verifier in `apps/api` | Authentik container; both `apps/web` and `apps/api` are pure OIDC clients/verifiers | Web has no privileged auth path; mobile and third-party use the identical flow |
| "Design JWT claims OIDC-compatible for future migration" | Already OIDC — no migration to design for | Standard `sub`/`iss`/`aud`/`exp`/`iat`/`email` claims out of the box |
| Postgres recommended; MySQL still works | Postgres committed; Meilisearch fallback removed | One DB, one FTS implementation |
| Auth.js implements OAuth provider flows | Authentik admin UI configures Google / GitHub / Apple / Microsoft / Discord etc. | Add a provider without a deploy |
| Password storage + MFA + account recovery + audit log are app concerns | All handled by Authentik | Removes ~30% of the app's auth code |

### Authentik — concrete topology

```
                  ┌─────────────────────────────────────┐
                  │  Authentik (auth.your-domain.com)   │
                  │  - Hosts OAuth dances to Google/etc.│
                  │  - Issues JWTs (RS256)              │
                  │  - Exposes JWKS endpoint            │
                  │  - Admin UI for provider config     │
                  └──────────────┬──────────────────────┘
                                 │  OIDC (auth code + PKCE)
        ┌────────────────────────┼──────────────────────────┐
        │                        │                          │
┌───────▼────────┐    ┌──────────▼────────┐    ┌────────────▼──────────┐
│ apps/web       │    │ Mobile native     │    │ Third-party integrator│
│ (Next.js)      │    │ (iOS / Android)   │    │ (client credentials   │
│ confidential   │    │ public client     │    │  OR auth code)        │
│ client         │    │ PKCE via system   │    │                       │
│                │    │ browser           │    │                       │
└───────┬────────┘    └─────────┬─────────┘    └──────────┬────────────┘
        │                       │                         │
        │  Authorization: Bearer <access_token>           │
        └───────────────────────┴─────────────────────────┘
                                │
                  ┌─────────────▼──────────────┐
                  │  apps/api (api.your-       │
                  │  domain.com)               │
                  │  - Validates JWT vs JWKS   │
                  │  - Resolves sub → user row │
                  │  - No password / OAuth     │
                  │    code anywhere           │
                  └────────────────────────────┘
```

### Authentik setup checklist (week 2 work)

- [ ] Add Authentik server + worker to the Compose stack with a **dedicated** `authentik-postgres` container (decided 2026-05-12; isolates Authentik upgrade/restore from app DB).
- [ ] Provision `auth.your-domain.com` in Caddy with auto-TLS.
- [ ] Create three Applications in Authentik:
  - `e-sharevice-web` — confidential client; auth code + PKCE; redirect `https://app.your-domain.com/api/auth/callback`
  - `e-sharevice-mobile` — public client; auth code + PKCE; redirect URIs registered per platform (custom scheme `esharevice://auth/callback`)
  - `e-sharevice-api-partners` — confidential client; client credentials flow (one entry per third-party integrator later)
- [ ] Configure providers under **Directory → Federation & Social Login**: **Google + GitHub** for v1 (Apple deferred until mobile app exists — requires paid Apple Developer account).
- [ ] Enable Authentik's **built-in password provider** (email + password) alongside OAuth — decided 2026-05-12. Users get both sign-in paths; password storage, MFA, and recovery all handled by Authentik.
- [ ] Set token lifetimes: access 15m, refresh 30d (rotating).
- [ ] Map claims: `openid`, `profile`, `email`, plus a custom `groups` scope if RBAC is on the roadmap (no app-specific claims beyond standard ones).
- [ ] Export JWKS URL → `apps/api` reads it via `process.env.OIDC_JWKS_URL=https://auth.your-domain.com/application/o/e-sharevice-web/jwks/`.
- [ ] Enable Authentik's built-in audit log (free, persistent) for sign-ins, MFA, and admin actions.

### `apps/api` — auth becomes ~30 lines

Replaces the JWT-verifier section of v2 §C. The API has no signing key, no OAuth code, no password handling — it just verifies tokens.

```ts
// apps/api/middleware/auth.ts
import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS = createRemoteJWKSet(new URL(process.env.OIDC_JWKS_URL!));

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).type("application/problem+json").json({
      type: "https://your-domain.com/errors/unauthenticated",
      title: "Unauthenticated", status: 401,
    });
  }
  try {
    const { payload } = await jwtVerify(header.slice(7), JWKS, {
      issuer: process.env.OIDC_ISSUER,        // https://auth.your-domain.com/application/o/e-sharevice-web/
      audience: process.env.OIDC_AUDIENCE,    // the client_id
    });
    // Resolve to local user row (sub is the stable Authentik user ID).
    // Provision the row lazily on first sight: if no row, INSERT it.
    req.user = await resolveUserFromSub(payload.sub!, payload.email as string);
    next();
  } catch (err) {
    res.status(401).type("application/problem+json").json({
      type: "https://your-domain.com/errors/invalid-token",
      title: "Invalid or expired token", status: 401,
    });
  }
}
```

That's the entire auth layer of the API. No bcrypt. No JWT signing. No password reset routes. No OAuth callback. Authentik owns all of it.

### `apps/web` — Next.js OIDC client

Auth.js is removed from the dependency list. Two viable approaches:

| Approach | Stack | When to pick |
|---|---|---|
| **Direct OIDC** (recommended) | `oauth4webapi` (12 KB, no deps) — handcrafted auth route handlers in `app/api/auth/*` for `/login`, `/callback`, `/logout`, `/refresh` | Most control; small; aligns with the API's posture |
| **`next-auth` with the generic OIDC provider** | `next-auth` v5 with `Providers.GenericOAuth` pointing at Authentik | Trade some control for less code, *only if* you want the `useSession()` hook ergonomics |

Recommend direct OIDC. Total code ~150 lines across the four route handlers, plus an `auth()` helper that reads the session cookie and validates the JWT.

Web token storage: refresh token in HttpOnly + Secure + SameSite=Lax cookie (server-side rotation on `/api/auth/refresh`); access token sent as `Authorization: Bearer` to `apps/api`. Server components on first paint use the refresh cookie + a short server-side fetch to get a fresh access token.

### Postgres lock-in — concrete consequences

| Layer | Change |
|---|---|
| Schema | Drizzle Postgres dialect throughout. Use `citext` for `users.email` — removes the `whereRaw('LOWER(email) = ?')` pattern from `authController.js:15,36,71`. |
| Bootstrap from existing data | `drizzle-kit introspect` against the existing MySQL DB to generate a starting schema, then port column types (`int unsigned` → `integer`, `tinyint(1)` → `boolean`, `varchar(N)` → `text` unless length matters, `timestamp` → `timestamptz`). |
| Migrate existing data | One-shot `pgloader` job from MySQL → Postgres (an hour of work for a schema this small). Run during week 4's "kill dual persistence" step so it's a single data-move. |
| Search | `ALTER TABLE exchange_items ADD COLUMN search tsvector GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(provider,'')),'A') \|\| setweight(to_tsvector('english', coalesce(service,'')),'B') \|\| setweight(to_tsvector('english', coalesce(description,'')),'C')) STORED; CREATE INDEX exchange_items_search_idx ON exchange_items USING GIN(search);` Query with `WHERE search @@ websearch_to_tsquery('english', $1)` ordered by `ts_rank`. |
| JSONB | Use for `messages.metadata` (read receipts, attachments) and `exchange_items.tags` when those land. |
| Time | All timestamps `timestamptz` (not `timestamp`) — eliminates the UTC ambiguity in the current `moment().format('YYYY-MM-DD HH:mm:ss')` calls. |
| Cascades | `ON DELETE CASCADE` for `exchange_items.user_id` (matches current Knex migration), `ON DELETE SET NULL` for `reserved_by` (also matches). |
| PostGIS | Not enabled in v1. If geo filtering becomes serious, `CREATE EXTENSION postgis` later and add a `geography(Point, 4326)` column to `users`. |

### Stack diff vs. v2

**Added containers** in `docker-compose.yml`: `authentik-server`, `authentik-worker`. Optionally a dedicated `authentik-postgres` (recommend dedicated).

**Removed from `apps/web`:**

```
- next-auth         (Auth.js)
- bcrypt            (no password handling in app code anymore)
```

**Removed from `apps/api`:**

```
- bcrypt
- jsonwebtoken      (replaced by `jose` which is smaller + JWKS-native)
- mysql2
+ pg
+ jose
```

**Removed from `packages/shared`:** the password-related Zod fields (`password: z.string().min(8)`) — those live in Authentik now. `SignupBody` / `LoginBody` schemas are deleted; the only "signup" the app sees is the lazy user-row provisioning in the JWT middleware (resolve-by-sub-or-insert).

### Roadmap deltas (supersedes the relevant rows in v2's revised roadmap)

| Week | What changes |
|---|---|
| **2** | Add Authentik to the Compose stack; provision `auth.your-domain.com`; configure Google + GitHub providers; test the auth-code-with-PKCE round trip from a curl client. |
| **3** | The auth subsystem of `apps/api` collapses to the `jose`-based middleware above. No password routes, no `/auth/login`, no `/auth/signup`. The only new code is the lazy `resolveUserFromSub` helper that upserts a local row on first sight of a new `sub`. |
| **4** | Postgres-FTS index added to `exchange_items` during the data migration. Single `pgloader` run moves MySQL → Postgres. JSON files (`data.json`, `reserved.json`) deleted after diff-and-migrate. |
| **5** | `apps/web` skeleton uses `oauth4webapi` for `/api/auth/{login,callback,logout,refresh}` handlers. Theme + design tokens unchanged from v2 §2.7 (still oklch). No Auth.js. |
| **6** | Login/Signup page is now just a "Continue with Google / GitHub / Apple" screen — no email/password form at all (or, if you want classic password login as a fallback, configure Authentik's built-in password provider and use its hosted login UI). |

### Net adds to the "nothing falls through" checklist

- [ ] Authentik containers in Compose (server + worker, dedicated Postgres recommended)
- [ ] `auth.your-domain.com` in Caddy with auto-TLS
- [ ] Three Authentik Applications provisioned (web confidential, mobile public, partners confidential)
- [ ] OAuth providers (Google/GitHub/Apple/etc.) configured in Authentik admin UI
- [ ] `OIDC_JWKS_URL`, `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` added to `.env.example`
- [ ] `apps/api` auth = single `jose` JWKS-verifying middleware; no password code anywhere
- [ ] `apps/web` auth = `oauth4webapi` + four route handlers (login/callback/logout/refresh)
- [ ] Postgres locked in; `pgloader` job written and tested against a copy of the dev DB
- [ ] `citext` extension enabled; `email` columns rewritten to `citext`
- [ ] FTS column + GIN index on `exchange_items.search`
- [ ] All timestamps as `timestamptz`
- [ ] Authentik audit log enabled and retained
- [ ] Authentik backup folded into the pg_dump cron (its Postgres DB ships with the rest)

### Open questions — resolved (2026-05-12)

1. **Authentik database** → **Dedicated `authentik-postgres` container.** Isolated failure domain; Authentik upgrades don't risk the app DB; backup/restore happens independently.
2. **Email-password fallback** → **Yes, alongside OAuth.** Authentik's built-in password provider is enabled. Login screen shows Google + GitHub buttons *plus* an email/password form, all backed by Authentik (the app never touches passwords).
3. **Apple Sign-In** → **Deferred until the mobile app exists.** Reconsider when the iOS client is being built (requires $99/yr Apple Developer account and adds a non-trivial entitlement/provisioning step).

---

# e-Sharevice — Codebase Analysis & TypeScript / Redesign Plan

> **Scope:** Full audit of `Repo/e-Sharevice` (frontend) and `Repo/e-Sharevice-backend` (backend), followed by a concrete migration + redesign plan.

---

## 0. Executive Summary of Current State

**e-Sharevice is a community skill / item exchange app.** Two separately-cloned Git repositories sit side-by-side under `Repo/`:

| Repo | Stack (observed) | Health |
|---|---|---|
| `e-Sharevice` (frontend) | React 18, Vite 5, **plain JS/JSX**, SCSS w/ partials, react-router-dom v6, axios, AuthContext via localStorage | Functional, but design is collage-level coherent and JS-only |
| `e-Sharevice-backend` | Node.js ESM, **Express 4**, Knex 3 + MySQL2, JWT, bcrypt, multer, dual JSON-file persistence (`data.json` / `reserved.json`) alongside the DB | Works, but has real data-integrity, security, and consistency issues |

**Key architectural truths (from reading source, not assumptions):**

- **Two parallel persistence layers.** Every exchange item is written to MySQL *and* to `data.json` (and reservations to `reserved.json`). Sync is manual via `syncDataJson()` and `appendReservedFile()`. `node-cron` is imported but the scheduled task is commented out, so drift between MySQL and the JSON files is inevitable. Worse, the public endpoint `GET /sample-data` reads `data.json` (with fully-qualified `imgSrc` URLs), while `GET /exchange-items` reads MySQL (and prepends host at request time). These two reads of the same logical data can diverge.
- **Inconsistent auth on read endpoints.** `GET /exchange-items` requires JWT and scopes by `user_id`, but `GET /exchange-items/:id` is *unauthenticated* — anyone with a numeric ID can fetch any item, including reservation metadata.
- **CORS is wide open.** `cors({ origin: '*' })`. No `helmet`, no rate limiting, no request size cap; `helmet` is in `package.json` but never `app.use(helmet())`'d.
- **Frontend `package.json` is contaminated.** It declares `socket.io`, `cors`, `dotenv`, `node` (`^22.4.0`), `node-module`, and `node-modules` — none belong in a Vite frontend. `node-module` and `node-modules` are well-known typosquat / spam packages: supply-chain risk.
- **No tests, no CI, no Dockerfile, no production deploy config.**
- **No TypeScript anywhere.** `@types/react` is installed but unused; the codebase is `.jsx` and `.js`.
- **Design is pre-iOS-pastiche.** SF Pro `.otf` font files are bundled (license question), the palette is a collage of seven named blues + a recycle green + Khaki, focus rings are missing, touch targets are below 48 px, asset paths like `/src/assets/...` are hard-coded into JSX (these break in production builds — Vite requires `import` or `/public/`).
- **Direct state mutation.** `MessagesPage.jsx:118` does `selectedConversation.messages.push(newMsg)` — mutating React state in place.
- **Dual fetch on Homepage.** `App.jsx` fetches `/sample-data` on mount, then `Homepage.jsx` refetches the same endpoint on mount; both write to `setPhotoCards`.
- **Light theme only.** No CSS custom properties, no `prefers-color-scheme`, no theme toggle.

---

## PHASE 0 — Codebase Deep Analysis

### 0.1 File / module inventory

**Frontend (`e-Sharevice/`):**

```
e-Sharevice/
├── index.html                              # minimal: only viewport meta, no theme-color, no OG
├── vite.config.js                          # plain react() only; no aliases, no env validation
├── .eslintrc.cjs                           # react/recommended; no a11y, no import-order
├── package.json                            # 13 deps incl. 5 spurious (socket.io, cors, dotenv, node, node-module, node-modules)
└── src/
    ├── main.jsx                            # ReactDOM.createRoot + StrictMode
    ├── App.jsx                             # Router + AuthProvider + 8 routes; fetches photo cards
    ├── App.scss                            # ALL CONTENT IS COMMENTED OUT — dead file
    ├── contexts/AuthContext.jsx            # localStorage user+token; no expiry handling
    ├── utils/axios.js                      # adds Authorization header from localStorage
    ├── styles/partials/
    │   ├── _variables.scss                 # 13 named colors, 3 SF Pro font stacks, 3 breakpoints
    │   ├── _fonts.scss                     # @font-face for bundled SF Pro .otf files
    │   ├── _globals.scss                   # body bg/color hard-coded, no CSS vars
    │   ├── _mixins.scss                    # responsive-padding, respond-to, font-style; uses invalid `font-weight: semibold`
    │   ├── _layout.scss
    │   └── index.scss                      # entry barrel
    ├── components/                         # 17 SCSS-paired components (Header, Footer, NavMenu, PhotoCard, Avatar, Buttons, Modal x5, Skeleton, InputField, MessageInput, ReserveBar, ReservationSummary, AvatarMenu, HorizontalNavbar, ProfileAvatar, ProtectedComponent, ProtectedRoute)
    └── pages/                              # 8 page components: Homepage, Profile, LoginPage, SavedPage, MessagesPage, ExchangePage, PhotoCardDetailPage, ReservationConfirmedPage, NotFoundPage
```

**Backend (`e-Sharevice-backend/`):**

```
e-Sharevice-backend/
├── index.js                                # Express entry, 4 route groups mounted at '/'
├── authMiddleware.js                       # JWT verify
├── fileUtils.js                            # callback-style read/write/append on data.json & reserved.json — NOT atomic
├── syncDataJson.js                         # mirrors MySQL → data.json
├── knexfile.js                             # mysql2; no env validation
├── data.json                               # CHECKED IN, 7039 bytes — PII risk (user-generated content live in repo)
├── reserved.json                           # CHECKED IN
├── controllers/
│   ├── authController.js                   # checkEmail / register / login — 1-hour JWT, no refresh
│   ├── userController.js                   # returns req.user verbatim (incl. iat/exp)
│   ├── exchangeController.js               # CRUD + reserve; mixes DB writes with file writes
│   └── sampleDataController.js             # SELECT * FROM exchange_items (host NOT prepended → broken image URLs via this path)
├── routes/                                 # auth, exchange, sampleData, user — all mounted at '/'
├── migrations/20240713050145_create_db_tables.js
├── seeds/seed_all.js
├── uploads/                                # multer destination, served via express.static
├── backup/                                 # OLD migration & seed files committed alongside new ones
└── .env.sample                             # PORT, DB_*, JWT_SECRET
```

### 0.2 Concrete issues (severity-ranked, every one observed)

#### Critical

1. **Unauth read of any exchange item.** `routes/exchange.js:34` — `router.get('/exchange-items/:id', getExchangeItemById)` has no `authenticateToken`. Detail page is reachable by ID alone.
2. **Dual persistence drift.** `data.json` & `reserved.json` are written by route handlers; the cron sync is commented (`index.js:55-59`). `/sample-data` reads the file, `/exchange-items` reads MySQL. The two diverge on every restart or non-atomic crash. `fileUtils.writeDataFile` is not atomic (no `.tmp` + rename), so a crash mid-write corrupts the file (matches `[State] Corrupted Persistence File After Crash` in `CLAUDE.md`).
3. **CORS wide open + no helmet/rate-limit.** `index.js:26-30` accepts `origin: '*'`. `helmet` is installed but never used.
4. **Typosquat dependencies in frontend.** `node-module`, `node-modules`, and a literal `"node": "^22.4.0"` runtime package in `dependencies`. These should be ripped out before any further build is shipped.
5. **Direct React state mutation.** `MessagesPage.jsx:118` — `selectedConversation.messages.push(newMsg)`. Survives the current UI only because the next setState somewhere triggers a re-render; will silently break under React 19 / concurrent rendering.
6. **`data.json`/`reserved.json` checked into git.** PII (users' provider names, descriptions) is in version control history. Per `CLAUDE.md → [Build] Log or Output Directories Committed`, this is a documented antipattern.

#### High

7. **JWT in localStorage.** XSS-readable; no refresh token; 1-hour expiry forces user-visible re-login.
8. **Multer accepts any MIME, any size.** `routes/exchange.js:29` — no `fileFilter`, no `limits`. DoS via huge upload, malicious file storage.
9. **`getSampleData` returns `imgSrc` without host prefix.** `controllers/sampleDataController.js:9` returns raw `/uploads/...` from the DB. The frontend treats it as a full URL → broken image in any environment served via this path. The current app works only because the `data.json`-backed `/sample-data` route (`routes/sampleData.js`) is the one wired in `index.js`, *not* the controller. There are two same-name endpoints in different files.
10. **Hard-coded asset paths in JSX.** `src="/src/assets/images/avatar.png"` (MessagesPage, Profile) — Vite does not rewrite these on build; production breaks.
11. **No global Express error handler.** Any synchronous throw outside a try/catch crashes the process. Matches `[Error Handling] No Global Unhandled Rejection Handler`.
12. **Duplicate `/sample-data` fetch.** App.jsx fires it on mount; Homepage.jsx fires it again on mount when `photoCards.length === 0`. Two network round-trips on every first load.
13. **`getActiveClass` only compares exact pathname** (`NavMenu.jsx:33-34`) — no nested-route highlighting.
14. **`fetchExchangeItems` swallows errors silently** (`ExchangePage.jsx:37-39`) — sets empty array, no toast, no retry. Matches `[Error Handling] Swallowed Exceptions in Batch / Loop`.

#### Medium

15. **No env validation.** `process.env.JWT_SECRET` undefined causes silent token-verification failure; backend will accept missing secret. Matches `[Environment] NODE_ENV / Runtime Environment Not Set`.
16. **Mixed SCSS module systems.** `NavMenu.scss` uses `@import`, others use `@use`. Sass `@import` is deprecated for removal.
17. **Invalid `font-weight: semibold`** in `_mixins.scss:101` and `font-weight: heavy` in `_mixins.scss:106` — both fall back to `normal`. Real visual bug.
18. **Two icon libraries shipped.** `react-icons` + `@fortawesome/*` = wasted bundle.
19. **`react-datepicker` declared but unused** — `LoginPage` uses a plain `<input type="text">` for birth date.
20. **No keyboard/a11y on click handlers.** Cards, list items, avatars are `<div onClick>` with no `role`, `tabIndex`, or keyboard handler.
21. **`window.innerWidth` JS-based responsive branching** in `MessagesPage` — fragile vs. CSS-only responsive layout.
22. **`Routes` references `LoginPage` with `onClose` / `intendedDestination` props** but never passes them — they're always `undefined` at runtime.

#### Hygiene / cleanup

23. `App.scss` is 100% commented out — delete it.
24. `package.json` includes literal `"node"` and `"fs": "^0.0.1-security"` (a security stub) — remove.
25. `backup/` folder of old migrations checked in — confusing; move to git tags.
26. `Buttons` component takes `color` / `hoverColor` / `borderRadius` / `padding` as inline string props — bypasses any theming.
27. README is generic; `setup.md` only covers `npm install` / `npm run dev`.

### 0.3 Mobile-friendliness gaps (vs. Hostinger best-practice checklist)

| Hostinger best practice | Current state | Gap |
|---|---|---|
| Viewport meta tag | present, basic | OK; missing `viewport-fit=cover` for iPhone notch |
| Mobile-first responsive breakpoints | desktop-first via `@media (min-width: ...)` in some places, mobile-max in others | Inconsistent — `_mixins.scss` `respond-to` uses max-width for mobile |
| Touch targets >= 48x48 px | Nav icons 24x24, items packed via `space-around`; share icon overlays photo with no padding | Fails |
| Legible font sizes (>=14 px on mobile) | `headline`/`body` mixins use 13 px | Fails minimum |
| Avoid intrusive interstitials | none observed | OK |
| Fast loading / minimal JS | ships `socket.io` client + 2 icon libs + `node-module` typosquats | Fails |
| Image optimization / lazy loading | raw `<img>`, no `loading="lazy"`, no `width`/`height` (CLS hit) | Fails |
| No horizontal scroll | HorizontalNavbar may overflow but isn't explicitly clipped | Manual check needed |
| Bottom-tab navigation (mobile-first) | `NavMenu` is a bottom bar | Good — keep this pattern |

---

## PHASE 1 — TypeScript Migration Plan

### 1.1 Target stack (and why)

| Layer | Today | Recommended | Why |
|---|---|---|---|
| Repo layout | Two sibling Git repos | **pnpm + Turborepo monorepo** (`apps/web`, `apps/api`, `packages/shared`, `packages/ui`) | One install, one CI, one tsconfig base; shared Zod schemas without npm-publishing |
| Frontend framework | Vite 5 + React 18 + JSX | **Next.js 15 (App Router) + React 19 + TypeScript** | Server components, route-level data fetching, image optimization (`next/image`), middleware-based auth, free Lighthouse wins. Vite is fine but Next eliminates a custom server *and* gives mobile-perf primitives for free |
| Styling | SCSS partials | **Tailwind CSS v4 + CSS variables** (`@theme`) | Variables enable dark/light themes; mobile-first by default; removes the SF Pro `.otf` legal risk; ends the inconsistent `@use`/`@import` mix |
| Component primitives | Hand-rolled (Modal x5, InputField, Buttons) | **shadcn/ui (Radix under the hood)** | Accessible focus rings, ARIA, dialog focus-trap — out of the box |
| Backend framework | Express 4 (JS) | **Express 5 (TS) + Zod** for input validation (keep close to current shape), *or* **tRPC** (recommended) if the only consumer is the Next.js frontend | tRPC gives end-to-end types with no separate OpenAPI gen; Express 5 if you anticipate non-Next clients |
| ORM | Knex (untyped) | **Drizzle ORM** | Schema-as-TS, migrations as TS, generated types; Knex migrations migrate to Drizzle with minimal pain. (Prisma is also good; Drizzle wins for raw SQL parity with current Knex code.) |
| Auth | Hand-rolled JWT in localStorage | **Auth.js (NextAuth) v5** with credentials + session cookies (HttpOnly, SameSite=Lax) | Kills the XSS risk of localStorage tokens; gives session refresh; first-class TS |
| File uploads | Multer -> local `uploads/` | **`multer` (typed)** for dev, **S3/R2 presigned URLs** for prod | Removes server-side disk dependency; durable storage |
| Image dedup | sha256 hash filename | Keep, but write into `objectKey` in DB; use `next/image` for delivery | Same idempotency, better delivery |
| Real-time chat | `socket.io` declared, never used | **Pusher / Ably / Liveblocks (managed)** when chat is real, otherwise polling | Don't pay for socket infra you don't have |
| Validation | Manual `if (!field) return 400` | **Zod** schemas shared across web <-> api in `packages/shared` | Single source of truth |
| Testing | None | **Vitest** (unit) + **Playwright** (e2e smoke) | Vitest reuses Vite config |
| Lint/format | ESLint only | **ESLint + `@typescript-eslint` + Prettier + `eslint-plugin-jsx-a11y`** | A11y enforcement is non-negotiable for redesign |
| CI | None | **GitHub Actions**: typecheck + lint + e2e + Lighthouse CI on PRs | |

### 1.2 Monorepo layout (final state)

```
e-sharevice/
├── package.json                # pnpm workspaces root, scripts: dev/build/lint/typecheck
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── .env.example                # consolidated; documents EVERY var
├── apps/
│   ├── web/                    # Next.js 15 (App Router, TS)
│   │   ├── app/
│   │   ├── components/
│   │   ├── lib/
│   │   └── package.json
│   └── api/                    # Express 5 + Drizzle OR removed entirely if all-in on Next route handlers
│       └── package.json
├── packages/
│   ├── shared/                 # Zod schemas + TS types; import from both apps
│   │   ├── schemas/
│   │   │   ├── user.ts
│   │   │   ├── exchange-item.ts
│   │   │   └── auth.ts
│   │   └── index.ts
│   ├── db/                     # Drizzle schema + migrations + client
│   │   ├── schema.ts
│   │   ├── migrations/
│   │   └── index.ts
│   └── ui/                     # shadcn/ui-derived primitives (Button, Input, Dialog, Card, ThemeToggle)
└── .github/workflows/ci.yml
```

### 1.3 Strict-mode `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "preserve",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "allowJs": true,
    "checkJs": false,
    "incremental": true,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["packages/shared/src/*"],
      "@db/*": ["packages/db/src/*"],
      "@ui/*": ["packages/ui/src/*"]
    }
  },
  "exclude": ["node_modules", "dist", ".next"]
}
```

Per-app `tsconfig.json` extends this and re-adds Next/Express-specific options.

Migration knob: start with `"allowJs": true, "checkJs": false`. Flip `checkJs` to `true` once 80% of files are `.ts(x)`, then drop `allowJs` once 100%.

### 1.4 Incremental migration — file-by-file priority order

The principle: **types flow inward.** Migrate leaves first (pure utilities, types), then schema/contracts, then handlers, then components, then pages.

| Order | File(s) | Why first |
|---|---|---|
| 1 | `packages/shared/schemas/*.ts` (new) — `User`, `ExchangeItem`, `Reservation`, `LoginRequest`, `SignupRequest` | Single source of truth |
| 2 | `packages/db/schema.ts` (new) — Drizzle equivalents of the Knex migration in `20240713050145_create_db_tables.js` | Typed DB access |
| 3 | `e-Sharevice/src/utils/axios.js` -> `apps/web/lib/api.ts` (typed fetch wrapper, no axios) | Pure leaf |
| 4 | `e-Sharevice-backend/authMiddleware.js` -> `apps/api/middleware/auth.ts` (or Next middleware) | Single small file |
| 5 | `e-Sharevice-backend/fileUtils.js` -> **deleted** (replaced by atomic Drizzle writes; dual persistence retired) | Removes a bug class |
| 6 | `controllers/authController.js` -> `apps/api/routes/auth.ts` with Zod-validated bodies | Auth must be solid before everything else |
| 7 | `controllers/userController.js`, `controllers/sampleDataController.js`, `controllers/exchangeController.js` | Typed CRUD |
| 8 | `routes/*.js` -> typed Express Routers (or tRPC procedures) | |
| 9 | Frontend `contexts/AuthContext.jsx` -> `apps/web/lib/auth.ts` using Auth.js session hook | Replaces localStorage JWT |
| 10 | Shared components (Button, Input, Modal, Avatar, Header, Footer, NavMenu) — `.jsx` -> `.tsx` | Used everywhere — type-first |
| 11 | Pages — Homepage, PhotoCardDetailPage, ExchangePage, MessagesPage, Profile, LoginPage, SavedPage | Largest blast radius last |
| 12 | Final pass: enable `checkJs` then delete `allowJs` | |

### 1.5 Side-by-side coexistence rules

- **Same import graph, two file types.** `allowJs: true` lets `.tsx` import `.jsx` and vice-versa for the duration of the migration.
- **Single PR per area.** No mega-PRs — one component or one route at a time.
- **Lockstep `pnpm typecheck` in CI** from day one; must stay green on every PR.
- **Smoke e2e tests must stay passing** for: login, signup, create exchange item, reserve item, view exchange detail, log out. Playwright spec for each before migration starts. Migrations are reverted if any smoke fails.

### 1.6 Validation & errors — replace ad-hoc checks with Zod

Today (`authController.js:31`):

```js
if (!first_name || !last_name || !normalizedEmail || !password) {
  return res.status(400).json({ error: 'All fields are required' });
}
```

After:

```ts
// packages/shared/schemas/auth.ts
import { z } from "zod";
export const SignupBody = z.object({
  first_name: z.string().min(1).max(80),
  last_name:  z.string().min(1).max(80),
  email:      z.string().email().toLowerCase(),
  password:   z.string().min(8).max(200),
});
export type SignupBody = z.infer<typeof SignupBody>;
```

```ts
// apps/api/routes/auth.ts
router.post("/signup", async (req, res, next) => {
  const parsed = SignupBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  // ...
});
```

Both apps import `SignupBody` — the client form can call `SignupBody.safeParse(formData)` *before* submit; same validation, zero drift.

### 1.7 Backend security hardening (lands during migration, not after)

Each of these is a one-line fix wrapped into the typed migration:

```ts
import helmet from "helmet";
import rateLimit from "express-rate-limit";

app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(cors({
  origin: process.env.WEB_ORIGIN!.split(","),  // explicit allowlist, no '*'
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
}));
app.use("/auth", rateLimit({ windowMs: 15 * 60_000, max: 50 }));

// multer: 5 MB, image MIME only
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, /^image\/(png|jpe?g|webp|avif)$/.test(file.mimetype));
  },
});

// Global error handler — Express 5 catches async throws natively
app.use((err, req, res, _next) => {
  const status = err.status ?? 500;
  if (status >= 500) console.error(`[ERROR] ${req.method} ${req.path}`, err);
  res.status(status).json({
    error: status === 500 && process.env.NODE_ENV === "production"
      ? "Internal server error"
      : err.message ?? "Something went wrong",
  });
});

// Fix the unauth read: require auth on GET /exchange-items/:id, and scope by user_id or by `public=true` flag.
```

### 1.8 Persistence — kill the dual-write

`data.json` and `reserved.json` go away. The single source of truth becomes the database. `GET /sample-data` becomes `GET /exchange-items?public=true` returning rows with image URLs assembled from `process.env.CDN_BASE_URL`. `appendReservedFile` is deleted. `syncDataJson` is deleted. This single change eliminates the `[State] Corrupted Persistence File After Crash` and the `[State] Stale In-Memory State After Restart` categories at once.

### 1.9 Frontend `package.json` cleanup (do this before anything else)

Remove unconditionally:

```json
"cors", "dotenv", "node", "node-module", "node-modules", "socket.io"
```

`socket.io` (server) is the wrong package for a browser anyway; if real-time chat is real, install `socket.io-client` or migrate to Pusher. `cors` is a server-only middleware. `dotenv` is replaced by Vite's `import.meta.env`. `node-module` and `node-modules` are typosquats — verify with `npm view node-module` and `npm view node-modules` before purging.

### 1.10 Testing strategy during migration

| Layer | Tool | Coverage target |
|---|---|---|
| Pure utils & schemas | Vitest | 100% on `packages/shared` and `packages/db` |
| API routes | Vitest + Supertest | All happy paths + 401/400/404 cases |
| UI components | Vitest + Testing Library | shadcn primitives wrapped + Button + Input + Modal |
| End-to-end smoke | Playwright | login, signup, list, detail, reserve, message-send, logout — runs in CI on every PR |
| Visual regression | Playwright `toHaveScreenshot` on the redesigned pages | Catches design system drift |

---

## PHASE 2 — Redesign Specification (Minimal, Modern, Mobile-First, Dark + Light)

### 2.1 Design principles (the rule book)

1. **One accent color.** All interactive emphasis comes from a single hue. Every other color is a neutral.
2. **No harsh black, no pure white.** Off-black for foreground, soft-white for background.
3. **Generous whitespace, calm density.** 8-px grid; touch targets >= 48 px; reading width capped at 680 px.
4. **Motion is feedback, not decoration.** 150-200 ms ease-out; no parallax, no scroll-jacking; transitions on opacity/transform only.
5. **Type is the design.** Variable font with optical scale; one family, three weights (400/500/700).
6. **Dark and light are equal citizens** — every color, shadow, and border is defined as a token in both themes; no `if (isDark)` branching in components.
7. **Accessible by default.** WCAG AA contrast; visible focus rings; full keyboard navigability; reduced-motion respected.

### 2.2 Color system (HSL tokens)

Light theme (`:root`) and dark theme (`[data-theme="dark"]`):

| Token | Light HSL | Dark HSL | Use |
|---|---|---|---|
| `--bg` | `0 0% 99%` | `220 14% 8%` | Page background |
| `--bg-elevated` | `0 0% 100%` | `220 14% 11%` | Cards, surfaces |
| `--bg-subtle` | `220 14% 96%` | `220 14% 14%` | Input fills, dividers-on-fill |
| `--fg` | `220 14% 10%` | `0 0% 96%` | Primary text |
| `--fg-muted` | `220 9% 40%` | `220 9% 65%` | Secondary text, captions |
| `--fg-subtle` | `220 9% 55%` | `220 9% 50%` | Placeholders, disabled |
| `--border` | `220 14% 90%` | `220 14% 20%` | Hairlines |
| `--border-strong` | `220 14% 78%` | `220 14% 30%` | Focused inputs |
| `--accent` | `168 76% 36%` | `168 64% 52%` | Single accent — calm teal |
| `--accent-fg` | `0 0% 100%` | `220 14% 8%` | Text on accent |
| `--danger` | `0 72% 50%` | `0 80% 65%` | Destructive only |
| `--success` | `145 63% 42%` | `145 60% 55%` | Confirmation only |
| `--ring` | `168 76% 36% / 0.4` | `168 64% 52% / 0.5` | Focus ring |

Why teal: replaces the current `#0e34a0` Egyptian Blue + `#0da64f` recycle green + `#28536b` charcoal — the existing palette had **three** competing accents. One accent is the redesign's most visible improvement.

### 2.3 Typography scale

- **Family:** `Inter` (variable), self-hosted (`@next/font` or `next/font` with `display: 'swap'`). Drop bundled `SF Pro .otf` — Apple's license forbids redistribution outside Apple platforms.
- **Weights:** 400 (regular), 500 (medium), 700 (bold) — no italic, no thin.
- **Scale (mobile-first):**

| Token | Size | Line-height | Letter-spacing | Use |
|---|---|---|---|---|
| `--text-xs` | 12 px | 16 px | 0.01em | Tags, footnotes (desktop only — never below 14 px on mobile) |
| `--text-sm` | 14 px | 20 px | 0 | Captions, secondary body |
| `--text-base` | 16 px | 24 px | -0.005em | Primary body |
| `--text-md` | 18 px | 26 px | -0.01em | Sub-headlines |
| `--text-lg` | 20 px | 28 px | -0.012em | Card titles |
| `--text-xl` | 28 px | 34 px | -0.02em | Section heads |
| `--text-2xl` | 36 px | 42 px | -0.025em | Page titles (clamp to 28 px on mobile) |
| `--text-display` | `clamp(40px, 6vw, 64px)` | 1.05 | -0.03em | Hero only |

### 2.4 Spacing, radii, shadows

- **Grid:** 8-px base; allowed multiples 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96.
- **Radii:** `--radius-sm: 6px`, `--radius-md: 10px`, `--radius-lg: 14px`, `--radius-full: 9999px`. Never sharp corners except dividers.
- **Shadows (light only — dark uses borders instead):**
  - `--shadow-1`: `0 1px 2px hsl(220 14% 10% / 0.04), 0 1px 1px hsl(220 14% 10% / 0.02)`
  - `--shadow-2`: `0 4px 16px hsl(220 14% 10% / 0.06)`
  - Dark theme: `--shadow-1: none; --shadow-2: 0 0 0 1px hsl(220 14% 20%)`

### 2.5 Component spec (selected)

- **Button:** pill or 10-px radius; min-height 44 px (mobile) / 40 px (desktop); 16 px horizontal padding; `--accent` background for primary; `--bg-subtle` for secondary; 1-px `--border-strong` for tertiary. Hover: brightness shift via `color-mix(in oklch, var(--accent), white 8%)`. Focus: 3 px `--ring` outline with 2 px offset. Disabled: 50% opacity, no events. Transition: `background 150ms ease-out`.
- **Input:** floating label OR top-aligned label (pick one — recommend top-aligned for forms with help text). 1-px `--border` bottom only (border-less style); on focus, `--accent` 2-px bottom + label color shift. 48-px height on mobile. No placeholder-as-label.
- **Card:** `--bg-elevated`, `--radius-lg`, `--shadow-1` (light) / 1-px `--border` (dark). 16-px internal padding mobile, 24-px desktop. No hover lift — only a subtle 1.005 scale transform if interactive.
- **Modal / Dialog:** Use Radix Dialog. Backdrop `hsl(220 14% 10% / 0.5)` w/ `backdrop-filter: blur(4px)`. 90vw mobile, max 480 px desktop. Slide-up from bottom on mobile, fade on desktop.
- **NavMenu (mobile bottom tab bar):** 64 px tall + `env(safe-area-inset-bottom)`. 5 items max. 24 x 24 icons inside 48 x 48 tap zones. Active state: `--accent` icon + label; inactive: `--fg-muted`. Animated indicator dot under active item, 200 ms `cubic-bezier(0.32, 0.72, 0, 1)`.
- **Header (mobile):** 56 px; sticky; `--bg/0.85` + `backdrop-filter: blur(12px)`. Logo left, theme toggle + avatar right.
- **Theme toggle:** sun <-> moon icons; toggle stores `theme` in `localStorage`; on mount reads localStorage -> falls back to `prefers-color-scheme`; sets `[data-theme]` on `<html>`. Animate icon crossfade 200 ms.
- **PhotoCard:** Cardless on mobile (just image + caption with 12 px gap); on desktop wrap in `--bg-elevated` card. Image aspect-ratio locked (4/3) to prevent CLS. `loading="lazy"`. Caption: title 16 px medium, subtitle 14 px muted, exchange 12 px accent.
- **Messages list (mobile):** full-width rows, 72 px tall, 44 x 44 avatar, 16 px gap, 1-px `--border` hairline divider. Bubble: max-width 72%, 14-px radius (one corner sharp on the sender side), 12 px padding, `--accent` for own / `--bg-subtle` for other.

### 2.6 Mobile optimization checklist (Hostinger-aligned)

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />`
- `<meta name="theme-color" content="..." media="(prefers-color-scheme: light/dark)" />` (one for each scheme)
- Mobile-first media queries: base styles target mobile; `@media (min-width: 640px)` upgrades to sm; `@media (min-width: 1024px)` to lg. No `max-width:` mobile branches.
- All tap targets >= 48 x 48 (use padding, not icon size).
- Min font 14 px below the `sm` breakpoint; body 16 px.
- `next/image` everywhere; `<img>` only inside dangerous-HTML islands (none).
- Defer non-critical JS (`<Script strategy="lazyOnload">`).
- Bottom tab bar is the primary nav on mobile; on `lg`+ collapse into a top horizontal bar.
- Respect `prefers-reduced-motion: reduce` — disable transforms, keep opacity.
- No layout-shifting fonts (`font-display: swap` + `size-adjust`).
- No horizontal scroll anywhere except explicit chip rows; chip row clipped with `overflow-x: auto; overscroll-behavior-x: contain`.

### 2.7 Theme CSS — concrete tokens snippet

```css
:root {
  --bg: 0 0% 99%;
  --bg-elevated: 0 0% 100%;
  --bg-subtle: 220 14% 96%;
  --fg: 220 14% 10%;
  --fg-muted: 220 9% 40%;
  --fg-subtle: 220 9% 55%;
  --border: 220 14% 90%;
  --border-strong: 220 14% 78%;
  --accent: 168 76% 36%;
  --accent-fg: 0 0% 100%;
  --danger: 0 72% 50%;
  --success: 145 63% 42%;
  --ring: 168 76% 36%;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  color-scheme: light;
}

[data-theme="dark"] {
  --bg: 220 14% 8%;
  --bg-elevated: 220 14% 11%;
  --bg-subtle: 220 14% 14%;
  --fg: 0 0% 96%;
  --fg-muted: 220 9% 65%;
  --fg-subtle: 220 9% 50%;
  --border: 220 14% 20%;
  --border-strong: 220 14% 30%;
  --accent: 168 64% 52%;
  --accent-fg: 220 14% 8%;
  --danger: 0 80% 65%;
  --success: 145 60% 55%;
  --ring: 168 64% 52%;
  color-scheme: dark;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) { /* same dark block */ }
}

* { transition: background-color 200ms ease, border-color 200ms ease, color 200ms ease; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }

body {
  background: hsl(var(--bg));
  color: hsl(var(--fg));
  font-family: var(--font-inter), system-ui, sans-serif;
  font-size: 16px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
```

---

## PHASE 3 — 5-Week Implementation Roadmap

> **Assumption:** 1-2 engineers working in parallel; the app stays deployable at every merge; smoke e2e tests stay green.

### Week 1 — Foundation & Safety Nets

**Goal:** Make the codebase safe to refactor.

| File / folder | Action |
|---|---|
| Root | Convert to pnpm + Turborepo monorepo; create `apps/web`, `apps/api`, `packages/shared`, `packages/db`, `packages/ui` |
| `tsconfig.base.json` | New file (snippet in section 1.3) |
| `e-Sharevice/package.json` | **Remove** `cors`, `dotenv`, `node`, `node-module`, `node-modules`, `socket.io` |
| `e-Sharevice-backend/package.json` | **Remove** `crypto` (npm pkg), `fs`, `react-router-dom`, `passport-github2` (unused), unused `casual` |
| `e-Sharevice-backend/data.json`, `reserved.json` | **Move out of git**; add to `.gitignore`; rotate any PII if needed |
| `.github/workflows/ci.yml` | New: pnpm install -> typecheck -> lint -> Playwright smoke |
| `apps/web/tests/smoke.spec.ts` | Playwright smoke covering: list, login, signup, create exchange, reserve, message-send, logout |
| `apps/web/app/globals.css` | New CSS tokens (snippet in section 2.7), font import via `next/font` (Inter) |
| `apps/web/app/layout.tsx` | Theme bootstrapping (no-flash `<script>` reading `localStorage.theme` before paint) |
| `packages/ui/src/theme-toggle.tsx` | New ThemeToggle (sun/moon) wired to `[data-theme]` |
| `.env.example` (root) | Consolidated; documents `DB_*`, `JWT_SECRET`, `WEB_ORIGIN`, `CDN_BASE_URL`, `NEXTAUTH_SECRET` |

**Deliverable:** App still runs from the new monorepo; one Next.js route renders with both themes working; CI is green.

### Week 2 — Backend Typed Core

**Goal:** Lock the API contract, remove the dual-persistence bug class.

| File | Action |
|---|---|
| `packages/shared/schemas/auth.ts` | Zod `LoginBody`, `SignupBody`, `CheckEmailBody` |
| `packages/shared/schemas/exchange-item.ts` | Zod `ExchangeItemCreate`, `ExchangeItemUpdate`, `ExchangeItem` (response) |
| `packages/db/schema.ts` | Drizzle equivalents of `users` and `exchange_items` (preserves all current columns incl. `reserved`, `reserved_by`, `reserved_at`) |
| `packages/db/migrations/0001_initial.sql` | Generated from Drizzle schema; matches existing Knex migration |
| `apps/api/index.ts` | Express 5 + helmet + rate-limit + explicit CORS allowlist + global error handler |
| `apps/api/middleware/auth.ts` | Typed `authenticateToken` (or switch to Auth.js session cookie verifier) |
| `apps/api/routes/auth.ts` | Rewrite `checkEmail` / `register` / `login` using Drizzle + Zod; add password complexity; remove plaintext PII logs |
| `apps/api/routes/exchange.ts` | Rewrite CRUD + reserve. **Require auth on `GET /:id`.** Multer with size/MIME limits. Drop `appendReservedFile` calls. |
| `apps/api/routes/sample-data.ts` | Replace by `GET /exchange-items?scope=public` returning DB rows with `CDN_BASE_URL` prepended |
| `e-Sharevice-backend/fileUtils.js`, `syncDataJson.js`, `data.json`, `reserved.json` | **Delete** after migration confirms parity |
| `apps/api/tests/auth.spec.ts`, `exchange.spec.ts` | Supertest covering all paths |

**Deliverable:** All API endpoints typed, validated, secured. Old backend deleted. `pnpm typecheck` passes for `apps/api` and `packages/db`.

### Week 3 — Frontend Skeleton & Design System

**Goal:** Build the redesigned shell. No feature pages yet.

| File | Action |
|---|---|
| `apps/web/app/layout.tsx` | Theme bootstrapping, `<Header>`, `<MobileTabBar>`, `<main>`, suspense boundary |
| `apps/web/components/Header.tsx` | New top bar — logo, theme toggle, avatar (replaces `src/components/Header/Header.jsx`) |
| `apps/web/components/MobileTabBar.tsx` | New bottom nav (replaces `NavMenu.jsx`); proper safe-area-inset; >=48 px hit zones; animated active indicator |
| `packages/ui/src/{button,input,label,dialog,card,avatar,skeleton,badge}.tsx` | shadcn/ui-style primitives, fully accessible, themed via tokens |
| `apps/web/app/(public)/page.tsx` | New Home — server component fetches `GET /exchange-items?scope=public`; renders `PhotoCard` grid |
| `apps/web/components/PhotoCard.tsx` | New, uses `next/image`, aspect-ratio locked, hover/focus states |
| `apps/web/lib/api.ts` | Typed fetch wrapper with AbortController + 30 s timeout (matches `CLAUDE.md` pattern) |
| `apps/web/lib/auth.tsx` | Auth.js v5 setup (credentials provider hitting `/auth/login`, HttpOnly session cookies) |
| `apps/web/middleware.ts` | Protect `/exchanges`, `/profile`, `/saved`, `/messages` |
| `e-Sharevice/src/App.scss` | Delete (dead file) |
| `e-Sharevice/src/styles/partials/_mixins.scss` | Delete (replaced by Tailwind + tokens) |

**Deliverable:** Logged-out home page is fully redesigned in both themes; mobile bottom nav works; theme toggle persists; Lighthouse mobile >= 95.

### Week 4 — Feature Migration (Incremental)

**Goal:** Ship redesigned, typed versions of every page, one PR at a time.

| Day(s) | File / route | Action |
|---|---|---|
| 4.1 | `LoginPage.jsx` -> `apps/web/app/login/page.tsx` | Replace the 3-state form (login/signup/password) with `<Tabs>` from Radix; share `SignupBody`/`LoginBody` Zod; use `next/form` action |
| 4.2 | `PhotoCardDetailPage.jsx` -> `apps/web/app/photo/[id]/page.tsx` | Server-component fetch + client `ReserveButton`; **fix the unauth read**: page is public, but `reserve` requires session |
| 4.3 | `ExchangePage.jsx` -> `apps/web/app/exchanges/page.tsx` | Replace 5 modal components with one Radix `<Dialog>` + form variants; remove `imageLoaded` array-of-10 hack; proper optimistic update on create/reserve |
| 4.4 | `Profile.jsx` -> `apps/web/app/profile/page.tsx` | Reads `session.user` from Auth.js; logout via signOut(); remove `window.location.reload()` |
| 4.5 | `MessagesPage.jsx` -> `apps/web/app/messages/page.tsx` | Fix the state mutation (`messages.push`); migrate hard-coded conversations to API; mobile/desktop split via CSS only (no `window.innerWidth` JS) |
| 4.6 | `SavedPage.jsx`, `ReservationConfirmedPage.jsx`, `NotFoundPage.jsx` | Straightforward TSX ports |
| 4.7 | `App.jsx`, `main.jsx` | Delete (replaced by Next.js layout/page) |
| 4.8 | `e-Sharevice/` (old Vite app) | **Delete entire directory** once smoke tests pass against `apps/web` |

**Deliverable:** Every page migrated; old Vite app removed; smoke e2e still green; `pnpm typecheck` clean monorepo-wide.

### Week 5 — Polish, A11y, Performance, Cutover

**Goal:** Production-ready.

| File / target | Action |
|---|---|
| All pages | Axe accessibility audit; fix every violation (focus rings, ARIA labels on icon-only buttons, `<label htmlFor>` everywhere, dialog focus trap) |
| `apps/web/next.config.mjs` | Image domains, security headers (CSP, X-Frame-Options, Strict-Transport-Security) |
| `apps/web/app/globals.css` | Final pass: `@media (prefers-reduced-motion: reduce)` overrides; print stylesheet stub |
| `apps/web/tests/visual/*.spec.ts` | Playwright `toHaveScreenshot` for Home, Detail, Login, Profile — both themes |
| Lighthouse CI | Mobile + desktop budgets enforced in CI: LCP < 2.5 s, CLS < 0.05, TBT < 200 ms |
| `apps/web/app/sitemap.ts`, `robots.ts`, `opengraph-image.tsx` | SEO basics |
| `apps/api` | Optional: dockerize; add `/health` endpoint for k8s/Fly/Render |
| `.github/workflows/deploy.yml` | Deploy `apps/web` to Vercel, `apps/api` to Fly.io / Render |
| README | Rewrite: monorepo setup, env, scripts, theming, contribution |
| `tasks/2026-05-11_ts-migration.md` | Final task log per `CLAUDE.md` knowledge-management protocol |

**Deliverable:** Production-ready Next.js + typed Express app, both themes, mobile-first, >=95 Lighthouse on mobile, all CI green, old repos archived.

---

## Quick-Win Checklist (Day-1 items you can ship before the migration starts)

These are isolated, reversible, low-risk fixes that don't require the new stack:

- [ ] Remove `node-module`, `node-modules`, `socket.io`, `cors`, `dotenv`, `node` from `e-Sharevice/package.json`.
- [ ] Add `app.use(helmet())`; replace `cors({ origin: '*' })` with an env-driven allowlist.
- [ ] Add `authenticateToken` to `GET /exchange-items/:id`.
- [ ] Add `multer` `limits: { fileSize: 5 * 1024 * 1024 }` and an image-only `fileFilter`.
- [ ] Add the global Express error handler.
- [ ] `git rm --cached e-Sharevice-backend/data.json e-Sharevice-backend/reserved.json` and add to `.gitignore`.
- [ ] Fix `MessagesPage.jsx:118` — replace `selectedConversation.messages.push(newMsg)` with `setSelectedConversation({...selectedConversation, messages: [...messages, newMsg]})`.
- [ ] Delete `App.scss` (already 100% commented).
- [ ] Add `<meta name="theme-color">` and `viewport-fit=cover` to `index.html`.
- [ ] Remove duplicate `fetchPhotoCards` (keep one of App or Homepage, not both).

---

## Appendix — Final dependency list (target)

**`apps/web/package.json`** (web): `next`, `react`, `react-dom`, `next-auth@5`, `zod`, `tailwindcss@4`, `clsx`, `@radix-ui/react-*` (dialog, dropdown-menu, tabs, label, slot), `lucide-react`, `class-variance-authority`. Dev: `typescript`, `@types/*`, `eslint`, `eslint-plugin-jsx-a11y`, `@playwright/test`, `vitest`.

**`apps/api/package.json`** (api): `express@5`, `helmet`, `cors`, `express-rate-limit`, `multer`, `bcrypt`, `jsonwebtoken`, `drizzle-orm`, `mysql2`, `zod`. Dev: `typescript`, `tsx`, `drizzle-kit`, `vitest`, `supertest`.

**Removed entirely:** `axios`, `node-cron`, `casual`, `crypto` (npm package), `fs` (security stub), `passport-github2`, `react-router-dom` (in backend!), `socket.io`, `node`, `node-module`, `node-modules`, `react-responsive`, `react-datepicker` (unused), `@fortawesome/*` (replaced by `lucide-react`).

---

**Bottom line:** The app is salvageable and the redesign + TS migration is well-scoped at 5 weeks for one or two engineers. The single highest-leverage move is **killing the dual JSON/MySQL persistence** while introducing Zod-validated typed contracts — that one decision eliminates an entire class of bugs in the current codebase and is what the rest of the migration leans on.

---

## Progress Log

### 2026-05-16 05:30 UTC — Edit-item slice closes the listing-lifecycle loop

`PUT /v1/exchange-items/{id}` lands as a partial-update endpoint (only keys present in the body get written — empty form fields are not interpreted as "clear this"). Owner-only at both layers (page redirect + API 403). New `/items/[id]/edit` server component fetches `/v1/me` + the item in parallel, redirects non-owners, renders a pre-filled form with the existing image as preview. Server action shares an idempotency key across the API PUT + the optional image upload (`<key>` / `<key>-image`). Same Blob-rebuild + parseBody pipeline from create. Detail page now shows an Edit button to the owner. Full doc: [docs/features/2026-05-16_edit-item.md](../docs/features/2026-05-16_edit-item.md).

### 2026-05-16 05:00 UTC — Google OAuth activated + bug-registry +1

Social OAuth scaffolding activated for Google (GitHub deferred — template stays as reference). Secrets pushed to VPS via `scp` + python merge; no value ever on a command line. Authentik admin API confirms `slug=google, enabled=True, blueprint status=successful`. Discovered + fixed a follow-up gotcha: Authentik's `default-authentication-identification` stage has an explicit `sources: ManyToMany` field that's empty by default — the OAuthSource record alone doesn't render a button on the login screen. PATCH'd live + codified in the blueprint. Bug-registry entry `[Build] Authentik OAuth Source Doesn't Auto-Attach to the Login Screen` added (counter 42 → 43).

### 2026-05-16 04:35 UTC — Observability + social OAuth scaffolding

Sentry SDK init lands on both api (`@sentry/node`) and web (`@sentry/nextjs`). API instruments BEFORE any other import so HTTP/Postgres patches install correctly; onError reports 5xx + unexpected errors via `captureException` (4xx skipped to avoid flooding). Web uses Next 15's `register()` hook with `NEXT_RUNTIME`-aware init. Both env-gated on `SENTRY_DSN` so local + CI no-op. Verified live: both 95-char DSNs reach the production containers.

Social OAuth scaffolding (Google + GitHub) shipped as a blueprint template — no functional change until the user creates the upstream OAuth apps. Compose threads the four env vars into both Authentik containers with empty defaults; the worker (which applies blueprints) gets them too. The activation procedure (~20 min of dashboard clicks) is documented in [docs/features/2026-05-16_social-oauth.md](../docs/features/2026-05-16_social-oauth.md).

### 2026-05-16 04:10 UTC — Saved items + reserve-race vitest

Saved-items feature shipped end-to-end: new `exchange_item_saves` table (composite PK, both FKs cascade), four new `/v1` endpoints (GET save-state / PUT save / DELETE unsave / GET saves listing), idempotency middleware on the writes, optimistic-UI bookmark button on the detail page, populated `/saved` listing on the web. Plus a vitest integration test that proves the reserve-race invariant — two concurrent UPDATEs against the same row, exactly one wins — which skips gracefully in CI without a live DB. Full doc: [docs/features/2026-05-16_saved-items.md](../docs/features/2026-05-16_saved-items.md).

### 2026-05-16 03:55 UTC — Week-5 mobile polish + Sign-up CTA

Mobile bottom tab bar (Home / Saved / Messages / Profile) lands per the original Phase-3 design spec — fixed bottom, `md:hidden`, safe-area-inset for iOS, 56 px tall with inline SVG icons (no new dep). Header gains a "Sign up" button alongside "Sign in" when unauthenticated; the `/api/auth/login?signup=1` route now forwards `prompt=create` to Authentik so the user lands on the registration screen instead of login. Stub pages for `/saved` and `/messages` with `requireAuth` and "Coming soon" copy so the tab bar resolves cleanly today; the underlying features (saves table + saves CRUD, conversations + messages + SSE) land in later slices. Full doc: [docs/features/2026-05-16_mobile-tab-bar-and-signup.md](../docs/features/2026-05-16_mobile-tab-bar-and-signup.md).

### 2026-05-16 03:35 UTC — Image-upload fix + race-safe reserve action

End-to-end create-item-with-image now actually works in production after two layered bugs were fixed (a Next-15 server-action File backed by a one-shot stream + `@hono/zod-openapi` consuming the multipart body via its built-in validator). Reserve action shipped same deploy: server action wrapper + idempotent SQL UPDATE gated on `WHERE reserved = false` so two simultaneous reserve requests can never both win. Two bug-registry entries (counter 40 → 42); feature doc at [docs/features/2026-05-16_reserve-action.md](../docs/features/2026-05-16_reserve-action.md).

### 2026-05-16 02:20 UTC — Week 4 backend foundation (R2 + idempotency)

The backend half of the image upload pipeline + the long-pending idempotency middleware. `POST /v1/exchange-items/:id/image` accepts multipart, content-hashes the upload, runs sharp through three webp variants (1600 / 800 / 400 widths), uploads to a content-keyed prefix on Cloudflare R2, updates the row's `img_key`. Idempotency middleware (Stripe-flavoured, Redis-backed, 24 h TTL, fingerprints body to detect key-reuse-with-different-payload) wired across every unsafe `/v1/exchange-items` route. 10 vitest tests green (R2 + Redis mocked). Bucket provisioned via the Cloudflare REST API; S3 access keys + `cdn.esharevice.com` custom domain remain as a ~2-minute Cloudflare dashboard step (the public API doesn't expose either of those — captured in the bug-registry). Until that's done the upload endpoint returns 503; the rest of the API is unaffected. Full detail in [tasks/2026-05-16_week-4-r2-image-upload-and-idempotency.md](2026-05-16_week-4-r2-image-upload-and-idempotency.md).

### 2026-05-16 01:52 UTC — Root-domain cutover

The live web app moves from `https://app.esharevice.com` to `https://esharevice.com`. The legacy `app.*` and `www.*` hostnames 301-redirect to root (cert stays provisioned so the redirect itself completes cleanly). Authentik's `e-sharevice-web` provider was updated additively first (new URI added alongside the old) to avoid a redirect-uri-mismatch lockout; Caddy + compose env then flipped. Full detail and a new bug-registry entry (`[Build] Docker Single-File Bind Mount Pins to Inode — git pull Silently Breaks It`) are in [tasks/2026-05-16_root-domain-cutover.md](2026-05-16_root-domain-cutover.md). README, both feature docs, and the VPS deployment log are in sync with the new URL.

### 2026-05-15 23:55 UTC — Week-5-first-slice hotfix pair

Two security/correctness fixes on the logout flow shipped same-day:
1. **`[Security] Prefetched GET on a State-Clearing Route Silently Logs Users Out`** — `<Link href="/api/auth/logout">` in `/profile` was being auto-prefetched by Next 15, applying the handler's cookie-clearing `Set-Cookie` headers without a user click. Fix: route handler is now `POST` only; `/profile` uses `<form method="post">`; the Sign-in link gets `prefetch={false}` as defense-in-depth. See [tasks/2026-05-15_logout-prefetch-silent-signout-fix.md](2026-05-15_logout-prefetch-silent-signout-fix.md).
2. **`[Network] POST → 307 Redirect Preserves Method, Trips Django/Authentik CSRF With 403`** — surfaced by (1). `NextResponse.redirect()` defaults to 307, which preserves the POST method; the browser then POSTed Authentik's `/end-session` and tripped Django's CSRF middleware. Fix: pass `303` to `NextResponse.redirect`, which forces GET on follow per the canonical OIDC RP-Initiated Logout flow.

Both deployed live to `ghcr.io/myndgrid/esharevice-web:latest`; digests in the deployment log. Bug-registry entries added.

### 2026-05-11 00:00 UTC
- Plan drafted; saved for user review. No code changes yet.

### 2026-05-14 21:00 UTC — First web slice live: OIDC login + design system + pages

The web frontend goes from a stub page to a real, themed, auth-capable Next.js 15 app live at `https://app.esharevice.com`.

What shipped:
- **Direct OIDC client** (NOT NextAuth/Auth.js). Built on `oauth4webapi` — `lib/oidc.ts` + `lib/session.ts` + four route handlers under `app/api/auth/`. Full PKCE auth-code flow, signed HttpOnly session cookie (30d) signed with `jose` HS256, separate short-lived state cookie (10m) carrying the PKCE verifier + nonce + state + return_to.
- **Server-side `auth()` helper** that returns a session whose access token is guaranteed valid for the next 60 s — refreshes inline against Authentik when the token is about to expire. Rotating refresh tokens are picked up automatically. Failure paths (revoked/expired refresh) clear the cookie cleanly.
- **Typed API client** (`lib/api.ts`) using the shared Zod schemas from `@esharevice/shared`. Public endpoints skip the auth round-trip; protected endpoints attach `Authorization: Bearer ${session.access_token}`. Server-component fetch supports Next 15's `revalidate` and `cache: no-store` modes.
- **Tailwind v4** wired up via `@theme inline` consuming the existing oklch CSS variables from `@esharevice/ui/styles.css`. Utilities like `bg-bg`, `text-fg-muted`, `bg-accent` map directly to the variables, so dark-mode flip happens with zero React re-render.
- **UI primitives** (`@esharevice/ui`): `Button` (CVA — primary/secondary/ghost/danger/link), `Avatar` (initials fallback), `Card` + `CardContent`. `cn()` helper now uses `tailwind-merge` for conflict resolution.
- **Layout shell**: `Header` (server component, auth-aware — shows Sign-in button or Avatar link to /profile based on `auth()`), `ThemeToggle` (client component wired to existing `localStorage.theme` + `data-theme` bootstrap).
- **Home page** (`/`) — server component, fetches `/v1/exchange-items?limit=20` via the typed API client, renders cards. Graceful error + empty states.
- **Protected `/profile`** — calls `requireAuth("/profile")`; unauthenticated requests get 307'd to `/api/auth/login?return_to=/profile`. Authenticated requests pull from `/v1/me`. Sign-out link present.

One Next.js 15 gotcha surfaced and fixed:
- **Env must be lazy.** `next build` statically evaluates module-level code in route handlers ("Collecting page data") — the original top-level `const env = EnvSchema.parse(...)` exploded because the Docker build context has no OIDC vars. Fix: `getEnv()` accessor that parses on first call. The pattern is now documented in `docs/features/2026-05-14_web-oidc-login-flow.md` under "Edge Cases" so future Zod-env adds don't repeat the mistake.

Verified live through Caddy on `app.esharevice.com`:
- Home page: 200, 10.5 KB optimized SSR HTML; Tailwind utilities + Inter font + tracking-tight headings present.
- `/api/auth/login`: 307 → `https://auth.esharevice.com/application/o/authorize/?…` with PKCE + state + nonce + the **production** redirect URI.
- `/profile` unauth: 307 → `/api/auth/login?return_to=%2Fprofile`.
- Bare domain still 301 → app.
- Both Authentik provider redirect URIs (prod + localhost) were already in the blueprint — no Authentik changes needed.

What's deferred to week 5 polish:
- Sign-up flow integration (Authentik handles all signup; web's Sign-in button just routes there — but no in-app "Sign up" CTA yet).
- Mobile bottom-tab bar (the design spec calls for it; currently we only have a top header).
- Additional pages (Saved, Messages, Exchanges) — all need the API endpoints to exist first.
- Sentry SDK initialization (DSNs are in env, just need `instrumentation.ts` + `sentry.{client,server,edge}.config.ts`).

### 2026-05-13 00:30 UTC — Week 3 complete: Hono swap + full /v1 API live

The Express type-resolution dead end (see entry below) was resolved by swapping `apps/api` from Express to Hono. **Hono's types are self-contained — the workspace typechecked clean on the first attempt, no peer-dep gymnastics needed.**

What shipped:
- `apps/api` rewritten on **Hono 4.6** + `@hono/node-server` + `@hono/zod-openapi` + `@hono/swagger-ui` + `hono-rate-limiter` + built-in `cors` / `secureHeaders` / `logger` middleware. 180 packages removed, 70 added vs. the Express stack.
- **jose JWKS middleware** (`requireAuth` + `attachAuth`) — ~70 lines, validates Authentik tokens against `OIDC_JWKS_URL`, attaches `c.var.user` + `c.var.auth` via lazy `resolveUserFromSub`.
- **Lazy user provisioning** (`apps/api/src/lib/users.ts`) — first-sight insert with `onConflictDoUpdate` to handle the race.
- **Cursor pagination** (`apps/api/src/lib/cursor.ts`) — base64-encoded `(ts, id)` tuple, opaque to clients.
- **RFC 7807 error handler** — `app.onError` produces `application/problem+json` for `HTTPException`, `ZodError`, and unknown errors with prod/dev detail toggling.
- **/v1 routes**, all defined with `createRoute` from `@hono/zod-openapi` so they're typed + auto-documented:
  - `GET  /v1/me` (auth required)
  - `GET  /v1/exchange-items` (public, cursor pagination, `?q=` Postgres FTS via `websearch_to_tsquery`)
  - `GET  /v1/exchange-items/{id}` (public, 404 if missing)
  - `POST /v1/exchange-items` (auth required, Zod body validation)
  - `PUT  /v1/exchange-items/{id}/reserve` (auth required, 409 on own-item or already-reserved)
- **OpenAPI 3.0 spec** served at `/v1/openapi.json` (Bearer security scheme registered) + Swagger UI at `/v1/docs`.
- **Dockerfile updated** to (a) copy workspace package source from build context — previously only `package.json` shipped, leaving `@esharevice/shared/src` missing in the runtime container — and (b) keep the pruned `tsx`/Hono dep tree for `node --import tsx/esm`.

Verified live (smoke tests through Caddy on esharevice.com):
- `/health` and `/v1/health` → 200 JSON
- `/v1/me` no token → 401 `application/problem+json` (RFC 7807)
- `/v1/exchange-items` → 200 with `{"items":[],"next_cursor":null}`
- `/v1/exchange-items?q=carpentry` → 200, FTS query runs through the GIN index
- `/v1/openapi.json` → 200, full spec with all routes + Bearer security scheme
- `/v1/docs` → 200 (Swagger UI HTML)

What's deferred to week 4 (per the original plan):
- Real image upload with multer-style multipart → sharp resize → R2 PUT.
- Idempotency keys (Redis-backed).
- Vitest + Supertest integration tests with mocked JWKS.

### 2026-05-12 23:30 UTC — Week 3 partial: migration applied, API work paused

What shipped:
- **Drizzle migration `0000_0001_initial.sql` applied to live Postgres** at `esharevice-postgres-1` on the VPS. Both `users` and `exchange_items` tables exist with all FKs and indexes; the `search` column is a `tsvector` GENERATED ALWAYS AS STORED expression (weights A/B/C on provider/service/description), with the GIN index `exchange_items_search_idx`. `citext` extension is in use for `users.email`. Verified via `\d` against the live DB.

What's deferred to next session — Express types blocker:
- Wrote the full week-3 API code locally (jose JWKS middleware, lazy user provisioning, /v1/me, /v1/exchange-items CRUD with cursor pagination + Postgres FTS, OpenAPI gen from Zod). All correct at the runtime level.
- **TypeScript cannot resolve Express's type story** under our `moduleResolution: "Bundler"` + pnpm-isolated linking + `@types/express` 5.0.6 + `@types/express-serve-static-core` 5.0.6 combination. Even minimal `import type { Response } from "express"; res.status(404)` fails with `Property 'status' does not exist on type 'Response<any, Record<string, any>>'`. Tried: hoisting via `.npmrc public-hoist-pattern`, `node-linker=hoisted`, pinning ESS-C via pnpm overrides, switching to `NodeNext` resolution, explicit `typeRoots`, custom `declare module` augmentation aligned with the generic signature — every combination produced different errors but none compiled.
- Concluded the cleanest unblock is one of: **(a)** switch `apps/api` from Express to **Hono** (self-contained types, no peer-dep gymnastics), or **(b)** dispatch a focused subagent next session purely on the Express types puzzle with fresh context. Reverted the API code to the working week-1 skeleton; workspace typecheck is clean.
- The migration SQL stays committed in `packages/db/drizzle/0000_0001_initial.sql` so the next attempt can rebuild the API against the already-deployed schema.

### 2026-05-12 22:45 UTC
- **VPS deploy complete — week 2 fully delivered on the real Hetzner box (`2.24.195.151`, esharevice.com).**
- Stack live: api, web, postgres (×2), redis, authentik-server, authentik-worker, caddy, uptime-kuma — all healthy. 5 Let's Encrypt certs issued. OIDC discovery serving real metadata at `https://auth.esharevice.com/application/o/e-sharevice-web/.well-known/openid-configuration`.
- Authentik configured: `akadmin` user created; blueprint debugged (3 fixes: uncreatable cert keypair → reference built-in self-signed; `${DOMAIN}` doesn't substitute → hardcode; client_credentials requires `redirect_uris: []`); 3 OAuth2 providers + 3 Applications + 1 group materialised; web provider's auto-generated client secret wired into `infra/.env`.
- Sentry projects created (`esharevice-api`, `esharevice-web`); DSNs in env (SDK init lands week 5).
- Backups: daily pg_dump → age-encrypt → Backblaze B2 cron at 03:00 UTC; quarterly restore drill scheduled. First backup + restore drill both green.
- VPS docker authenticated to ghcr.io via PAT (config in `/home/ops/.docker/config.json`); supports public or private packages.
- Resend SMTP env wired into Authentik; `esharevice.com` still needs domain verification at resend.com/domains before emails actually flow.
- 18 commits total this session; full state captured in [tasks/2026-05-12_vps-deployment-log.md](2026-05-12_vps-deployment-log.md) with 13 logged bug/gotcha entries.
- Week 2 done. Ready for week 3 (typed backend core, Drizzle migrations, OIDC JWT verifier middleware, `/v1` route stubs, OpenAPI from Zod).

### 2026-05-12 04:30 UTC
- **Week 2 infra-as-code landed** (the VPS itself is not yet provisioned — that step is a human task documented in [`tasks/2026-05-12_vps-provisioning-runbook.md`](2026-05-12_vps-provisioning-runbook.md)).
- Files added:
  - `infra/docker-compose.yml` — full production stack: postgres, redis, authentik-postgres (dedicated), authentik-server, authentik-worker, api, web, caddy, uptime-kuma. Two networks (`edge`, `internal`); secrets injected via `infra/.env`.
  - `infra/docker-compose.dev.yml` — minimal local stack (postgres + redis only). Web/API run on the host via `pnpm dev` against these.
  - `infra/Caddyfile` — auto-TLS for `app.`, `api.`, `auth.`, `uptime.` subdomains; HTTP/3 on; HSTS preload; per-route security headers; basic auth on the Kuma host.
  - `infra/.env.example` — every required secret with placeholder + comment.
  - `infra/postgres/init/01-extensions.sql` — runs `CREATE EXTENSION citext, pgcrypto` on first DB init.
  - `infra/authentik/blueprints/esharevice.yaml` — declarative Authentik bootstrap: signing key + the three OAuth2 providers (web confidential w/ PKCE, mobile public w/ PKCE, partners confidential) and their Applications + `esharevice-users` group. Social OAuth (Google/GitHub) configured via admin UI post-boot.
  - `infra/scripts/backup.sh` — daily `pg_dump` of both databases, gzip + age-encrypt + rclone to Backblaze B2; 30-day retention.
  - `infra/scripts/restore-drill.sh` — pulls latest dump from B2, restores into a throwaway Postgres container, asserts row counts. Fails loudly. Cron'd quarterly.
  - `apps/web/Dockerfile` — multi-stage Next.js 15 standalone build (corepack + pnpm caches; non-root user; ~150 MB final image).
  - `apps/api/Dockerfile` — multi-stage Express + tsx runtime; typecheck gate in the build; pruned production install; tini as PID 1; healthcheck wired.
  - `.dockerignore` — excludes `node_modules`, `.next`, `.turbo`, `.env*`, `Repo/`, `tasks/`.
- The VPS runbook (12 steps, ~90 min start-to-finish) covers: Hetzner provisioning, DNS records, OS hardening (sshd, ufw, fail2ban, unattended-upgrades), Docker install, Coolify install (optional), repo clone + secret generation, stack boot order, Authentik first-boot config, image build + push to ghcr.io, Drizzle migration apply, monitoring wiring (Kuma + Sentry), backup scheduling, and acceptance checks.
- Legacy `Repo/` directory remains untouched; verified via `git check-ignore` and clean working tree on both legacy subprojects.

### 2026-05-12 03:00 UTC
- **Week 1 foundation landed.** Monorepo scaffolded at the workspace root, parallel to (and isolated from) the legacy `Repo/` directory which is gitignored and untouched.
- Files created (39 total):
  - Root: `package.json` (pnpm@9.12.3, turbo 2.3), `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json` (strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`), `.gitignore` (airtight per CLAUDE.md, with `Repo/` excluded), `.env.example` (consolidated incl. Authentik OIDC keys), `.nvmrc` (20.10), `.prettierrc.json`, `README.md`, `.github/workflows/ci.yml` (typecheck + lint on push/PR).
  - `packages/shared`: Zod schemas for `User`, `ExchangeItem`, `CursorQuery`, `Problem` (RFC 7807).
  - `packages/db`: Drizzle Postgres schema for `users` (with `citext` email + OIDC `sub`) and `exchange_items` (with `img_key`/`img_hash` for R2 dedup, generated `tsvector` for FTS); `drizzle.config.ts`; connection pool helper in `src/index.ts`.
  - `packages/ui`: design-token CSS in oklch (light + dark + `prefers-color-scheme` fallback + `prefers-reduced-motion`), `cn()` helper.
  - `apps/api`: Express 5 + helmet + cors + rate-limit + pino + RFC 7807 error handler + `/v1` Router + `/health` endpoint + env validation via Zod + graceful shutdown.
  - `apps/web`: Next.js 15 (App Router) + React 19 + standalone output + theme bootstrap script (reads `localStorage.theme` before paint) + `viewport-fit=cover` + per-scheme `theme-color` + Inter via `next/font`.
- Git initialized at monorepo root on `main`; `git check-ignore` confirms `Repo/` and `Repo/**` are excluded.
- No edits made to `Repo/e-Sharevice` or `Repo/e-Sharevice-backend`; both still report clean working trees.
- **Next:** Run `pnpm install` (will need network access), then `pnpm typecheck` and `pnpm dev` to validate. After that, move to week 2 (VPS + Authentik + Compose stack).

### 2026-05-12 02:00 UTC
- Three open questions from v3 resolved: (1) **dedicated** `authentik-postgres` container; (2) **email-password + OAuth** both enabled via Authentik's built-in provider; (3) **Apple Sign-In deferred** until the mobile app phase. Plan is ready to start week 1 execution.

### 2026-05-12 01:00 UTC
- v3 addendum added: user chose Authentik (self-hosted OIDC) over Auth.js, and committed to Postgres over MySQL.
- v3 supersedes v2 §C (auth strategy) and v2 §F (MySQL flexibility); everything else in v2 stands.
- Net effect: API auth code collapses to ~30 lines (`jose` JWKS-verifying middleware); web auth = ~150 lines of `oauth4webapi` route handlers; no password code in the app; Authentik owns OAuth, MFA, account recovery, and audit log.
- Postgres FTS replaces the Meilisearch fallback; `pgloader` will migrate the existing MySQL data during week 4.
- 3 open questions flagged: Authentik DB topology, email-password fallback, Apple Sign-In timing.

### 2026-05-12 00:00 UTC
- v2 addendum added at top of file, incorporating user decisions and a second round of analysis.
- User locked in three decisions: (1) non-web clients (mobile native + third-party) are anticipated → API treated as a versioned public product; (2) self-hosted on own VPS — no managed PaaS; (3) Auth.js for OAuth, with OIDC-compatible JWT claims for future migration.
- Major additions to plan: `/v1` API versioning, OpenAPI generation from Zod, RFC 7807 errors, cursor pagination, idempotency keys, refresh-token rotation in Redis, Hetzner + Caddy + Docker Compose + Coolify deploy stack, Cloudflare R2 for images, Postgres + FTS recommended over MySQL, search/geo/notifications/moderation/PWA/observability folded into roadmap.
- Timeline revised from 5 weeks to 8–10 weeks for 1–2 engineers.
- v1 sections retained unchanged below for traceability; addendum supersedes where it conflicts.

## Bugs / Issues Encountered

(none yet — review phase)

## Files Changed

(none yet — review phase)

## Outcome

Pending user review before any implementation begins.
