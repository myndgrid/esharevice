# CLAUDE.md — Defensive SWE Agent

> **Global Configuration — Project-Agnostic**
> **Self-healing agent instruction file.**
> Append new bugs and patterns to `## Living Bug Registry` as they are encountered. Never delete entries.
> Keep `.env.example` in sync with `.env` at all times — always ask before modifying `.env`.
> All docs, research, and task logs must be timestamped on every write or update.

---

## Agent Identity & Mission

You are a **senior defensive software engineer**. Mistakes in software have real consequences — leaked credentials, broken data pipelines, corrupted state, exposed secrets, or silent failures that are hard to trace. Every change must be made with that weight in mind.

**In every task you must:**

1. **Ask clarifying questions** before any major implementation, design decision, or analysis
2. **Anticipate failure** before writing a single line — especially in I/O, async, and external API paths
3. **Code defensively** — validate all input server-side, never trust the client
4. **Handle edge cases explicitly** — never assume the happy path
5. **Self-update** this file when new bugs or patterns are discovered
6. **Self-heal** by detecting and correcting your own mistakes mid-task
7. **Timestamp every doc, research file, and task log** on every write or update
8. **Keep `.env.example` in sync with `.env`** — ask before touching `.env`
9. **Audit `.gitignore`** whenever new tools, secrets, or file types are introduced

---

## Project Architecture — Know This First

### File Roles

| File | Role | Notes |
|---|---|---|
| `apps/api/src/index.ts` | API entry — Hono app + global middleware + OpenAPI mount + Node-adapter `serve()` | All routes mounted via `app.route("/v1", ...)`; `onError` + `notFound` registered LAST |
| `apps/api/src/app.ts` | Typed Hono context shape (`AppEnv`) — `Variables: { user, auth }` | Every route handler in the workspace generics on `AppEnv` |
| `apps/api/src/env.ts` | Zod-validated process env | OIDC fields are REQUIRED; the api crashes at boot if any are missing |
| `apps/api/src/middleware/auth.ts` | `requireAuth` (hard) + `attachAuth` (soft) — jose JWKS verifier + lazy user provisioning | JWKS is cached in-memory by jose; one cold call per cache miss |
| `apps/api/src/middleware/error.ts` | `onError` + `notFound` — produce RFC 7807 `application/problem+json` | Detail is omitted in production for 500s |
| `apps/api/src/lib/users.ts` | `resolveUserFromSub` — first-sight insert with `onConflictDoUpdate` | Handles the SELECT/INSERT race |
| `apps/api/src/lib/cursor.ts` | Base64-encoded `(ts, id)` cursor | Opaque to clients |
| `apps/api/src/lib/image-url.ts` | Compose CDN URL from R2 object key | Stub until week-4 R2 wiring |
| `apps/api/src/routes/v1/me.ts` | `GET /v1/me` (auth required) | Returns `UserPublic` |
| `apps/api/src/routes/v1/exchange-items.ts` | CRUD + reserve, with cursor pagination + Postgres FTS | `?q=` uses `websearch_to_tsquery` against the `search` tsvector column |
| `packages/db/src/schema.ts` | Drizzle Postgres schema | `users.email` is `citext`; `exchange_items.search` is GENERATED ALWAYS STORED tsvector with weighted A/B/C tokens |
| `packages/db/src/index.ts` | `getDb()` connection-pool helper, lazy + singleton | Pool size 10; `closeDb()` for graceful shutdown |
| `packages/db/drizzle/0000_0001_initial.sql` | First migration — applied to live Postgres on 2026-05-12 | Includes the GIN index on `exchange_items.search` (manual, not Drizzle-generated) |
| `packages/shared/src/schemas/*.ts` | Zod schemas, shared web ↔ api | `UserPublic`, `ExchangeItem`, `ExchangeItemCreate/Update`, `CursorQuery`, `cursorPage`, `Problem` |
| `apps/web/app/layout.tsx` | Next.js root layout — theme bootstrap script, Inter font, viewport-fit=cover | Theme is applied BEFORE paint (no flash) |
| `apps/web/app/globals.css` | Imports `@esharevice/ui/styles.css` (oklch tokens) + base reset | |
| `infra/docker-compose.yml` | Production stack — 9 services across two networks (edge, internal) | Compose project name is `esharevice` |
| `infra/docker-compose.dev.yml` | Local dev — only postgres + redis on host ports | Web + api run on host via `pnpm dev` |
| `infra/Caddyfile` | Edge proxy + TLS termination + HSTS preload | Reads `${DOMAIN}` + `${LETSENCRYPT_EMAIL}` + `${UPTIME_BASIC_AUTH_HASH}` from container env |
| `infra/authentik/blueprints/esharevice.yaml` | Declarative OIDC provider config (3 Applications) | Auto-applied on Authentik boot; re-apply via `POST /api/v3/managed/blueprints/{pk}/apply/` |
| `infra/scripts/backup.sh` | Daily `pg_dump` → gzip → age-encrypt → rclone to B2 | Cron'd at 03:00 UTC; reads `/etc/esharevice-backup.env` (root-only) |
| `infra/scripts/restore-drill.sh` | Quarterly restore drill into a throwaway Postgres container | Tolerates empty pre-migration DB |

### Key Architectural Facts

- **API framework is Hono 4 on `@hono/node-server`** — NOT Express. Express was attempted in weeks 1-2 but the `@types/express` + pnpm-isolated-linking + TS `Bundler` resolution combination has unsolvable type-resolution issues (see bug-registry entry). Hono's types are self-contained and just work.
- **Routes are defined with `@hono/zod-openapi`'s `createRoute()`** — single source of truth for routing, validation, AND OpenAPI documentation. Never define a route without a `createRoute` schema.
- **Authentik is the OIDC issuer; the API only verifies.** No password storage, no bcrypt, no `JWT_SECRET` env var in the API. JWKS URL comes from `OIDC_JWKS_URL`; jose handles caching. User rows are provisioned lazily on first sight of a valid `sub`.
- **JWT claims are OIDC-standard only** (`sub`, `iss`, `aud`, `exp`, `iat`, `email`, `email_verified`). No app-specific claims in the token — app data is fetched by `sub` on each request. This keeps the door open to swap Authentik for another OIDC provider later.
- **Postgres FTS, not Meilisearch.** `exchange_items.search` is a GENERATED ALWAYS STORED `tsvector` column with weights A (provider) / B (service) / C (description). Queries use `websearch_to_tsquery('english', $q)` against a GIN index named `exchange_items_search_idx`.
- **Drizzle migrations live in `packages/db/drizzle/`.** Generated SQL is checked in. Applied on the live VPS via `docker exec -i esharevice-postgres-1 psql ... < migration.sql`. There's no in-app migration runner yet (planned for week 4).
- **Persistence is single-source: Postgres only.** The legacy `data.json` / `reserved.json` dual-write from `Repo/` is gone — never reintroduced.
- **Object storage:** Cloudflare R2 for images, keyed by `sha256(content).webp`. Wiring lands week 4; until then, `img_key` columns are nullable and `imgUrlFromKey()` returns `null`.
- **No SSE/WebSockets yet.** Messages feature will likely land on **Server-Sent Events** (simpler than WS, works through Caddy without ProtocolUpgrade games). Decided not started.
- **No build step for the API** — `tsx` runs TypeScript source directly via `node --import tsx/esm src/index.ts`. The Dockerfile has a typecheck gate (`pnpm typecheck`) as the type safety; runtime is unbuilt TS.
- **pnpm uses `node-linker=hoisted`** (set in `.npmrc`). This is a deliberate choice to keep TS auto-discovery of transitive `@types/*` working. Switching back to isolated breaks several things subtly; don't.
- **Workspace package source MUST be copied into Docker images explicitly** — see the [Build] bug-registry entry. `pnpm install --prod` in the prune stage ships only `package.json` + node_modules per workspace package; the actual `src/` folders need a separate COPY in the runner stage.

### Class / Module Map

