# e-Sharevice

A community skill / item exchange app — TypeScript monorepo.

**Created:** 2026-05-12 02:00 UTC
**Status:** Week 1 — foundation in place

---

## Layout

```
e-sharevice/
├── apps/
│   ├── web/             # Next.js 15 (App Router, TS) — reference web client
│   └── api/             # Express 5 (TS) — versioned public API (/v1/...)
├── packages/
│   ├── shared/          # Zod schemas + TS types (imported by web + api)
│   ├── db/              # Drizzle Postgres schema + migrations
│   └── ui/              # shadcn-style component primitives (themed via tokens)
├── Repo/                # LEGACY reference-only — original JS app. NOT part of the workspace.
└── tasks/               # Plans, decision logs, runbooks (timestamped per CLAUDE.md)
```

---

## Stack (decided)

| Layer | Choice |
|---|---|
| Language | TypeScript (strict) |
| Web framework | Next.js 15 (App Router, React 19) |
| API framework | Express 5 |
| Database | Postgres 16 |
| ORM | Drizzle |
| Identity | Authentik (self-hosted OIDC) — see [tasks/2026-05-11_typescript-migration-and-redesign-plan.md](tasks/2026-05-11_typescript-migration-and-redesign-plan.md) |
| Validation | Zod (shared between web & api via `packages/shared`) |
| Styling | Tailwind v4 + oklch CSS tokens (dark + light) |
| UI primitives | shadcn/ui (Radix) |
| Object storage | Cloudflare R2 |
| Cache / rate-limit / refresh tokens | Redis 7 |
| Hosting | Hetzner VPS + Caddy + Docker Compose + Coolify |
| Monorepo tooling | pnpm workspaces + Turborepo |

---

## Setup

```bash
nvm use                       # picks Node 20.10 from .nvmrc
corepack enable               # pins pnpm via package.json#packageManager
pnpm install
cp .env.example .env          # fill in real values
pnpm dev                      # runs apps/web and apps/api in parallel
```

### Per-app dev URLs

| App | URL |
|---|---|
| Web | http://localhost:3000 |
| API | http://localhost:8080 |
| API OpenAPI spec | http://localhost:8080/v1/openapi.json |

---

## Scripts (root)

| Command | Action |
|---|---|
| `pnpm dev` | Run all apps in parallel (Turborepo) |
| `pnpm build` | Build every app + package |
| `pnpm typecheck` | Strict TS check across the workspace |
| `pnpm lint` | ESLint across the workspace |
| `pnpm test` | Vitest unit + Playwright smoke |
| `pnpm clean` | Remove all build artifacts and node_modules |

---

## The `Repo/` directory

The original JavaScript app lives in `Repo/e-Sharevice` (frontend) and `Repo/e-Sharevice-backend` (backend). It is **reference-only** and gitignored from this monorepo. Use it to look up legacy behavior; do not edit it.

---

## Plan

The end-to-end migration plan, decision history, and week-by-week roadmap live in [tasks/2026-05-11_typescript-migration-and-redesign-plan.md](tasks/2026-05-11_typescript-migration-and-redesign-plan.md). Read v3.1 (top of file) for current state.
