# VPS Deployment Log — e-Sharevice (esharevice.com on Hostinger)

**Created:** 2026-05-12 22:00 UTC
**Last Updated:** 2026-05-13 00:30 UTC
**Status:** Stack live; Authentik fully provisioned; typed Hono /v1 API serving real routes

The runbook's prerequisites were sourced from `tasks/.env.creds` (gitignored). The user opted for the "fast path" (option B in the kickoff exchange): use the master credentials once for setup, rotate after. **All four credentials below MUST be rotated** before this is treated as production.

---

## What's running

**Host:** Hostinger VPS, Ubuntu 24.04.4 LTS, `srv1582698`, public IP `2.24.195.151`, ~44 ms RTT from EU. Hardened: ufw allows 22/80/443 only, fail2ban active, unattended-upgrades on, root SSH disabled, password auth disabled, `ops` user with passwordless sudo and docker group.

**Docker stack (`/opt/esharevice/infra/docker-compose.yml`):** 8 services all healthy as of last check.

| Service | Image | State |
|---|---|---|
| postgres (app) | postgres:16-alpine | healthy |
| authentik-postgres | postgres:16-alpine | healthy |
| redis | redis:7-alpine | healthy |
| authentik-server | ghcr.io/goauthentik/server:2024.12 | healthy |
| authentik-worker | ghcr.io/goauthentik/server:2024.12 | healthy |
| api | ghcr.io/myndgrid/esharevice-api:latest | healthy |
| web | ghcr.io/myndgrid/esharevice-web:latest | up |
| caddy | caddy:2-alpine | up (TLS issued for 5 hosts) |
| uptime-kuma | louislam/uptime-kuma:1 | healthy |

**Public endpoints (verified):**

| URL | Status | Notes |
|---|---|---|
| https://app.esharevice.com | 200 | Next.js 15 standalone, Inter font, dark/light tokens loaded |
| https://api.esharevice.com/health | 200 | `{"status":"ok"}` |
| https://api.esharevice.com/v1/health | 200 | `/v1` namespace works |
| https://auth.esharevice.com | 302 → login flow | Authentik, ready for admin setup |
| https://esharevice.com | 301 → app | Caddy redirect block |
| https://www.esharevice.com | 301 → app | Caddy redirect block |
| https://uptime.esharevice.com | 401 | Basic auth (ops@${random}) — replace the password |

**Cloudflare DNS state (final):** 6 A records, all gray-cloud (DNS-only). Wildcard `*` deleted; root + www repointed and unproxied. Caddy owns all TLS.

---

## Bug log — what went wrong, what fixed it

1. **Cloudflare key debugging.** First two `cfk_*` Global API Keys returned `Unknown X-Auth-Key or X-Auth-Email`. Root cause: I guessed wrong on the account email. The correct email is `myndgridinc@gmail.com`; with that, the key works against `/zones?name=esharevice.com`. Note: Cloudflare has migrated the global key format to `cfk_*` (54 char total) without updating docs widely — the legacy 37-hex format I expected is gone.
2. **GHCR push denied: missing `write:packages` scope.** User-side `gh auth refresh -s write:packages,read:packages` then `gh auth token | docker login ghcr.io` worked. Both packages defaulted to private; user flipped to public via UI (GitHub API has no PATCH-visibility endpoint for user packages).
3. **`pnpm add tsx` in Dockerfile prune stage failed** with `ERR_PNPM_INCLUDED_DEPS_CONFLICT`. Fix: move `tsx` from devDependencies → dependencies in `apps/api/package.json`; drop the extra `pnpm add` step from the Dockerfile (now `--prod` install retains tsx automatically).
4. **`apps/web/public/` didn't exist locally** so the Next.js standalone Dockerfile failed on COPY. Fix: add an empty `.gitkeep`.
5. **`Cannot find package 'tsx'` at runtime.** tsx is a workspace-package dep, symlinked at `apps/api/node_modules/tsx`, NOT at the root `node_modules/tsx`. Node was being invoked from WORKDIR=`/repo` and couldn't resolve it. Fix: `WORKDIR /repo/apps/api` right before CMD; switch CMD to relative `src/index.ts`.
6. **`UPTIME_BASIC_AUTH_HASH` had `$` chars** (bcrypt format) which docker-compose interpreted as variable references, emitting `KNxoz...` not set warnings and rendering the hash as empty. Fix: escape `$` → `$$` in `infra/.env`; also pass the env var into the Caddy service's `environment:` block (it was set in the env file but never plumbed to Caddy).
7. **Caddy `header_up X-Forwarded-Proto {scheme}` deprecated** — Caddy 2 sets these by default. Removed the explicit lines.
8. **Restore drill failed on empty pre-migration DB** (`relation "users" does not exist`). Fix: wrap row counts with `WHERE to_regclass('public.users') IS NOT NULL`. The drill now tolerates the pre-migration state, while still failing loudly on actual decrypt/restore errors.