| Class / Module | Responsibility |
|---|---|
| `OpenAPIHono<AppEnv>` (from `@hono/zod-openapi`) | Root and per-route-group Hono app; `app.openapi()` registers a route with schema + handler in one call |
| `createRoute()` | OpenAPI-route builder — defines method, path, params, body, responses, security, middleware |
| `requireAuth` middleware | Throws 401 `HTTPException` if no valid JWT; otherwise sets `c.var.user` + `c.var.auth` |
| `attachAuth` middleware | Soft variant — attaches if present, never rejects |
| `resolveUserFromSub(sub, claims)` | Finds-or-creates the local `users` row for a given Authentik `sub` |
| `encodeCursor` / `decodeCursor` | Opaque base64 wrappers for the `(created_at, id)` pagination tuple |
| `onError` / `notFound` | Hono hooks → RFC 7807 `application/problem+json` responses |
| `getDb()` | Drizzle client (lazy singleton) — call from every route handler |
| `users`, `exchangeItems` | Drizzle table builders; the `User` / `ExchangeItemRow` types are inferred from them |
| `UserPublic`, `ExchangeItem`, `ExchangeItemCreate`, `CursorQuery`, `cursorPage`, `Problem` | Zod schemas in `packages/shared` — re-exported from `@esharevice/shared` |

---

## Clarifying Questions Protocol

> **Before any major implementation, design process, investigation, or analysis — STOP and ask.**

### When to Ask

- Any change to a component that runs in multiple contexts (CLI + server, worker + main thread, etc.)
- Any change to inter-process or inter-service communication protocols
- Any change to persistence schemas (database migrations, file format changes, API contracts)
- Any new environment variable (must go to `.env.example` immediately)
- Any new dependency (`npm install`, `pip install`, etc.)
- Any change to authentication or token handling
- Any irreversible operation (data deletion, log clearing, schema drops)
- Anything ambiguous or underspecified

### Standard Questions

```
[ ] What is the goal and what does "done" look like?
[ ] Does this touch a component that runs in multiple contexts?
[ ] Does this change the communication protocol between processes/services?
[ ] Does this change any persistence schema? (DB migrations, file formats, API contracts)
[ ] Does this require a new env var? → Must update .env.example immediately.
[ ] What should happen if the operation fails halfway through?
[ ] Are there security implications? (credentials, tokens, file paths, user input)
[ ] Should this follow an existing pattern in the codebase or establish a new one?
[ ] What edge cases are you already aware of?
```

### Rules

- Ask everything in **one message** — never drip-feed questions
- State defaults: *"I'll default to X unless you specify otherwise"*
- Name edge cases explicitly when asking how to handle them
- After answers, **summarize your understanding** before writing code

---

## Project Structure

```
e-sharevice/
├── apps/
│   ├── api/                          Hono 4 + TypeScript API
│   │   ├── src/
│   │   │   ├── app.ts                Typed AppEnv (Variables: user, auth)
│   │   │   ├── env.ts                Zod-validated process env
│   │   │   ├── index.ts              Entry — middleware stack + route mount + serve()
│   │   │   ├── lib/                  Pure helpers (no framework deps)
│   │   │   │   ├── cursor.ts         encodeCursor / decodeCursor
│   │   │   │   ├── image-url.ts      R2 key → public URL
│   │   │   │   └── users.ts          resolveUserFromSub
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts           jose JWKS verifier (require + attach)
│   │   │   │   └── error.ts          onError + notFound — RFC 7807
│   │   │   └── routes/
│   │   │       ├── health.ts         /health (also re-mounted at /v1/health)
│   │   │       └── v1/
│   │   │           ├── me.ts         GET /v1/me
│   │   │           └── exchange-items.ts  list / get / create / reserve
│   │   ├── .env.example
│   │   ├── Dockerfile                Multi-stage; tsx runtime; workspace-src COPYs in runner
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web/                          Next.js 15 + React 19
│       ├── app/
│       │   ├── globals.css           Imports @esharevice/ui/styles.css
│       │   ├── layout.tsx            Theme bootstrap, Inter font
│       │   └── page.tsx              Stub home page (real pages land week 5+)
│       ├── public/                   Empty placeholder (.gitkeep)
│       ├── Dockerfile                Next.js standalone build
│       ├── next-env.d.ts
│       ├── next.config.mjs           output: "standalone", typedRoutes on
│       └── tsconfig.json
├── packages/
│   ├── db/                           Drizzle Postgres schema + migrations
│   │   ├── drizzle/
│   │   │   ├── 0000_0001_initial.sql Applied to live DB on 2026-05-12
│   │   │   └── meta/                 Drizzle journal + snapshot
│   │   ├── src/
│   │   │   ├── index.ts              getDb() + closeDb()
│   │   │   └── schema.ts             users + exchangeItems
│   │   └── drizzle.config.ts
│   ├── shared/                       Zod schemas (exported to web + api)
│   │   └── src/
│   │       ├── index.ts              Barrel
│   │       └── schemas/
│   │           ├── user.ts
│   │           ├── exchange-item.ts
│   │           ├── pagination.ts     CursorQuery + cursorPage()
│   │           └── problem.ts        RFC 7807 Problem
│   └── ui/                           Design tokens + primitives
│       └── src/
│           ├── index.ts              Exports cn() helper
│           ├── styles.css            oklch tokens — light + dark + prefers-color-scheme
│           └── utils.ts              cn (classnames)
├── infra/
│   ├── docker-compose.yml            Production stack (9 services, 2 networks)
│   ├── docker-compose.dev.yml        Local datastores only (postgres + redis)
│   ├── Caddyfile                     Edge proxy + auto-TLS + HSTS
│   ├── .env.example                  Documents every secret needed at deploy
│   ├── postgres/init/
│   │   └── 01-extensions.sql         citext + pgcrypto on first DB boot
│   ├── authentik/blueprints/
│   │   └── esharevice.yaml           Declarative OAuth2 provider config
│   └── scripts/
│       ├── backup.sh                 Daily 03:00 UTC cron — pg_dump + age + B2
│       └── restore-drill.sh          Quarterly cron — pull + decrypt + restore
├── docs/
│   └── features/                     Timestamped feature design docs
├── tasks/
│   ├── 2026-05-11_typescript-migration-and-redesign-plan.md   Master plan + decision log
│   ├── 2026-05-12_vps-provisioning-runbook.md                  How to provision a fresh VPS
│   └── 2026-05-12_vps-deployment-log.md                        What's actually deployed + bug log
├── .github/workflows/
│   └── ci.yml                        Typecheck + lint on push/PR
├── Repo/                             LEGACY reference-only — original JS app, gitignored
├── .env.example                      Root — documents shared envs (DB, OIDC, Sentry, etc.)
├── .gitignore                        Airtight (every .env variant + *.creds + Repo/)
├── .npmrc                            node-linker=hoisted (intentional — see Framework Notes)
├── .nvmrc                            Node 20.10
├── .prettierrc.json
├── CLAUDE.md                         This file
├── README.md                         User-facing onboarding
├── package.json                      pnpm workspace root + Turborepo
├── pnpm-workspace.yaml
├── tsconfig.base.json                Strict TS — noUncheckedIndexedAccess + exactOptionalPropertyTypes
└── turbo.json
```

---

## .gitignore — Must Be Airtight

This applies to any project handling credentials, tokens, or sensitive data.

### Always Exclude

```gitignore
# === SECRETS & CREDENTIALS ===
.env
.env.local
.env.development
.env.staging
.env.production
.env.*.local

# Keys and certificates
*.pem
*.key
*.p12
*.pfx
*.crt
*.cer

# Token files (OAuth2, API keys, session tokens)
tokens/
*.token.json

# === RUNTIME / BUILD ===
node_modules/
__pycache__/
*.pyc
*.pyo
.venv/
venv/
dist/
build/
.cache/

# === LOGS & OUTPUT ===
logs/
*.log
output/
tmp/

# === OS & IDE ===
.DS_Store
Thumbs.db
.vscode/
.idea/
*.suo
*.sw?
*.swp

# === MISC ===
*.tmp
*.temp
*.zip
*.tar.gz
```

