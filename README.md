# e-Sharevice

A community skill / item exchange app — TypeScript monorepo. Self-hosted at [esharevice.com](https://esharevice.com).

**Created:** 2026-05-12 02:00 UTC
**Last Updated:** 2026-05-16 22:35 UTC
**Status:** Weeks 1 + 2 + 3 shipped. Production stack live; typed `/v1` API serving; redesigned web frontend in progress.

---

## Live URLs

| Surface | URL |
|---|---|
| Web app | https://esharevice.com |
| API root | https://api.esharevice.com |
| API health | https://api.esharevice.com/v1/health |
| OpenAPI spec | https://api.esharevice.com/v1/openapi.json |
| API docs (Swagger UI) | https://api.esharevice.com/v1/docs |
| Authentik (OIDC) | https://auth.esharevice.com |
| Uptime monitoring (basic-auth) | https://uptime.esharevice.com |

`www.esharevice.com` and `app.esharevice.com` 301-redirect to the root domain.

---

## Layout

```
e-sharevice/
├── apps/
│   ├── web/             # Next.js 15 (App Router, React 19, TS) — reference web client
│   └── api/             # Hono 4 (TS) — versioned public API (/v1/...) on @hono/node-server
├── packages/
│   ├── shared/          # Zod schemas + TS types (imported by web + api)
│   ├── db/              # Drizzle Postgres schema + migrations + FTS index
│   └── ui/              # oklch design tokens + shared component primitives
├── infra/
│   ├── docker-compose.yml         # production stack (postgres, redis, authentik, api, web, caddy, uptime-kuma)
│   ├── docker-compose.dev.yml     # local datastores only (postgres + redis) — web/api run on host
│   ├── Caddyfile                  # auto-TLS reverse proxy, HTTP/3, HSTS
│   ├── authentik/blueprints/      # declarative OIDC provider config
│   └── scripts/                   # daily backup + quarterly restore drill
├── docs/                # Feature docs (timestamped per CLAUDE.md)
├── tasks/               # Plans, decision logs, deployment runbooks
└── Repo/                # LEGACY reference-only — original JS app. NOT part of the workspace.
```

---

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| Web framework | Next.js 15 (App Router, React 19, standalone output) |
| API framework | **Hono 4** (typed routes via `@hono/zod-openapi`, served by `@hono/node-server`) |
| Database | Postgres 16 + `citext` + generated `tsvector` for FTS |
| ORM | Drizzle |
| Identity | Authentik (self-hosted OIDC) — issues JWTs; API only verifies via JWKS |
| Validation | Zod (shared between web & api via `packages/shared`) |
| Styling | Tailwind v4 + oklch CSS tokens (dark + light) |
| UI primitives | shadcn/ui (Radix) — landing in week 5 |
| Object storage | Cloudflare R2 (week 4) |
| Cache / rate-limit / refresh tokens / idempotency | Redis 7 |
| Hosting | Hostinger VPS (Ubuntu 24.04) + Caddy + Docker Compose + Coolify |
| Monorepo tooling | pnpm workspaces (hoisted linking — see [docs/why-hoisted.md](docs/why-hoisted.md)) + Turborepo |
| Backups | Daily `pg_dump` → age-encrypted → Backblaze B2; quarterly restore drill |
| Observability | Sentry projects provisioned (SDK wiring lands week 5) |
| Email | Resend SMTP (transactional, including Authentik password-reset) |

---

## Setup

```bash
# Once
nvm use                                              # picks Node 20.10 from .nvmrc
corepack enable                                      # pins pnpm via package.json#packageManager
pnpm install

# Start local datastores (Postgres on host port 5433, Redis on 6380 — see
# "Why those ports" below). Schema auto-loads via the citext + pgcrypto
# extensions init script on first volume creation.
docker compose -f infra/docker-compose.dev.yml up -d

# Apply the Drizzle migration to the fresh local DB
docker exec -i esharevice-dev-postgres-1 psql -U esharevice -d esharevice \
  < packages/db/drizzle/0000_0001_initial.sql

# Run web + api in parallel (Turborepo)
pnpm dev
```

### Local environment files — two on purpose

Local dev needs two env files, one per running process. They are gitignored.

| File | Loaded by | Holds | Why separate |
|---|---|---|---|
| `apps/api/.env` | `tsx watch --env-file=.env` (the API `dev` script) | `DATABASE_URL`, `REDIS_URL`, `OIDC_ISSUER`/`AUDIENCE`/`JWKS_URL`, `R2_*`, `CDN_BASE_URL`, `WEB_ORIGIN` | The API verifies JWTs against the JWKS — it never sees or needs `OIDC_CLIENT_SECRET`. |
| `apps/web/.env.local` | Next.js (auto, framework convention) | `NEXT_PUBLIC_API_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `SESSION_COOKIE_SECRET` | The web app is the OIDC *client* — it owns the client secret and the cookie-signing key. The API has zero use for either. |

The split mirrors production exactly: in [infra/docker-compose.yml](infra/docker-compose.yml) each container gets its own `environment:` block. The API container never sees `OIDC_CLIENT_SECRET`; the web container never sees `DATABASE_URL`. **That separation is a real security boundary — keep it.** A single root `.env` is tempting but would expose every secret to both processes, and "works locally, broken in prod" becomes more likely.

The two files overlap only on `OIDC_ISSUER` (the public Authentik authority URL — not a secret). Everything else is non-overlapping.

### Why dev ports 5433 / 6380 instead of 5432 / 6379

[infra/docker-compose.dev.yml](infra/docker-compose.dev.yml) binds Postgres on host port `5433` and Redis on `6380` so the dev stack coexists with other local datastores on the same machine without colliding. Container ports inside the dev compose network stay at 5432/6379 — only the host-side bind is shifted.

### Local dev URLs

| App | URL |
|---|---|
| Web | http://localhost:3000 |
| API | http://localhost:8080 |
| OpenAPI spec | http://localhost:8080/v1/openapi.json |
| Swagger UI | http://localhost:8080/v1/docs |

For full OIDC login to work locally, see [tasks/2026-05-12_vps-provisioning-runbook.md](tasks/2026-05-12_vps-provisioning-runbook.md) §8 — the redirect URI `http://localhost:3000/api/auth/callback` is already registered in the production Authentik blueprint.

---

## Scripts (root)

| Command | Action |
|---|---|
| `pnpm dev` | Run all apps in parallel (Turborepo) |
| `pnpm build` | Build every app + package |
| `pnpm typecheck` | Strict TS check across the workspace |
| `pnpm lint` | ESLint across the workspace |
| `pnpm test` | Vitest unit + Playwright smoke (wires up week 5) |
| `pnpm clean` | Remove all build artifacts and node_modules |

---

## Key documents

| Doc | Purpose |
|---|---|
| [docs/PROJECT_INDEX.md](docs/PROJECT_INDEX.md) | Navigable catalog of every feature doc, ops runbook, task log, and key code path — start here when you don't know which doc owns a topic |
| [tasks/2026-05-11_typescript-migration-and-redesign-plan.md](tasks/2026-05-11_typescript-migration-and-redesign-plan.md) | Master plan + week-by-week roadmap + decision log (current: **v3.4**) |
| [tasks/2026-05-12_vps-provisioning-runbook.md](tasks/2026-05-12_vps-provisioning-runbook.md) | 12-step runbook for provisioning a fresh VPS (re-creatable from scratch) |
| [tasks/2026-05-12_vps-deployment-log.md](tasks/2026-05-12_vps-deployment-log.md) | What's actually deployed on the live box, bug-by-bug |
| [docs/features/2026-05-13_v1-api-surface.md](docs/features/2026-05-13_v1-api-surface.md) | Design of the /v1 API: routing, auth, pagination, errors, FTS |
| [docs/features/2026-05-14_web-oidc-login-flow.md](docs/features/2026-05-14_web-oidc-login-flow.md) | Web app: OIDC code+PKCE flow, session cookies, design system, layout shell |
| [CLAUDE.md](CLAUDE.md) | Agent instructions, project-specific architecture notes, living bug registry |

---

## The `Repo/` directory

The original JavaScript app lives in `Repo/e-Sharevice` (frontend) and `Repo/e-Sharevice-backend` (backend). It is **reference-only** and gitignored from this monorepo. Use it to look up legacy behavior; do not edit it.

---

## Contributing — quick conventions

- **Branch off `main`**, never amend pushed commits.
- **Typecheck must stay green** (`pnpm typecheck`) — CI enforces this.
- **All API contracts are Zod schemas in `packages/shared`** — shared between client + server, no manual TS-interface duplication.
- **API error shape is RFC 7807 problem+json** (`application/problem+json` Content-Type) — never wrap with a custom envelope.
- **Secrets never go in the repo.** Use `.env.example` to document them; real values land in `infra/.env` on the VPS (root-only) or per-app `.env.local` for dev.
- **Living Bug Registry** in [CLAUDE.md](CLAUDE.md#living-bug-registry) — append, never delete. Use the bug categories.
