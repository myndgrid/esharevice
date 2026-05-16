# Knowledge Index

**Created:** 2026-05-16 22:30 UTC
**Last Updated:** 2026-05-16 22:30 UTC
**Status:** Stable — catalog of every doc/task/runbook in the repo, grouped by domain.

This file is a **navigation index**, not a knowledge source. It points at the documents that own each topic. Two cousins:

- [README.md](../README.md) — user-facing onboarding (live URLs, setup, scripts).
- [CLAUDE.md](../CLAUDE.md) — agent instructions, architecture facts, framework gotchas, [living bug registry](../CLAUDE.md#living-bug-registry) (48 entries).

If you can answer your question from one of those two, do that and skip this file.

---

## At a glance

| Surface | URL |
|---|---|
| Web | https://esharevice.com |
| API | https://api.esharevice.com (`/v1/health`, `/v1/openapi.json`, `/v1/docs`) |
| Auth | https://auth.esharevice.com |
| Uptime | https://uptime.esharevice.com (basic auth) |

**Plan + roadmap:** [tasks/2026-05-11_typescript-migration-and-redesign-plan.md](../tasks/2026-05-11_typescript-migration-and-redesign-plan.md) — current: **v3.4**, weeks 1–3 shipped, week 4 R2 + idempotency shipped, week 5 in flight.

---

## Features

Grouped by domain. Each row links the design doc and notes the current production status.

### Items lifecycle — `/items/*`

| Feature | Doc | Status |
|---|---|---|
| `/v1` API surface (auth, pagination, RFC 7807, FTS) | [2026-05-13_v1-api-surface.md](features/2026-05-13_v1-api-surface.md) | Stable |
| Create item + item detail (E2E R2 upload + idempotency) | [2026-05-16_create-item-flow.md](features/2026-05-16_create-item-flow.md) | Stable |
| Edit item (owner) | [2026-05-16_edit-item.md](features/2026-05-16_edit-item.md) | Live |
| Delete / archive item (closes lifecycle loop) | [2026-05-16_delete-archive-item.md](features/2026-05-16_delete-archive-item.md) | Live |
| Reserve action (non-owner) | [2026-05-16_reserve-action.md](features/2026-05-16_reserve-action.md) | Stable |
| Saved items (bookmarks) | [2026-05-16_saved-items.md](features/2026-05-16_saved-items.md) | Stable |

### Messages — `/messages/*`

| Feature | Doc | Status |
|---|---|---|
| Conversations + messages (REST → SSE → email → unread badges) | [2026-05-16_messages.md](features/2026-05-16_messages.md) | Live (phases A, B-1..B-4) |

### Email + notifications

| Feature | Doc | Status |
|---|---|---|
| Email owner on reservation (Resend) | [2026-05-16_email-notifications.md](features/2026-05-16_email-notifications.md) | Live |
| Email preferences + unsubscribe footer + `List-Unsubscribe` header | [2026-05-16_email-preferences.md](features/2026-05-16_email-preferences.md) | Live |

### Auth + identity

| Feature | Doc | Status |
|---|---|---|
| Web OIDC login flow (code + PKCE, session cookies, design system) | [2026-05-14_web-oidc-login-flow.md](features/2026-05-14_web-oidc-login-flow.md) | Stable |
| Social OAuth via Authentik (Google live, GitHub deferred-template) | [2026-05-16_social-oauth.md](features/2026-05-16_social-oauth.md) | Google live |

### Web shell + chrome

| Feature | Doc | Status |
|---|---|---|
| Mobile tab bar + Sign-up CTA + Saved/Messages stubs | [2026-05-16_mobile-tab-bar-and-signup.md](features/2026-05-16_mobile-tab-bar-and-signup.md) | Stable |

### Performance, PWA, A11y

| Feature | Doc | Status |
|---|---|---|
| Lighthouse v12.8 audit — home page 100/100/100/100 (mobile) | [2026-05-16_lighthouse-audit.md](features/2026-05-16_lighthouse-audit.md) | Pass |
| Lighthouse CI — 5 routes (3 auth-gated via lh-bot puppeteerScript) | [2026-05-16_lighthouse-ci-public-routes.md](features/2026-05-16_lighthouse-ci-public-routes.md) | Live |
| `next/image` migration with R2 variant-aware loader (400/800/1600) | [2026-05-16_next-image-migration.md](features/2026-05-16_next-image-migration.md) | Live |
| PWA basics — manifest, service worker, install prompt, brand icons | [2026-05-16_pwa-basics.md](features/2026-05-16_pwa-basics.md) | Live |
| A11y deep pass — skip-link, SR live region, semantic lists | [2026-05-16_a11y-deep-pass.md](features/2026-05-16_a11y-deep-pass.md) | Live (Lighthouse a11y still 100) |

---

## Operations + production state

| Doc | Purpose |
|---|---|
| [docs/operations/production-fixtures.md](operations/production-fixtures.md) | Authoritative reference for load-bearing prod state outside code — `lh-bot` Authentik user, pinned Lorem Ipsum demo listing. Don't delete either without reading this. |
| [tasks/2026-05-12_vps-provisioning-runbook.md](../tasks/2026-05-12_vps-provisioning-runbook.md) | 12-step recreate-from-scratch runbook for a fresh VPS. |
| [tasks/2026-05-12_vps-deployment-log.md](../tasks/2026-05-12_vps-deployment-log.md) | What's actually deployed on the live box, bug-by-bug. |
| [tasks/2026-05-16_root-domain-cutover.md](../tasks/2026-05-16_root-domain-cutover.md) | `app.esharevice.com` → root `esharevice.com` migration (complete; legacy host 301s). |
| [tasks/2026-05-16_week-4-r2-image-upload-and-idempotency.md](../tasks/2026-05-16_week-4-r2-image-upload-and-idempotency.md) | Week-4 R2 image upload pipeline + idempotency middleware. |

### Incident logs

| Doc | Symptom |
|---|---|
| [tasks/2026-05-15_logout-prefetch-silent-signout-fix.md](../tasks/2026-05-15_logout-prefetch-silent-signout-fix.md) | Next 15 prefetched a GET that cleared session cookies → silent sign-out. Fixed by POST-only logout + form submission. (Mirror entry in bug registry: `[Security] Prefetched GET on a State-Clearing Route…`) |
| [tasks/2026-05-16_conversations-500-cascade.md](../tasks/2026-05-16_conversations-500-cascade.md) | `/v1/conversations` 500-cascade post-SSE deploy. Drizzle `ANY()` array-cast + `Date` interpolation + driver result-shape — three latent bugs surfaced together. |

---

## Code map — where things live

A pointer-only map; each row is the file CLAUDE.md treats as canonical for that area.

### API — `apps/api/`

| File | Owns |
|---|---|
| [src/index.ts](../apps/api/src/index.ts) | Hono entry, middleware stack, `serve()` |
| [src/app.ts](../apps/api/src/app.ts) | Typed `AppEnv` (`Variables: { user, auth }`) |
| [src/env.ts](../apps/api/src/env.ts) | Zod-validated process env (boot-time fail-fast) |
| [src/middleware/auth.ts](../apps/api/src/middleware/auth.ts) | `requireAuth` + `attachAuth` (jose JWKS) |
| [src/middleware/error.ts](../apps/api/src/middleware/error.ts) | `onError` + `notFound` → RFC 7807 |
| [src/lib/users.ts](../apps/api/src/lib/users.ts) | `resolveUserFromSub` (first-sight insert) |
| [src/lib/cursor.ts](../apps/api/src/lib/cursor.ts) | Opaque base64 `(ts, id)` cursor |
| [src/lib/image-url.ts](../apps/api/src/lib/image-url.ts) | R2 key → CDN URL |
| [src/routes/v1/me.ts](../apps/api/src/routes/v1/me.ts) | `GET /v1/me` |
| [src/routes/v1/exchange-items.ts](../apps/api/src/routes/v1/exchange-items.ts) | CRUD + reserve + FTS |

### Web — `apps/web/`

| File | Owns |
|---|---|
| [app/layout.tsx](../apps/web/app/layout.tsx) | Root layout, no-flash theme bootstrap, Inter, viewport-fit=cover |
| [app/globals.css](../apps/web/app/globals.css) | Imports `@esharevice/ui/styles.css` + reset |
| [next.config.mjs](../apps/web/next.config.mjs) | `output: "standalone"`, `transpilePackages` |

### Shared packages

| Path | Owns |
|---|---|
| [packages/shared/src/schemas](../packages/shared/src/schemas) | Zod schemas — `UserPublic`, `ExchangeItem`, `CursorQuery`, `Problem`, … |
| [packages/db/src/schema.ts](../packages/db/src/schema.ts) | Drizzle Postgres schema (`users` citext, `exchange_items` generated tsvector) |
| [packages/db/drizzle/](../packages/db/drizzle/) | Migrations applied manually via `docker exec ... psql < …` |
| [packages/ui/src/styles.css](../packages/ui/src/styles.css) | oklch design tokens (light + dark + `prefers-color-scheme`) |

### Infrastructure — `infra/`

| File | Owns |
|---|---|
| [docker-compose.yml](../infra/docker-compose.yml) | Production stack (9 services, 2 networks) |
| [docker-compose.dev.yml](../infra/docker-compose.dev.yml) | Local datastores only — host ports 5433 / 6380 |
| [Caddyfile](../infra/Caddyfile) | Edge proxy + auto-TLS + HSTS |
| [authentik/blueprints/esharevice.yaml](../infra/authentik/blueprints/esharevice.yaml) | Declarative OIDC provider (3 Applications) |
| [scripts/backup.sh](../infra/scripts/backup.sh) | Daily 03:00 UTC `pg_dump` → age → B2 |
| [scripts/restore-drill.sh](../infra/scripts/restore-drill.sh) | Quarterly restore drill |
| [/scripts/lighthouse-auth.cjs](../scripts/lighthouse-auth.cjs) | LHCI puppeteerScript driving Authentik flow-executor for `lh-bot` |

---

## Cross-cutting reference

| Topic | Where it lives |
|---|---|
| Why `node-linker=hoisted` | [docs/why-hoisted.md](why-hoisted.md) |
| Living bug registry (48 entries) | [CLAUDE.md#living-bug-registry](../CLAUDE.md#living-bug-registry) |
| Framework gotchas (Hono / TS / pnpm / Postgres / Authentik / Docker / Caddy / Next.js / Sentry / Resend) | [CLAUDE.md → Framework & Runtime Notes](../CLAUDE.md#framework--runtime-notes) |
| File-role map | [CLAUDE.md → Project Architecture](../CLAUDE.md#project-architecture--know-this-first) |
| Env-var rules + coherence check | [CLAUDE.md → Environment Variables](../CLAUDE.md#environment-variables) |
| Debugging trees (startup / pipeline / async / SSE / data / UI) | [CLAUDE.md → Debugging Protocol](../CLAUDE.md#debugging-protocol) |

---

## Conventions for adding entries

- **New feature doc** → `docs/features/YYYY-MM-DD_feature-name.md`. Add a row under the correct domain table above with one-line summary + status.
- **New ops doc** → `docs/operations/<name>.md`. Add to **Operations + production state**.
- **New task log / incident** → `tasks/YYYY-MM-DD_task-name.md`. Add to **Operations** or **Incident logs**.
- **Always timestamp** `Created:` + `Last Updated:` per [CLAUDE.md → Knowledge Management](../CLAUDE.md#knowledge-management).
- **Append, never delete** — status changes go in the doc's own changelog; this index only reflects the doc's current `Status:` line.