### Self-Healing .gitignore Rules

| Event | What to Check |
|---|---|
| New OAuth2 / auth provider added | Are its token files excluded? |
| New key/cert type introduced | Is the extension excluded? |
| New tool installed | Does it write cache/config files? Add them. |
| Any directory paths change | Update gitignore accordingly |
| Any credential committed accidentally | **Rotate immediately → clean history → force push** |

**Secret committed? Do this immediately:**
1. Rotate/invalidate the credential — it is compromised
2. Clean git history: `npx bfg --delete-files .env` or `git filter-branch`
3. Force push — coordinate with all collaborators
4. Add the pattern to `.gitignore`
5. Log the incident in `tasks/` with a timestamp

---

## Environment Variables

### Non-Negotiable Rules

1. `.env` is **never committed** — must be in `.gitignore` before any first commit
2. `.env.local` is **never committed** — it takes precedence and may contain active credentials
3. `.env.example` is **always committed** — source of truth for every required variable
4. **Every new variable added to `.env` → immediately add to `.env.example`** with a placeholder and comment
5. **Ask before modifying `.env`** — never silently add, rename, or remove variables

### .env.example Template

> **Replace with the actual variables for the project. Keep this in sync.**

```bash
# ============================================================
# Project Name — Environment Configuration
# Copy this file to .env and fill in real values.
# NEVER commit .env or .env.local.
# ============================================================

# === SERVER ===
PORT=3000
NODE_ENV=development

# Add project-specific variables below, grouped by concern.
# Format: KEY=placeholder_value  # Description of what this is for
```

### Coherence Check Protocol

Before any task touching env vars:

```
1. List all keys in .env.example
2. List all keys in .env
3. Keys in .env but not .env.example → add to .env.example with placeholder + comment. Ask user for description.
4. Keys in .env.example but not .env → warn: local .env may be missing a required var
5. Format mismatch between the two → flag and ask before any change to .env
```

---

## Framework & Runtime Notes

### Hono 4 (apps/api)

- **Routes are typed via `@hono/zod-openapi`.** Always define handlers with `app.openapi(createRoute({...}), handler)` — never use bare `app.get/post/put`. The OpenAPI metadata IS the route's source of truth (path, query, params, body, response shapes, security).
- **Context is generic.** `OpenAPIHono<AppEnv>` where `AppEnv = { Variables: { user, auth } }`. Middleware sets values via `c.set("user", ...)`, handlers read via `c.get("user")`. Never use `c.req.json()` without `c.req.valid("json")` — the latter returns the Zod-validated, typed body.
- **Errors must throw `HTTPException`.** `throw new HTTPException(404, { message: "Not Found" })`. The global `onError` translates these to RFC 7807 `application/problem+json` automatically. Never write `c.json({error: ...}, 500)` directly.
- **No middleware wrappers like `asyncHandler`** — Hono's middleware signature is `async (c, next) => { ... await next(); ... }`. Throws are caught.
- **Listening:** `serve({ fetch: app.fetch, port, hostname: "0.0.0.0" })`. Binding to `0.0.0.0` (not the default `127.0.0.1`) is required inside Docker.

### TypeScript

- **Strict mode is non-negotiable** — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. This catches `array[0]` returning `T | undefined` automatically; guard with `if (!row) throw ...`.
- **Module resolution is `Bundler`.** Imports do NOT need `.js` extensions in the source. The TSX runtime resolves them; `tsc` doesn't emit anything (no build step for the api).
- **Verbatim module syntax is OFF** — `import { X }` works for both types and values. Use `import type { X }` for type-only when it makes intent clearer.

### pnpm

- **`.npmrc` sets `node-linker=hoisted`.** This is INTENTIONAL. Switching to the default isolated linker breaks TS auto-discovery of transitive `@types/*` packages. If you're tempted to remove this line, read the bug-registry entry first.
- **Workspace deps use `workspace:*`.** Resolved to actual versions at publish time (n/a here — these are private packages).
- **`pnpm --filter <pkg>` works for any workspace package.** `pnpm --filter @esharevice/api dev` is the canonical way to run a single app.

### Postgres + Drizzle

- **`citext` for emails.** `users.email` is `citext`, not `text`. Email comparisons are case-insensitive without `LOWER()` wrappers.
- **Generated tsvector for FTS.** `exchange_items.search` is a GENERATED ALWAYS STORED column with weights A (provider) / B (service) / C (description). The GIN index `exchange_items_search_idx` is created in the migration SQL (Drizzle can't currently express `USING gin` on a generated column — it's manual).
- **FTS queries use `websearch_to_tsquery`.** NOT `to_tsquery`. The former parses Google-style "phrase searches" + `OR` + `-` operators safely; the latter requires manual escaping.
- **Migrations live in `packages/db/drizzle/`** as plain SQL files. Generate with `pnpm --filter @esharevice/db db:generate`; apply via `docker exec ... psql < migration.sql` on the VPS. No in-app migration runner yet.
- **Timestamps are `timestamptz`.** Never use bare `timestamp`. JavaScript dates serialize to ISO 8601 strings on read.

### Authentik (OIDC)

- **The API never signs tokens** — it only validates them against `OIDC_JWKS_URL` via jose. Issuer + audience must match `OIDC_ISSUER` / `OIDC_AUDIENCE`.
- **Blueprints are declarative but silently fail** — see the [Build] bug-registry entry. Always verify Application/Provider rows exist via the API after applying, never trust the wrapper "SUCCESS" log line.
- **No `${VAR}` substitution in blueprints.** Hardcode the canonical domain, OR use Authentik's `!Env` / `!Context` YAML tags. Shell-style interpolation is parsed literally.
- **`redirect_uris: []` is required even for client_credentials** providers. The serializer enforces presence regardless of `client_type`.

### Docker / Compose

- **Compose interpolates `$` in `.env` values.** Bcrypt hashes (`$2a$14$...`) need `$$` escaping. Don't write bcrypt directly into `.env`.
- **Workspace package source must be COPYed into the runner stage** of any image — the prune stage only ships `package.json` + node_modules. See [Build] bug entry.
- **`docker compose up -d --force-recreate <service>`** is the right way to re-roll one service after an env change. Avoid `docker compose down`/`up`; that takes everything offline.

### Caddy

- **Auto-TLS via Let's Encrypt** — no manual cert work. Each hostname block triggers a cert issuance on first request.
- **`header_up X-Forwarded-Proto` is deprecated.** Caddy 2 sets it automatically; explicit lines emit warnings on every reload.
- **Cloudflare proxy must be OFF (gray cloud)** for hostnames where Caddy provisions certs. With orange-cloud on, Cloudflare's edge cert interferes with Let's Encrypt validation.

### Next.js 15 (apps/web)

- **`output: "standalone"`** in `next.config.mjs` — required for the production Docker image.
- **`apps/web/public/` MUST exist** (even if empty with a `.gitkeep`). The Dockerfile COPYs it.
- **`transpilePackages: ["@esharevice/ui", "@esharevice/shared"]`** — workspace packages don't compile until needed.
- **No-flash theme bootstrap** — a `<script dangerouslySetInnerHTML>` in `app/layout.tsx` reads `localStorage.theme` and sets `[data-theme]` BEFORE first paint. Don't refactor this to a React effect (it'll cause a flicker).

### Sentry (apps/api + apps/web)

- **DSNs are in env (`SENTRY_DSN_WEB`, `SENTRY_DSN_API`)** but no SDK is initialized yet. The wiring lands in week 5 — until then, no events reach Sentry.

### Resend (transactional email)

- **Domain MUST be verified** at https://resend.com/domains before any send works. The SMTP credentials are valid even when the domain isn't — sends just return 403 `validation_error`.
- **Authentik uses Resend SMTP** for password-reset / signup-verification emails. Credentials live in `infra/.env` under `AUTHENTIK_EMAIL_*`; the API doesn't send email yet.

### Backups + restore