9. **Authentik blueprint silent failures.** Authentik's worker logged `Task finished SUCCESS` for the blueprint apply but the Providers / Applications UI was empty. Three sequential bugs in our `infra/authentik/blueprints/esharevice.yaml`, each surfaced one at a time by running `Importer.validate()` inside the container:
   - **Bug 9a**: `CertificateKeyPair` cannot be created from a blueprint alone — it needs PEM `certificate_data`. Fix: drop the entry that tried to create `esharevice-jwt` and reference Authentik's built-in `"authentik Self-signed Certificate"` instead.
   - **Bug 9b**: `meta_launch_url: 'https://app.${DOMAIN}'` failed URL validation. Authentik blueprints don't do docker-compose-style `${VAR}` substitution. Fix: hardcode `esharevice.com`. (Authentik does support `!Env` / `!Context` tags for templating; deferred until needed.)
   - **Bug 9c**: The partners OAuth2 provider (client_credentials flow) failed with `redirect_uris: This field is required` even though that flow doesn't redirect. Fix: add explicit `redirect_uris: []`.
   - After all three fixes + `POST /api/v3/managed/blueprints/{pk}/apply/`, the blueprint applied cleanly: 3 OAuth2 providers + 3 Applications + 1 group (`esharevice-users`) all created. OIDC discovery now serves at `https://auth.esharevice.com/application/o/e-sharevice-web/.well-known/openid-configuration`.

10. **Curl `-L` downgrades POST to GET on redirect.** When triggering the blueprint apply via API, Authentik's URL routing 301-redirects (no trailing slash → trailing slash), and curl's default behavior is to re-issue as GET — which returns 405 Method Not Allowed. Fix: pass `--post301 --post302`.

11. **Authentik API JSON has embedded control chars** (icon SVG bytes for default blueprints), making strict `json.loads` choke. Fix: parse with `strict=False`.

12. **GHCR private-package flip is UI-only for user-owned packages.** A new GitHub PAT with full `write:packages` / `delete:packages` / `repo` scopes still returns 404 on `PATCH /user/packages/container/{pkg}`. The endpoint exists for org packages but not user packages — confirmed via direct API probing. Two viable paths:
   - Keep packages public (images contain no secrets at rest — secrets land via env from `infra/.env` at run time; the same code is already in a public repo). Zero work.
   - Click each package's settings page in the UI and flip visibility manually.
   Either way, the VPS is now authenticated to ghcr.io via the new PAT, so private images work the moment the user flips them. Credentials live at `/home/ops/.docker/config.json` on the VPS (root readable, ops readable). Docker prints a warning about unencrypted credentials; that's fine for a single-node deploy. A credential helper (pass / secretservice) can be wired later.

