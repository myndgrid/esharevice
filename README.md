# e-Sharevice

A community skill / item exchange app — TypeScript monorepo. Self-hosted at [esharevice.com](https://app.esharevice.com).

**Created:** 2026-05-12 02:00 UTC
**Last Updated:** 2026-05-13 00:30 UTC
**Status:** Weeks 1 + 2 + 3 shipped. Production stack live; typed `/v1` API serving; redesigned web frontend in progress.

---

## Live URLs

| Surface | URL |
|---|---|
| Web app | https://app.esharevice.com |
| API root | https://api.esharevice.com |
| API health | https://api.esharevice.com/v1/health |
| OpenAPI spec | https://api.esharevice.com/v1/openapi.json |
| API docs (Swagger UI) | https://api.esharevice.com/v1/docs |
| Authentik (OIDC) | https://auth.esharevice.com |
| Uptime monitoring (basic-auth) | https://uptime.esharevice.com |

Bare-domain and `www.` 301-redirect to `app.esharevice.com`.

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
cp .env.example .env                                 # fill in real values

# Start local datastores (Postgres + Redis on host ports 5432 / 6379)
docker compose -f infra/docker-compose.dev.yml up -d

# First-time: generate Drizzle migrations from the schema, then apply
pnpm --filter @esharevice/db db:generate
pnpm --filter @esharevice/db db:migrate

# Run web + api in parallel (Turborepo)
pnpm dev
```

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
| [tasks/2026-05-11_typescript-migration-and-redesign-plan.md](tasks/2026-05-11_typescript-migration-and-redesign-plan.md) | Master plan + week-by-week roadmap + decision log (current: **v3.3**) |
| [tasks/2026-05-12_vps-provisioning-runbook.md](tasks/2026-05-12_vps-provisioning-runbook.md) | 12-step runbook for provisioning a fresh VPS (re-creatable from scratch) |
| [tasks/2026-05-12_vps-deployment-log.md](tasks/2026-05-12_vps-deployment-log.md) | What's actually deployed on the live box, bug-by-bug |
| [docs/features/2026-05-13_v1-api-surface.md](docs/features/2026-05-13_v1-api-surface.md) | Design of the /v1 API: routing, auth, pagination, errors, FTS |
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