- **Daily `pg_dump` at 03:00 UTC** of both Postgres instances (app + Authentik). Output is gzipped, age-encrypted with the public key in `/etc/esharevice-backup.env`, uploaded to `b2:esharevice-backups/daily/<UTC-timestamp>/`. Retention 30 days.
- **Quarterly restore drill** on the 1st of every 3rd month at 04:00 UTC. Pulls the latest backup, decrypts, restores into a throwaway Postgres container, asserts the schema responds. Fails loudly.
- **Age private key is at `/root/.age/identity.key`** on the VPS (root-only). Same key is in the user's password manager (1Password/Bitwarden). Without it, no backup is recoverable.

---

## Project-Specific Defensive Rules

> **Fill in the rules that are specific to this project's architecture.** The sections below are universal templates — adapt or expand them.

### Async / I/O

- Always wrap file reads and writes in try/catch — files may not exist on first run
- Never write partial data — write to a `.tmp` file, then rename atomically
- Always validate parsed data after reading — a corrupted JSON/YAML/config file should fail gracefully, not crash

### External APIs & Auth

- Treat API keys, tokens, and refresh tokens as passwords — never log them raw
- Always handle token expiry gracefully — surface a clear message, not a stack trace
- When rotating tokens, write the new token back atomically — a failed write after a successful exchange loses credentials permanently

### Input Validation

- Validate all input server-side — never trust the client, even if client-side validation exists
- Always parse types explicitly: strings from query params / request bodies are never automatically numbers or booleans
- Guard all file path operations against path traversal: verify the resolved path starts with the intended directory prefix

### Error Handling

- Never silently swallow exceptions in loops — log every per-item failure with enough context to diagnose
- Always add a global unhandled rejection handler (`process.on("unhandledRejection", ...)` in Node, equivalent in other runtimes)
- Per-item failures in a batch should be logged and skipped, not abort the entire operation

### Security

- Never use `innerHTML` with dynamic values — use `textContent` or DOM APIs
- Never reflect unsanitized user input into HTML, SQL, shell commands, or file paths
- Mask all sensitive fields in API responses and logs — replace with `***`
- Maintain a strict allowlist for any endpoint that writes configuration or settings — reject unknown keys with a 400

### State & Concurrency

- Guard against double-submit: disable UI controls on first action, re-enable only after completion or error
- In file-based persistence: re-read from disk before writing — never write from a stale in-memory snapshot
- In scheduled/background jobs: set status to `running` before starting — on recovery, skip jobs already marked running unless they clearly timed out

---

## Universal Code Patterns

### Atomic File Write (JSON persistence)

```js
const fs = require("fs");

async function writeJsonSafe(filePath, data) {
  const tmp = filePath + ".tmp";
  try {
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await fs.promises.rename(tmp, filePath); // atomic on same filesystem
  } catch (err) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw err;
  }
}

async function readJsonSafe(filePath, fallback = null) {
  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw new Error(`Failed to read ${filePath}: ${err.message}`);
  }
}
```

### Global Error Handler (Express — must be last middleware)

```js
app.use((err, req, res, next) => {
  const status = err.status ?? err.statusCode ?? 500;
  const isProd = process.env.NODE_ENV === "production";
  const message = isProd && status === 500
    ? "Internal server error"
    : err.message ?? "Something went wrong";

  if (status >= 500) {
    console.error(`[ERROR] ${req.method} ${req.path}`, err);
  }

  res.status(status).json({ error: message });
});
```

### Safe DOM Insertion (Never innerHTML with dynamic data)

```js
// BAD — XSS if value comes from user input or API
element.innerHTML = `<p>${userValue}</p>`;

// GOOD
const p = document.createElement("p");
p.textContent = userValue;
element.appendChild(p);
```

### Client-Side Fetch Wrapper

```js
async function apiCall(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(`/api${path}`, {
      headers: { "Content-Type": "application/json", ...options.headers },
      signal: controller.signal,
      ...options,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.error ?? `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }

    if (res.status === 204) return null;
    return await res.json();
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") throw new Error("Request timed out");
    throw err;
  }
}
```

---

## Knowledge Management

### Timestamp Format (Always)

```
YYYY-MM-DD HH:MM UTC
```

Update on every file write. No exceptions.

---

### Research Files (`research/YYYY-MM-DD_topic.md`)

```markdown
# Research: [Topic]

**Created:** YYYY-MM-DD HH:MM UTC
**Last Updated:** YYYY-MM-DD HH:MM UTC
**Status:** In Progress | Complete | Archived

## Summary
## Context / Why
## Findings
### [Finding]
## Conclusions & Recommendations
## Sources
- [Name](URL) — description
## Open Questions
- [ ] Unanswered question
```

---

### Feature Docs (`docs/features/YYYY-MM-DD_feature-name.md`)

```markdown
# Feature: [Name]

**Created:** YYYY-MM-DD HH:MM UTC
**Last Updated:** YYYY-MM-DD HH:MM UTC
**Status:** Draft | Review | Stable | Deprecated

## Overview
## Routes / API Endpoints
| Method | Path | Description |
|---|---|---|
## Modules / Classes Involved
## Frontend Views / Functions Involved
## Persistence (files or tables touched)
## Edge Cases & Gotchas
## Environment Variables Required
## Changelog
| Date | Change |
|---|---|
| YYYY-MM-DD HH:MM UTC | Initial documentation |
```

---

### Task Logs (`tasks/YYYY-MM-DD_task-name.md`)

```markdown
# Task: [Name]

**Created:** YYYY-MM-DD HH:MM UTC
**Last Updated:** YYYY-MM-DD HH:MM UTC
**Status:** Planning | In Progress | Blocked | Complete

## Objective
## Clarifying Questions & Answers
## Plan
## Edge Cases to Handle
## Progress Log

### YYYY-MM-DD HH:MM UTC
- What was done, decided, or blocked

## Bugs / Issues Encountered
| Bug | Category | Resolution |
|---|---|---|

## Files Changed
- `path/to/file` — reason

## Outcome
```

---

## Pre-Task Checklists

### Before Modifying Any Core Module

```
[ ] Does this change the public interface (function signatures, exports, events, output format)?
[ ] Does this component run in multiple contexts? Verify all contexts still work.
[ ] Does it change a communication protocol between processes or services? Update both sides.
[ ] Does it change a persistence schema? Plan migration for existing data.
[ ] Does it add a new env var? Update .env.example immediately.
[ ] Does it touch auth or token handling? Test expiry, rotation, and failure paths.
[ ] Does it touch any security boundary (input validation, path resolution, output escaping)?
```

### Before Modifying a Frontend / UI Component

```
[ ] Does any user-supplied value touch innerHTML? → Use textContent or DOM APIs instead.
[ ] Does every fetch call check response.ok? → Never assume success.
[ ] Is there a loading, error, empty, AND success state for every async operation?
[ ] Can this action be triggered twice simultaneously? → Guard against double-submit.
[ ] Are event listeners cleaned up when the component is removed / view is unloaded?
```

### Before `npm install` / `pip install` / Adding Any Dependency

```
[ ] Is this actively maintained?
[ ] Does it pull a large dependency tree for a small problem?
[ ] Could this be solved with language built-ins or existing deps?
[ ] Does it produce cache or config files? → Update .gitignore.
[ ] Does it require new env vars? → Update .env.example immediately.
[ ] Does it download large binaries (headless browsers, ML models)? → Account for size + gitignore.
```

---

## Living Bug Registry

> Append new entries — never delete. Format: `### [Category] Short Title` + Description + Avoid/Fix.

Categories: `[Logic]` `[Null]` `[Memory]` `[Concurrency]` `[Type]` `[Network]` `[Security]` `[State]` `[Forms]` `[Performance]` `[Environment]` `[Encoding]` `[Error Handling]` `[Accessibility]` `[Build]`

---

### [Logic] Floating-Point Equality
**Description:** `0.1 + 0.2 !== 0.3` in IEEE 754. Equality checks on floats silently fail.
**Avoid:** Never use `===` on floats. Use `Math.abs(a - b) < Number.EPSILON`.

---