13. **Resend domain verification.** The send-only API key is properly scoped and works for SMTP, but `esharevice.com` must be verified in Resend before outbound emails go through (we got a 403 `validation_error` on the first send-test). User needs to add the domain in resend.com/domains, paste the DKIM/SPF/MX records into chat, and I'll add them to Cloudflare DNS via API. The SMTP credentials in `infra/.env` are already wired; emails start flowing the instant the domain verifies.

---

## What still needs you (post-deploy)

### 🔑 Rotate four secrets (mandatory before production):

1. **Cloudflare Global API Key** → create a scoped DNS token at https://dash.cloudflare.com/profile/api-tokens (template "Edit zone DNS", zone = esharevice.com). Replace `cfk_*` in your password manager.
2. **VPS root password** is now moot (root SSH disabled + password auth disabled) — but rotate it anyway in Hostinger's panel for hygiene.
3. **Backblaze B2 Master Application Key** → create a bucket-scoped key for `esharevice-backups` only, update `/root/.config/rclone/rclone.conf` on the VPS, then `b2 application-keys delete` the master.
4. **Sentry org auth token** is only used for project/DSN management. Move to your password manager; rotate periodically. The DSNs themselves (in `infra/.env`) are not secret.

### 🔐 Save these to your password manager:

- **age private key** for backup encryption (printed above; also at `/root/.age/identity.key`):
  - Without it you cannot decrypt any backup ever, including in a real outage.
- **Authentik admin password** when you create it
- **Generated secrets** in `/opt/esharevice/infra/.env` (POSTGRES_PASSWORD, AUTHENTIK_POSTGRES_PASSWORD, AUTHENTIK_SECRET_KEY, SESSION_COOKIE_SECRET) — these are recoverable only from that file

### Outstanding actions

- [x] ~~**Authentik initial admin setup**~~ — done. `akadmin` user exists.
- [x] ~~**OIDC client secret wired**~~ — done. `OIDC_CLIENT_SECRET` in `infra/.env` reflects the value generated for the `e-sharevice-web` OAuth2 provider; web container restarted.
- [ ] Configure social OAuth (Google + GitHub) in Authentik admin UI: Directory → Federation & Social Login. Paste the redirect URIs Authentik gives you into Google/GitHub OAuth app settings.
- [ ] Apple Sign-In: deferred until the iOS app exists (Apple Developer account required).
- [ ] Sentry SDKs not yet wired into application code — the env DSNs are set, but `Sentry.init()` calls land alongside the real `apps/api` and `apps/web` feature code in weeks 3-7. Until then, no errors flow to Sentry.
- [ ] OIDC client implementation in `apps/web` (`oauth4webapi` + four route handlers under `app/api/auth/`) is a week 5 task. Until then, the env vars are set but no login flow exists in the web app yet.
- [ ] **Verify `esharevice.com` in Resend** at https://resend.com/domains so password-reset / signup-verification emails actually leave Authentik. Paste the DNS records here and I'll add them via the Cloudflare API.
- [ ] (Optional) flip both GHCR packages to private — the VPS docker is already authenticated, so pulls keep working either way. Both URLs are in the bug log above (item 12).

---

## Backups

- **Daily** at 03:00 UTC via `/etc/cron.d/esharevice-backup`. Runs `pg_dump` on both DBs (app + authentik), gzip, age-encrypts with the public key, rclone uploads to `b2:esharevice-backups/daily/<UTC timestamp>/`.
- **Quarterly** restore drill on 1st of every 3rd month at 04:00 UTC. Pulls the latest dump, decrypts, restores into a throwaway Postgres container, asserts the schema responds. **Drill ran once now and succeeded.**
- **Retention:** 30 days. Older snapshots auto-pruned.
- **First backup uploaded:** `b2:esharevice-backups/daily/20260514T220141Z/` — 742 B (app) + 1.1 MB (authentik).

---

## Topology

```
Internet
   │
   ▼
Cloudflare DNS (6 A records, all gray-cloud, no proxy)
   │
   ▼
Hostinger VPS 2.24.195.151
   │
   ▼
Caddy :80/:443  (auto-TLS, HTTP/3, HSTS preload)
   ├── app.esharevice.com   → web:3000
   ├── api.esharevice.com   → api:8080
   ├── auth.esharevice.com  → authentik-server:9000
   ├── uptime.esharevice.com → uptime-kuma:3001 (basic auth)
   └── esharevice.com, www.esharevice.com → 301 → https://app.esharevice.com

Internal docker network (no internet egress for datastores):
  postgres       — app DB
  authentik-postgres — Authentik DB (dedicated, isolated upgrade path)
  redis          — rate limit / refresh tokens / idempotency / Authentik cache
  authentik-worker — async tasks
```

---

## Progress Log

### 2026-05-13 00:30 UTC — Hono API deployed
- Swapped `apps/api` from Express to Hono. Typecheck clean on first attempt; no `@types/*` peer-dep gymnastics needed.
- Live behind Caddy: `/health`, `/v1/health`, `/v1/me`, `/v1/exchange-items` (list, get, create, reserve), `/v1/openapi.json`, `/v1/docs`.
- Smoke tests through `api.esharevice.com` all green: unauthenticated `/v1/me` returns `application/problem+json` 401 (RFC 7807); public `/v1/exchange-items?q=carpentry` runs Postgres FTS via the GIN index and returns the empty page.
- One Dockerfile fix surfaced during deploy: the prune stage only ships `package.json` for workspace packages — the actual `packages/shared/src/`, `packages/db/src/`, and `packages/db/drizzle/` had to be COPYed from the build context into the runner. Captured in the bug registry as a [Build] entry.

### 2026-05-12 22:45 UTC
- VPS docker authenticated to ghcr.io with a fresh GitHub PAT (`/home/ops/.docker/config.json`). Both `esharevice-{api,web}:latest` pull successfully.
- Investigated the GHCR visibility-flip API again with the new PAT (full `write:packages` + `delete:packages` + `repo`) — confirmed 404 on `PATCH /user/packages/container/{pkg}`. The endpoint is genuinely org-only for user-owned packages. UI flip is the only path; the VPS works either way.
- Resend SMTP credentials wired into `infra/.env` on the VPS (`AUTHENTIK_EMAIL_HOST/PORT/USERNAME/PASSWORD/FROM`); Authentik server + worker restarted. Confirmed both come back healthy.
- Send-test against the Resend API failed with `domain not verified` — the SMTP path will reject sends until the user adds DKIM/SPF DNS records and clicks Verify in resend.com/domains. Logged in outstanding actions.

### 2026-05-12 22:20 UTC
- Authentik fully provisioned: `akadmin` set up, three OAuth2 providers (web/mobile/partners) + three Applications + `esharevice-users` group all created via blueprint.
- OIDC discovery endpoint confirmed live and serving valid metadata.
- `OIDC_CLIENT_SECRET` for `e-sharevice-web` (auto-generated by Authentik) written into `infra/.env`; web container restarted to pick it up.
- Three blueprint bugs surfaced and fixed (see issues 9a-c in the bug log above). The blueprint is now idempotent.
- Web app code does not yet implement OIDC login — that's a week-5 deliverable (`oauth4webapi` + auth route handlers). For now, the env is fully wired and discovery works end-to-end.

### 2026-05-12 22:00 UTC
- Stack fully provisioned. 9 of 11 todo items complete; remaining 2 (Authentik admin + OIDC client secret wiring) require user.
- All eight Docker services healthy. Five Let's Encrypt certs issued.
- Daily backup cron live; first backup uploaded; restore drill green.
- Sentry DSNs wired; SDKs to be installed in app code during week 3+ of the migration plan.
- VPS deploy log written here; lives alongside the original 2026-05-12 provisioning runbook for cross-reference.