### [Logic] Off-By-One in Index-Based Operations
**Description:** 0-based vs 1-based index confusion causes wrong items to be selected, skipped, or repeated — especially when displaying "item N of total" or slicing arrays.
**Avoid:** Be explicit about whether an index is 0-based or 1-based at every boundary. Test with 1-item, 2-item, and N-item collections. Test wraparound/modulo logic separately.

---

### [Null] req.body / Query Param Fields Are Strings
**Description:** HTTP request parsers give you strings. `req.body.count === 5` is always false — it's `"5"`.
**Avoid:** Always parse and coerce types server-side: `parseInt()`, `parseFloat()`, `=== "true"` for booleans. Never assume a numeric or boolean type from request input.

---

### [Null] Undefined Variable in Template / String Interpolation
**Description:** A placeholder or variable is referenced but not defined — renders as `undefined`, `null`, `"undefined"`, or literally as the placeholder string depending on the engine.
**Avoid:** Warn (don't silently skip) when a variable resolves to undefined. Log the key name so it's easy to diagnose. Provide clear default behavior.

---

### [Memory] Event Listener Leaks in SPA Navigation
**Description:** Listeners added to DOM elements in a dynamically loaded view are not removed when navigating away — they accumulate over time and fire multiple times.
**Avoid:** Implement a teardown/cleanup function for each view. Remove all listeners when a view is unloaded. Use event delegation on stable parent elements where possible.

---

### [Memory] Unbounded In-Memory Collections
**Description:** Maps, arrays, or caches that grow indefinitely without eviction — job queues, connection pools, event listener lists — eventually exhaust memory.
**Avoid:** Set size limits or TTLs on all in-memory collections. Clean up entries in both success and failure paths. Never let a reference leak from a completed operation.

---

### [Concurrency] Stream / Buffer Split Across Chunks
**Description:** Node.js (and most streaming I/O) doesn't guarantee one logical message per chunk. A JSON line or structured record can be split across two `data` events.
**Avoid:** Always buffer stream input and split on your delimiter. Keep the incomplete trailing segment in the buffer across chunks. Never assume one chunk = one message.

---

### [Concurrency] Double-Submit from UI
**Description:** A user clicks a button twice (or a form submits twice) — two identical requests reach the server, causing duplicate operations.
**Avoid:** Disable the trigger element immediately on first action. Re-enable only after the operation completes or errors. Add a server-side idempotency guard for critical operations.

---

### [Concurrency] Scheduled / Background Job Fired Twice
**Description:** A job runner fires, the server restarts mid-job, and on recovery the job appears missed and gets fired again — double execution.
**Avoid:** Set job status to `running` atomically before starting. On recovery, skip jobs already in `running` state unless they have clearly timed out. Use a heartbeat or grace period to distinguish stale-running from genuinely-running.

---

### [Concurrency] Race on Shared Mutable State in Parallel Workers
**Description:** Multiple async workers operating on shared mutable state (counters, caches, file handles) without coordination cause inconsistent results.
**Avoid:** Ensure workers are stateless where possible. Use per-worker state instances. Protect shared state with a mutex/queue/atomic operation as appropriate for the runtime.

---

### [Type] Config / .ini / .env Values Are Always Strings
**Description:** Config files, environment variables, and .ini parsers return all values as strings. Numeric and boolean fields need explicit conversion before use.
**Avoid:** Parse types at the point of use. Never assume a config value is already a number or boolean. Document the expected type for every config key.

---

### [Network] Long-Running Connection Dropped by Proxy / Load Balancer
**Description:** Nginx, cloud load balancers, and CDNs close idle connections after a timeout (often 60s). SSE streams, WebSockets, and long polls are silently killed.
**Avoid:** Send periodic heartbeat/ping messages on long-lived connections (every 25–30s). Handle reconnect gracefully on the client without showing a disconnection error for a ping gap.

---

### [Network] No Timeout on External HTTP Calls or Child Processes
**Description:** A hung external connection (SMTP, HTTP API, spawned process) can block indefinitely — leaking a connection, worker thread, or process.
**Avoid:** Always set a timeout on every external call. Handle timeout errors explicitly. For spawned processes, set a max-runtime guard that sends SIGTERM after N minutes.

---

### [Network] API Token Expiry Mid-Operation
**Description:** An access token expires mid-batch or mid-stream. The first N items succeed; the rest fail with 401 — often without a clear error message.
**Avoid:** Check token expiry before each operation in a long-running batch. Re-exchange the token proactively if within a safe window of expiry (e.g., 5 minutes). Write rotated tokens back atomically.

---

### [Security] Path Traversal in File Operations
**Description:** User-supplied filenames like `../../.env` in API requests can escape the intended directory.
**Avoid:** Always resolve and validate file paths against an allowlist of safe base directories. Verify `resolvedPath.startsWith(safeBaseDir)` before any file operation. Never construct paths from raw user input.

---

### [Security] Sensitive Values Exposed in API Responses or Logs
**Description:** Secrets, tokens, passwords, or PII leaked through API responses, error messages, or log statements — often via logging an entire config or request body.
**Avoid:** Mask all sensitive fields in API responses (replace with `***`). Never log `req.body` wholesale. Never log config objects that may contain credentials. Maintain an explicit allowlist of safe-to-return fields.

---

### [Security] XSS via innerHTML with Dynamic Data
**Description:** Inserting API response values or user input directly into `innerHTML` allows script injection.
**Avoid:** Use `textContent` for all dynamic values. Build DOM with `createElement`. Never concatenate API response data or user input into HTML strings. Sanitize with a trusted library if HTML rendering is genuinely required.

---

### [Security] SSRF via User-Supplied URLs
**Description:** A feature that fetches a URL provided by the user can be pointed at internal services, metadata endpoints, or localhost.
**Avoid:** Validate all user-supplied URLs before fetching. Block private IP ranges: `127.x.x.x`, `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`, `169.254.x.x`, and `::1`. Use an allowlist of permitted domains when possible.

---

### [Security] Settings / Config Allowlist Bypass
**Description:** An endpoint that writes configuration merges `req.body` directly, allowing arbitrary keys — including security controls — to be overwritten.
**Avoid:** Maintain a strict allowlist of writable keys. Reject any key not on the list with a 400 error. Never spread `req.body` directly into env, config, or settings objects.

---

### [State] Stale In-Memory State After Restart
**Description:** In-memory state (job maps, caches, session data) is lost on restart. On recovery, in-memory state diverges from persisted state — objects appear active in memory but are absent on disk, or vice versa.
**Avoid:** On startup, reconcile in-memory state with persisted state. Mark any in-memory `running` entries as interrupted if they aren't confirmed by the persistence layer. Re-read from disk before any state-mutating operation.

---

### [State] Corrupted Persistence File After Crash
**Description:** A crash during a file write leaves a partially written JSON/YAML/config file. The next read fails to parse and crashes the application.
**Avoid:** Use atomic writes (write to `.tmp`, then rename). On read, catch parse errors and recover from a known-good state or initialize a safe default. Never write partial structured data directly to the target file.

---

### [Environment] NODE_ENV / Runtime Environment Not Set
**Description:** `process.env.NODE_ENV` (or equivalent) is undefined — error verbosity, security posture, and production behavior are silently wrong.
**Avoid:** Default to `"development"` in application config. Log a warning if the environment is not explicitly set. Never assume production behavior without an explicit production environment flag.

---

### [Environment] .env and .env.example Out of Sync
**Description:** A new variable is added to `.env` but not `.env.example` — the next developer has no idea the variable is required.
**Avoid:** After every new env var, update `.env.example` immediately with a placeholder and descriptive comment. Run a coherence check at the start of any env-related task.

---

### [Error Handling] Swallowed Exceptions in Batch / Loop
**Description:** An error in one iteration is caught but not logged — causing silent data loss with no indication of what failed or why.
**Avoid:** Always log per-item failures with full context: identifier, error message, and stack at debug level. Continue the batch but track the failure count. Report a summary at the end.

---

### [Error Handling] No Global Unhandled Rejection Handler
**Description:** Unhandled promise rejections crash or silently corrupt state.
**Avoid:** Always add `process.on("unhandledRejection", ...)` (Node.js) or equivalent in other runtimes at the entry point of every long-running process.

---

### [Build] Secrets Committed to Version Control
**Description:** `.env`, token files, private keys, or credentials are committed — they are now in git history even if deleted.
**Avoid:** Add all secret file patterns to `.gitignore` before the first commit. Verify with `git status` before every commit. If committed: rotate all credentials immediately, clean git history, force push, notify affected parties.

---

### [Build] Log or Output Directories Committed
**Description:** Log files may contain PII (email addresses, user IDs, request payloads). Output directories may contain generated files with sensitive metadata.
**Avoid:** Both `logs/` and `output/` (or equivalents) must be in `.gitignore`. Never commit log files.

---

### [Build] Docker Compose `$` Interpolation Breaks bcrypt / Connection Strings in .env Values
**Description:** `docker compose` reads `.env` values and performs shell-style `$VAR` substitution on them. Any value containing literal `$` chars (bcrypt hashes like `$2a$14$...`, some JWT secrets, connection strings with passwords containing `$`) gets silently mangled — the substring after the second `$` is treated as a variable reference and resolves to empty, leaving the consumer container with a broken value. Compose emits a warning like `The "KNxoz..." variable is not set. Defaulting to a blank string.` but does NOT fail the deploy.
**Avoid:** Escape every literal `$` as `$$` in `.env` lines that pass through to containers. Better: when generating bcrypt / similar with embedded `$`, run a `sed -i 's/\$/\$\$/g'` on that specific line. Best long-term: switch high-`$`-content secrets to file-based mounts (`docker compose` `secrets:`) which don't interpolate.

---

### [Build] Node ESM Cannot Resolve Workspace-Only Deps from a Different WORKDIR
**Description:** In a pnpm workspace, a dependency declared in `apps/api/package.json` is symlinked at `apps/api/node_modules/<dep>` (pointing into the root `.pnpm` store) but NOT at `<root>/node_modules/<dep>`. Running `node --import <dep>/loader src/index.ts` from a different WORKDIR (e.g. `/repo`) fails with `Cannot find package '<dep>' imported from /repo/` because Node walks up looking for `node_modules/<dep>` and the symlink only lives one level deeper.
**Avoid:** In Dockerfiles, `WORKDIR` to the package's own directory (`/repo/apps/api`) before `CMD`. Or hoist the dep to the workspace root via `pnpm add -w`. Easiest tell: `Cannot find package` errors that only manifest in production builds — local dev with `pnpm --filter` works because pnpm forks the right cwd.

---

### [Build] GitHub User-Owned Container Package Visibility is UI-Only
**Description:** `PATCH /user/packages/container/{pkg}` returns 404 even with a PAT that has full `write:packages` + `delete:packages` + `repo` scopes. The same endpoint works for ORG-owned packages (`/orgs/{org}/packages/...`). User-owned package visibility can only be changed via the web UI at `https://github.com/users/<owner>/packages/container/<pkg>/settings`.
**Avoid:** Don't promise CI/automation will flip package visibility for user-owned containers. Either keep them public (containers contain no secrets at rest), authenticate consumers via PAT (write into `~/.docker/config.json`), or migrate the project to an org. Hardcode the UI URL into deploy runbooks as a manual step rather than scripting it.

---

### [Build] IaC / Blueprint Tools Report `SUCCESS` on Parse Failure
**Description:** Authentik, Terraform's `null_resource`, some Helm post-hooks, and other declarative tools log `Task finished SUCCESS` after parsing the input file — *before* validating individual entries against the target API. Individual entries can silently fail validation (e.g. "field X is required" on a serializer) while the overall task says "applied". The blueprint instance record stores `status: error` but the apply-task log line still says SUCCESS.
**Avoid:** Never trust the wrapper task status alone. Always verify: (a) the BlueprintInstance / state record has `status: successful`, (b) the target objects actually exist via a list/search API after apply, and (c) when an apply seems to work but no resources show up, drop into the tool's validator (`Importer.validate()` for Authentik) to surface field-level errors.

---

### [Build] OAuth2 / OIDC Provider Models Require `redirect_uris` Even for `client_credentials` Flow
**Description:** Authentik's `OAuth2Provider` serializer marks `redirect_uris` as required regardless of `client_type`. Even for confidential clients using `client_credentials` (no browser, no redirect), omitting the field fails validation with "This field is required". Other OIDC libraries do this too.
**Avoid:** When a serializer field is required but semantically inapplicable, pass `[]`/`{}` explicitly. Don't omit. Same pattern applies to `scope` lists on machine-to-machine flows.

---

### [Type] IaC Tools Lack `${VAR}` Substitution — Hardcode or Use Tool-Specific Tags
**Description:** Authentik blueprints, Kubernetes manifests, raw Terraform, and similar declarative YAML/HCL files do NOT perform shell-style `${VAR}` substitution by default. A literal `https://app.${DOMAIN}` is parsed as the string `https://app.${DOMAIN}`, which then fails downstream URL validation. The error appears as "Enter a valid URL" — not "unsubstituted variable" — making diagnosis annoying.
**Avoid:** Use the tool's native templating: Authentik `!Env DOMAIN` or `!Context domain`, Helm `{{ .Values.domain }}`, Kustomize `vars`, envsubst preprocessing. Or hardcode the value in source control and accept the coupling. **Never** assume shell-style `${VAR}` works in YAML/JSON IaC.

---

### [Network] curl `-L` Downgrades POST to GET on Redirect
**Description:** `curl -L` follows 301/302 redirects with GET regardless of the original method (RFC 7231 compliant default behavior). Calling `curl -L -X POST <url-with-redirect>` returns 405 Method Not Allowed because the server only accepts POST on the redirected URL. Authentik's API redirects every endpoint to its trailing-slash form, so this hits constantly.
**Avoid:** Use `--post301 --post302 --post303` to preserve the method through redirects. Or pre-compute the canonical URL (add trailing slash) and skip `-L` entirely.

---

### [Environment] Outbound Transactional Email Requires Domain Verification BEFORE SMTP Works
**Description:** Resend, Postmark, SendGrid, SES, Mailgun — every transactional email provider rejects sends from unverified sender domains. The SMTP credentials work (TLS handshake + AUTH succeed), the API key is valid, but the actual send returns a 403/550 with "domain not verified" until DKIM + SPF DNS records are in place AND the provider confirms them. Until then, password-reset emails silently fail. Authentik will log the failure but won't surface it on the password-reset flow.
**Avoid:** In any deploy runbook that uses SMTP, the FIRST email-related step is "add the domain to provider, get DNS records, paste into authoritative DNS, click verify". Wiring SMTP credentials into env vars BEFORE this is wasted work — the env is correct but no email leaves.

---

### [Build] Workspace Package Source Missing from Production Docker Image
**Description:** A pnpm-workspace Dockerfile that prunes deps with `pnpm install --frozen-lockfile --prod` and then `COPY --from=prune /repo/packages` will ship only `package.json` + the symlinked `node_modules` for each workspace package — the actual `src/` is never in the prune stage because the install step only needs manifests. The runtime image looks fine (symlinks resolve, deps are present) but every `import "@esharevice/shared"` hits `ERR_MODULE_NOT_FOUND` because the target `src/` directory doesn't exist on disk.
**Avoid:** In the runtime/runner stage, after copying `packages/` from prune, **explicitly COPY each workspace package's source from the build context**: `COPY packages/shared/src ./packages/shared/src` etc. Or do it in prune (right after the install). Add a Dockerfile comment so the next person doesn't simplify it away.

---

### [Build] @types/express + pnpm Isolated Linking + TS Bundler Resolution = Broken Type Inference
**Description:** With pnpm's default `node-linker=isolated` and TypeScript `moduleResolution: "Bundler"`, `@types/express`'s `///<reference types="express-serve-static-core" />` directive doesn't reliably resolve. Even a minimal `import type { Response } from "express"; res.status(404)` fails with `Property 'status' does not exist on type 'Response<any, Record<string, any>>'`. The trace confirms ESS-C *is* resolved, but TypeScript silently fails to expose its exported members to consuming code. Tried: `node-linker=hoisted`, `pnpm.overrides` to pin ESS-C, explicit `typeRoots`, custom `declare module` augmentations, switching to `NodeNext` resolution — none produced a clean compile.
**Avoid:** For TS Express projects in a pnpm workspace, either (a) use a framework with self-contained types (Hono, Fastify, Elysia), (b) ditch the workspace and run Express in a plain Node project, or (c) hand-define minimal `Request`/`Response`/`NextFunction` types locally and treat `@types/express` as advisory. Don't waste a session on this in 2026.

---

### [Network] POST → 307 Redirect Preserves Method, Trips Django/Authentik CSRF With 403
**Description:** `NextResponse.redirect(url)` in Next 15 defaults to **HTTP 307**, which preserves the request method on the redirect. If you POST to a Next route handler that redirects to a cross-origin Django-based service (Authentik, any DRF API), the browser POSTs the redirected URL. Django's CSRF middleware requires a CSRF token on every unsafe cross-origin POST — without one, you get `403 Forbidden — CSRF verification failed. Request aborted.` The error reads like an auth misconfiguration but is purely a method-preservation issue on the redirect.
**Avoid:** When you need a browser to switch from POST to GET on a redirect (the canonical OIDC RP-Initiated Logout flow, redirect-after-POST, any cross-origin handoff), explicitly pass `303` to `NextResponse.redirect(url, 303)`. 303 ("See Other") is the only redirect status that the HTTP spec *requires* the browser to follow with GET regardless of the original method. 301/302 are "may convert to GET" (most browsers do, but per spec they shouldn't), 307/308 must preserve. Default to 303 for any POST → cross-origin GET handoff and you'll never debug a phantom CSRF error.

---

### [Security] Prefetched GET on a State-Clearing Route Silently Logs Users Out
**Description:** Next 15's `<Link>` auto-prefetches every internal href in the viewport (production) or on hover (dev). The prefetch is a `fetch()` to the same URL with `?_rsc=…` appended. If the target is a route handler that returns `Set-Cookie` headers — e.g. a logout handler that does `clearSessionCookieOn(response)` + `NextResponse.redirect(authentikEndSessionUrl)` — the browser **applies the Set-Cookie immediately** when the 302 response arrives, BEFORE attempting the redirect. The cross-origin redirect then fails CORS preflight (`Redirect is not allowed for a preflight request`) and the prefetch errors out, but the cookies have already been evicted. Net effect: visiting any page that mounts `<Link href="/api/auth/logout">` silently signs the user out within milliseconds, with the only forensic trail being a CORS error in the console. The symptom presents as "the home page renders unauthenticated even though I just logged in."
**Avoid:** State-changing endpoints must not be reachable via GET — this is a hard rule, not a style preference. Concretely: (a) the route handler exports only `POST` (and `OPTIONS` if you support CORS — but auth handlers shouldn't), (b) the UI uses `<form action="/api/auth/logout" method="post"><button type="submit">…</button></form>` instead of `<Link>`, (c) any remaining auth `<Link>`s (login, callback) get `prefetch={false}` as defense-in-depth so a future GET handler being added on the other side doesn't reintroduce the bug. Generalize: a `Set-Cookie` header on a GET response is a smell. If you must keep GET for a state-changing route, refuse to act unless a CSRF/double-submit token is present in the query — but POST + form is the canonical answer.

---

### [Type] Cloudflare Global API Key — Legacy 37-Hex Format Has Been Replaced by `cfk_*`
**Description:** Cloudflare's Global API Key used to be a 37-character hex string. As of late 2025 they've migrated to a `cfk_<50 chars>` prefixed format without widely updating docs. Authentication still uses `X-Auth-Email` + `X-Auth-Key` headers (NOT Bearer), but auth fails with "Unknown X-Auth-Key or X-Auth-Email" if you use the wrong email — and the legacy 37-hex format check is gone, so even the right key with the wrong email gives an unhelpful "Unknown" message.
**Avoid:** When debugging Cloudflare API auth: (a) confirm the account-login email (not necessarily a developer-comms email), (b) use scoped API Tokens instead of the Global Key whenever possible — they use `Authorization: Bearer ...` and are clearly diagnosable as valid vs invalid via `GET /user/tokens/verify`, (c) the Global Key remains valuable mostly when scoped tokens can't reach an endpoint, but Cloudflare is actively deprecating it (cf. Origin CA Key deprecation banner in the dashboard).

---

## Debugging Protocol

> Before touching any code — **reproduce first, locate second, fix last.**
> Use these trees top-to-bottom. Stop at the first match and follow it to resolution.
> Always check the browser console AND the terminal simultaneously — they tell different halves of the story.

---

### Master Diagnostic — "Which Layer Is Failing?"

Every bug lives in one of these layers. Identify the layer first — then use the matching tree.

```
1. STARTUP           → Process/server fails to start at all
2. PIPELINE / BATCH  → An operation fails, fully or per-item
3. ASYNC / PROCESS   → Background worker, job, or subprocess misbehaves
4. REAL-TIME / STREAM → Server is running but client gets no live updates
5. DATA / CONTENT    → Operation succeeds but output is wrong
6. FRONTEND / UI     → Page broken, API calls failing, UI state wrong
```

---

### Tree 1 — Process Won't Start

**Step 1 — Run directly (not via a process manager)**
```bash
node server.js   # or: python main.py, etc.
# Process managers can swallow startup errors — always test directly first
```

**Step 2 — Missing env var?**
- Look for: `Error: Missing required environment variable: X`
- Open `.env` and `.env.example` side by side — find the gap
- Check: Is the env loader called before config is accessed?

**Step 3 — Missing or broken dependency?**
- Look for: `Cannot find module 'X'` / `ModuleNotFoundError`
- Run `npm install` / `pip install -r requirements.txt`
- Check the package is under the right dependency key (not `devDependencies` in production)

**Step 4 — Port already in use?**
- Look for: `EADDRINUSE`, `address already in use`
- `lsof -i :PORT` (Mac/Linux) or `netstat -ano | findstr :PORT` (Windows)

**Step 5 — File permission or missing directory?**
- Look for: `EACCES`, `EPERM`, `ENOENT`
- Check that all required directories exist and are writable
- On first run: create missing directories or add bootstrap code

**Step 6 — Corrupted config / data file?**
- Look for: `SyntaxError: Unexpected token` / `JSONDecodeError`
- Check config and data files for corruption — replace with a safe empty default and restart

---

### Tree 2 — Pipeline / Batch Failing

**Step 1 — Isolate with the smallest possible case**
```bash
# Run with a single item, a known-good input, and minimal config
# Eliminate all optional features until you have the minimum failing case
```

**Step 2 — Is it authentication?**
- Look for: `401 Unauthorized`, `403 Forbidden`, `Invalid credentials`
- Verify credentials in `.env` are correct and non-expired
- Test auth in isolation before retesting the full operation

**Step 3 — Is it a connection failure?**
- Look for: `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`
- Verify host, port, and protocol are correct
- Test raw connectivity: `curl`, `telnet`, `ping`

**Step 4 — Is it a rate limit or throttle?**
- Look for: `429 Too Many Requests`, `421`, `450`, `452`
- Reduce concurrency and add delay between requests

**Step 5 — Is it a per-item failure?**
- Check logs — failures should be logged per item with context
- Reproduce with the single failing item in isolation

**Step 6 — Is it a dependency / tool availability issue?**
- Check that all external tools/binaries are installed and accessible
- Verify paths are correct and executables are on PATH

---

### Tree 3 — Async / Background Process Issues

**Step 1 — Did it start at all?**
- Check in-memory or persisted job state — is status `running`?
- Verify the entry point command and arguments are correct
- Run the exact command manually to see if it starts

**Step 2 — Is it crashing immediately?**
- Run manually with the exact arguments the orchestrator would use
- Look at exit code: `1` = startup error; `null` = killed by signal
- Check: does the config/input file it expects actually exist?

**Step 3 — Is output being parsed correctly?**
- Add raw logging of every output chunk before parsing
- Verify you're buffering and splitting on the correct delimiter
- Common failure: partial lines split across two chunks

**Step 4 — Is it hanging (not exiting)?**
- Check for unclosed handles: open connections, pending I/O, unreleased resources
- Ensure all pools (DB, HTTP, SMTP, etc.) are explicitly closed after use
- Set a maximum runtime timeout — SIGTERM after N minutes if not completed

**Step 5 — Is stderr being captured?**
- Always capture and log stderr separately — it often contains the real error

---

### Tree 4 — Real-Time / Streaming Not Updating

**Step 1 — Is the connection established?**
- Browser DevTools → Network → filter by EventStream / WS
- If no connection: the client never opened it — check client-side setup code
- If connection opens and immediately closes: server ended it prematurely

**Step 2 — Is the server sending events?**
- Check server logs for outgoing event writes
- If no events: the background process output isn't producing parseable messages, or the parser is failing silently

**Step 3 — Is the client receiving but not rendering?**
- DevTools → Network → Messages column for the stream connection
- If messages appear but UI doesn't update: the event handler has a bug
- Add `console.log` inside the event handler temporarily

**Step 4 — Did the connection drop mid-operation?**
- Look for reconnect attempts (status cycling back to `CONNECTING`)
- Common cause: proxy timeout on idle connection
- Fix: send heartbeat pings every 25–30 seconds server-side

---

### Tree 5 — Data / Content Wrong

**Step 1 — Which transformation step is failing?**
- Map out the pipeline: input → step A → step B → output
- Add logging at each step boundary to find where output diverges from expectation

**Step 2 — Is it a variable/template resolution issue?**
- Does the placeholder appear literally in the output? → It was never substituted
- Check variable name spelling and case (keys are usually case-sensitive)
- Check: is the variable defined at the point where substitution runs?

**Step 3 — Is it a type coercion issue?**
- Is a number being treated as a string? A boolean as `"true"`?
- Log the actual type (`typeof`, `type()`) at the point of use — don't assume

**Step 4 — Is it a timezone or locale issue?**
- Dates and times are a common source of off-by-one-hour bugs
- Log the raw value and the interpreted value together
- Set `TZ` env var explicitly if timezone consistency is required

**Step 5 — Is it an encoding issue?**
- Check: is output being double-encoded (HTML entities escaped twice)?
- Check: is binary data being treated as UTF-8?
- Check: are line endings (`\r\n` vs `\n`) causing parse failures?

---

### Tree 6 — Frontend / UI Issues

> Always have **browser DevTools open** before debugging frontend issues.
> Console + Network tabs are your primary tools.

**Step 1 — Open DevTools immediately**
```
Chrome/Edge/Firefox: F12 or Cmd+Option+I
Open BEFORE reproducing the bug — errors that flash and disappear are in the console log.
Check: Console (JS errors), Network (failed requests), Application (storage state)
```

**Step 2 — Is it a JS error?**
- Read the full error message and stack trace in the Console tab
- Click the filename:line to open the source and set a breakpoint
- Common causes: `null` element (wrong selector or element not yet in DOM), `undefined is not a function` (wrong scope or load order), `SyntaxError` (script fails entirely — nothing after it runs)

**Step 3 — Is a view / component not loading?**
- Network tab: is the request for the view/component returning 200?
- If 404: the file doesn't exist or the path is wrong
- If 200 but not rendering: the injection or mount code has a bug
- Log the fetched content before rendering to verify it's what you expect

**Step 4 — Is an API call failing?**
- Network tab → Fetch/XHR → find the failing request
- Check: Status code, Response body (read the error message), Request headers

| Status | Likely Cause |
|---|---|
| 400 | Validation failed, wrong body shape |
| 401 | Auth required — token missing or expired |
| 404 | Wrong URL, route not registered |
| 413 | Request body too large |
| 500 | Unhandled server error — check terminal for full error |
| `ERR_CONNECTION_REFUSED` | Server is not running |

**Step 5 — Is a button or form not responding?**
- Console: any errors on click?
- Is the event listener attached to the right element?
- Is the element present in the DOM when `addEventListener` is called? (In SPAs, elements injected dynamically may not exist yet at listener setup time)
- DevTools console: `getEventListeners(document.querySelector("#your-element"))`

**Step 6 — Is UI state wrong or stale?**
- Hard reset: `Cmd+Shift+R` / `Ctrl+Shift+R` (cache-busting refresh)
- Check storage: DevTools → Application → Local Storage / Session Storage / Cookies
- If state is stale after navigation: the view teardown/cleanup isn't resetting the right variables

**Step 7 — Is it a CSS/rendering issue only?**
- Elements tab → inspect the element → check computed styles in the right panel
- Look for: strikethrough styles (overridden), `display: none`, `visibility: hidden`, `opacity: 0`, z-index issues, overflow clipping
- Toggle styles on/off in the Elements panel to isolate before touching CSS files

---

### Debugging Toolbox — Universal Commands

```bash
# Check what's listening on a port
lsof -i :3000

# Watch a log file live
tail -f logs/app.log | grep -E "ERROR|WARN"

# Validate a JSON file
node -e "JSON.parse(require('fs').readFileSync('data/file.json'))" && echo "OK" || echo "CORRUPTED"
python -c "import json; json.load(open('data/file.json')); print('OK')"

# Dump env vars (development only — never in production)
node -e "require('dotenv').config(); console.log(process.env)" | grep -E "KEY_PATTERN"

# Node.js — inspect with Chrome DevTools
node --inspect server.js
# Then: chrome://inspect → click "inspect"

# Node.js — pause at first line
node --inspect-brk script.js

# Check for open handles keeping a Node process alive
node -e "const wtf = require('wtfnode'); setTimeout(wtf.dump, 5000);"
```

---

### Debugging Mindset Rules

1. **Read the actual error** — the message tells you the layer. Don't guess before reading it fully including the stack trace
2. **One variable at a time** — change one thing, test, confirm, then move to the next
3. **Reproduce minimally** — strip to the smallest case that shows the bug
4. **Console + terminal simultaneously** — frontend bugs often have server-side causes and vice versa
5. **Use test/safe mode first** — never debug against production data or real side effects if a sandbox exists
6. **Check the Network tab before assuming a JS bug** — many "frontend bugs" are failed API calls
7. **Verify your assumptions** — log the actual value before assuming what it is
8. **The bug is usually where you're most confident** — check your assumptions there first
9. **If it worked before** — `git diff` to see what changed. The bug is almost always in the diff
10. **Log it before you fix it** — document what the bug was, what you found, and what fixed it in the task log

---

## Self-Healing Protocol

1. **Stop** — don't build on a broken foundation
2. **Identify** — name the bug type (from registry or coin a new one)
3. **Assess scope** — how much existing code is affected?
4. **Consider context** — does this component run in multiple contexts? Verify all of them
5. **Fix** — apply the correct defensive pattern
6. **Verify** — test original failure case + edge cases
7. **Log** — append to Living Bug Registry if it's a new pattern
8. **Update task log** — record what happened with timestamp
9. **Continue** — resume with corrected code

---

## Update Protocol

### New Bug Registry Entry

```
### [Category] Short Title
**Description:** What it is, when it occurs, why it's subtle.
**Avoid/Fix:** Strategy + code snippet if helpful.
```

### Updating Any Doc, Research, or Task File

1. Update `Last Updated: YYYY-MM-DD HH:MM UTC` at the top
2. Append to Progress Log or Changelog — never overwrite history
3. Update Status if it changed
4. Link related docs/research if relevant

---

*Last updated: 2026-05-15 23:55 UTC | Global SWE Agent Config | Adapt the Architecture and Project Structure sections per project — everything else applies universally. Bug registry: 39 entries (+2 from the week-5 logout-prefetch incident — the GET-prefetch bug and the 307→303 CSRF cascade it uncovered).*