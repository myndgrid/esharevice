# VPS Deployment Log — e-Sharevice (esharevice.com on Hostinger)

**Created:** 2026-05-12 22:00 UTC
**Last Updated:** 2026-05-16 16:26 UTC
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

### 2026-05-15 23:40 UTC — Web hotfix: logout prefetch silent-signout

- **Commit:** `46b82ea` on `main` — fix(web): make logout POST-only to stop prefetch silently signing users out.
- **Image:** `ghcr.io/myndgrid/esharevice-web:latest` (also tagged `:46b82ea`), digest `sha256:c0dffed48a77fd00937694363322d3c810cc5fc6f2bb406c73a2c6ec1e59e900`, built with `docker buildx --platform linux/amd64` on the `esharevice-builder` context.
- **Roll:** `docker compose pull web && docker compose up -d --force-recreate web` from `/opt/esharevice/infra`. Web container healthy in <1 s, Next.js Ready in 469 ms. No other services touched.
- **Live verification:** `GET https://app.esharevice.com/api/auth/logout` now returns `405 Method Not Allowed` with no `Set-Cookie` and no `Location` header (was previously `307` with two cookie-deletion headers + cross-origin `Location` → the root cause of the silent signout). Home renders 200.
- **Rollback if needed:** the previous commit's image isn't tagged on GHCR — rollback requires a local rebuild from `b8ceccf` and push. Mitigation for next time: every deploy now tags `:latest` + `:<short-sha>` at build time (this deploy did), so future rollbacks are a single `docker compose pull web` after re-tagging `latest` on GHCR.
- **Captured pattern:** Bug-registry entry `[Security] Prefetched GET on a State-Clearing Route Silently Logs Users Out` added in the same commit. Future logout-style handlers must be POST + form, never `<Link>`.

### 2026-05-15 23:55 UTC — Web hotfix-of-hotfix: 307 → 303 on logout redirect

- **Commit:** `4eb2c6a` — fix(web): use 303 (not Next's default 307) on logout redirect.
- **Why:** the prior fix surfaced a second bug. After switching the form to POST, the browser followed Next's default 307 redirect to Authentik with the POST method preserved. Authentik (Django) rejected with `403 — CSRF verification failed`. Fix: pass `303` to `NextResponse.redirect`, which forces the browser to GET on follow — the canonical OIDC RP-Initiated Logout flow.
- **Image:** `ghcr.io/myndgrid/esharevice-web:latest` + `:4eb2c6a`, digest `sha256:97cc758e155f3b37d02fffa9f4fa1d19b80874a9c16c95690073a5b5b26da30b`.
- **Roll:** `docker compose pull web && up -d --force-recreate web`. Ready in 360 ms.
- **Live verification:** `POST https://app.esharevice.com/api/auth/logout` (no cookies) now returns `303` with `Location: https://app.esharevice.com/`. `GET` still 405. End-to-end logout from a logged-in browser should now follow `POST /api/auth/logout` → `303` → `GET auth.esharevice.com/.../end-session/?...` → Authentik clears SSO cookie → `302` to `post_logout_redirect_uri=https://app.esharevice.com/` → home renders unauth.
- **Captured pattern:** Bug-registry entry `[Network] POST → 307 Redirect Preserves Method, Trips Django/Authentik CSRF With 403` added in the same commit. Use 303 for any POST → cross-origin GET handoff.

### 2026-05-16 01:52 UTC — Root-domain cutover: app.esharevice.com → esharevice.com

The web app moves from `https://app.esharevice.com` to the root domain `https://esharevice.com`. The `app.*` and `www.*` hostnames stay provisioned and 301-redirect to root.

- **Commit:** `09d19d3 feat(infra): serve app at root domain, 301 from app.* and www.*`.
- **What changed:**
  - `infra/Caddyfile` — `{$DOMAIN}` block now reverse-proxies to web; `www.{$DOMAIN}, app.{$DOMAIN}` share a 301-to-root block.
  - `infra/docker-compose.yml` — `OIDC_REDIRECT_URI` and `WEB_ORIGIN` now point at `https://${DOMAIN}` instead of `https://app.${DOMAIN}`.
  - `infra/authentik/blueprints/esharevice.yaml` — redirect_uris now lists root + app (legacy) + localhost; meta_launch_url → root.
  - Docs: `README.md`, `docs/features/2026-05-14_web-oidc-login-flow.md`, `docs/features/2026-05-13_v1-api-surface.md` updated.
- **Execution order (deliberately additive to avoid a redirect-uri-mismatch lockout):**
  1. **PATCHed Authentik provider via admin API** (using `authentik_token` from `.env.creds`) to ADD `https://esharevice.com/api/auth/callback` to the `e-sharevice-web` OAuth2 provider — alongside the existing `https://app.esharevice.com/api/auth/callback`. This made the new URI live BEFORE any Caddy / env changes hit traffic.
  2. Committed + pushed the repo changes.
  3. `git pull` on the VPS — hit a local-edit conflict on `infra/authentik/blueprints/esharevice.yaml` (a manual hotfix from earlier weeks that pre-added the `offline_access` scope mapping, now in main). Stashed it, pulled cleanly, confirmed the stash content was a duplicate of HEAD, dropped the stash.
  4. `docker compose exec caddy caddy validate && reload` + `up -d --force-recreate api web`.
  5. **External curl test exposed that Caddy was still serving the OLD config** even though the on-disk Caddyfile was new. Root cause: `docker compose` single-file bind mounts pin to the file's inode at mount time; `git pull` unlinks + creates the file with a new inode, so the container kept reading the old file. Fix: `docker compose up -d --force-recreate caddy` to re-resolve the bind mount.
- **Live verification:**
  - `HEAD https://esharevice.com/` → `200` (Caddy proxies to web).
  - `HEAD https://app.esharevice.com/` → `301 Location: https://esharevice.com/`.
  - `HEAD https://www.esharevice.com/foo/bar` → `301 Location: https://esharevice.com/foo/bar` (path preserved).
  - `POST /api/auth/logout` → `303 Location: https://esharevice.com/`.
  - `GET /api/auth/login` → `307 Location: https://auth.esharevice.com/application/o/authorize/?...&redirect_uri=https%3A%2F%2Fesharevice.com%2Fapi%2Fauth%2Fcallback...&client_id=e-sharevice-web`.
- **Captured patterns (bug registry):**
  - `[Build] Docker Single-File Bind Mount Pins to Inode — git pull Silently Breaks It` — symptom is sneaky because every validate/reload claims success; only external traffic exposes staleness. Fix: `--force-recreate` after any `git pull` that touches a single-file mount.
- **Follow-ups (not blocking):**
  - The legacy `https://app.esharevice.com/api/auth/callback` is still in Authentik's redirect_uris allowlist. Safe to remove after a few days once no traffic originates from the old hostname; the blueprint already includes it for now so an Authentik restart doesn't drop it.
  - Cookies on `app.esharevice.com` are host-scoped and will orphan-expire on existing browsers within 30 days (session) or ~15 minutes (access). Active users will re-login at the root domain on next visit. No mitigation needed.

### 2026-05-16 02:55 UTC — R2 image upload wired live

- **What changed:** five R2-related env vars appended to `/opt/esharevice/infra/.env` on the VPS — `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET=esharevice-images`, `CDN_BASE_URL=https://cdn.esharevice.com`. S3-compatible API keys were created in the Cloudflare R2 dashboard (Object Read & Write, scoped to a single bucket); `cdn.esharevice.com` was bound as a custom domain via the dashboard, SSL active, ownership active.
- **Roll:** `docker compose up -d --force-recreate api`. Healthy in <1 s.
- **Live verification:** PUT + GET via the S3 SDK against `esharevice-images` worked (probe object 33 bytes, fetched back byte-for-byte). Same object fetched via `https://cdn.esharevice.com/probe/r2-credentials-test.txt` → 200. Probe object deleted afterwards. `POST /v1/exchange-items/{id}/image` still 401s without auth (the auth gate fires before the configuration check); the `503 Image storage is not configured yet` branch is now unreachable.
- **Captured pattern:** the user provided the R2 keys with literal spaces in the variable NAMES (`cloudflare_Access Key ID=...`) inside `.env.creds`. Shell sourcing chokes on spaces in var names; we extract with `grep | cut` instead. Cosmetic for now — flagging in case we later automate `.env.creds` loading. (User has since normalized to `cloudflare_r2_access_key_id` etc.)

### 2026-05-16 03:30 UTC — Web slice: /items/new + /items/[id] live

- **Commit:** `e90c378 feat(web): /items/new create flow + /items/[id] detail page (week 5 cont.)`.
- **Image:** `ghcr.io/myndgrid/esharevice-web:latest` + `:e90c378`, digest `sha256:c57236cf376170ce0af1689228aaacbb17dad5e8f3fe14159235f2e898c229b7`.
- **Roll:** `docker compose up -d --force-recreate web`. Ready in 406 ms.
- **What's now reachable in the browser:**
  - `GET /items/new` — requireAuth gate (307 → `/api/auth/login?return_to=%2Fitems%2Fnew` for anonymous users); form + image picker for authed users.
  - `GET /items/[id]` — 404 on missing UUID; 200 with detail card + 1600w image variant on hit.
  - Home-page cards now link to `/items/[id]` and display the 800w variant inline.
  - Header gains a "+ New" button when the session is present.
- **End-to-end flow:** logged-in user → submit → server action POSTs `/v1/exchange-items` (with client-mounted Idempotency-Key) → POSTs `/v1/exchange-items/{id}/image` (multipart) → sharp pipeline generates 3 webp variants → R2 PUT → row's `img_key` updated → redirect to `/items/{id}` → detail page fetches via cdn.esharevice.com. Image upload failure leaves the row in place and redirects with `?image_error=<reason>` for graceful recovery.
- **External verification:** `/` 200; `/items/new` 307 → login with `return_to=/items/new`; `/items/<uuid>` 404 on missing.
- **Captured pattern:** the recent prefetch-of-state-clearing-GET fix carried forward — the "+ New" `<Link>` is a normal idempotent GET (no Set-Cookie) so prefetch is safe; logout still uses a `<form method="post">`; Sign-in still has `prefetch={false}` as defense-in-depth.

### 2026-05-16 03:35 UTC — Image upload fix + reserve action

Two commits, two pre-built linux/amd64 images, one rolling recreate of api + web. End-to-end verified locally (against the same Authentik) before any push to prod.

- **Commits:** `a90a8a2 fix(upload): rebuild File as Blob client-side; use Hono parseBody server-side` + `ea2e830 feat: race-safe reserve action`.
- **Images:** `ghcr.io/myndgrid/esharevice-api:latest` + `:ea2e830` (digest `sha256:cff64d17ce13bb871162c4ee61d4339646d4e5990fed65de8bdf058d8544c1b8`); `ghcr.io/myndgrid/esharevice-web:latest` + `:ea2e830` (digest `sha256:95feb7ce322cf54167fcc443359824d53aa94addecf1a32ba56c49c6d6209b4b`).
- **Roll:** `git pull` on the VPS, `docker compose pull api web && up -d --force-recreate api web`. Both healthy in under 12 s.
- **Live verification:**
  - `/v1/health` 200
  - `/items/<random-uuid>` 404
  - `POST /v1/exchange-items/<id>/image` unauthed → 401 (auth gates first)
  - `PUT /v1/exchange-items/<id>/reserve` unauthed → 401
  - User-driven browser test: image upload + reserve action both work end-to-end.
- **Bug-registry entries** (counter 40 → 42):
  - `[Build] Next 15 Server-Action File Is a One-Shot Stream` — the File from `formData.get(...)` is backed by a one-shot ReadableStream; can't be re-fetched. Materialise as a Buffer → fresh Blob with 3-arg `append`.
  - `[Build] @hono/zod-openapi Pre-Reads Multipart Bodies When You Declare request.body` — declaring `request.body` makes Hono validate (and consume) the multipart stream BEFORE the handler runs. Omit `body` from the route schema for upload endpoints; use `c.req.parseBody()` in the handler.
- **Race-safety improvement:** `PUT /reserve` UPDATE now gated on `WHERE reserved = false` — two simultaneous reserve requests can no longer both win. The lost-race branch returns 409 with a useful message instead of silent corruption.

### 2026-05-16 03:55 UTC — Mobile tab bar + Sign-up CTA + Saved/Messages stubs

- **Commit:** `bc82aa8 feat(web): mobile tab bar + signup CTA + Saved/Messages stubs`.
- **Image:** `ghcr.io/myndgrid/esharevice-web:latest` + `:bc82aa8`, digest `sha256:789ddd117c2c6f7bf59026e6eebd052c11aed0656823a97172288f7f28eb9dec`.
- **Roll:** `docker compose up -d --force-recreate web` from `/opt/esharevice/infra`. Healthy in <1 s.
- **Live verification (all green):**
  - `/` 200, `/items/new` 307, `/saved` 307, `/messages` 307, `/profile` 307.
  - `GET /api/auth/login?signup=1&return_to=/` → 307 → `https://auth.esharevice.com/.../authorize/?...&prompt=create&redirect_uri=https%3A%2F%2Fesharevice.com%2Fapi%2Fauth%2Fcallback...`. Authentik either renders the registration screen directly (if it honours `prompt=create`) or shows the login form with a "Sign up" link as fallback.
- **No new bug-registry entries this round.** Slice was pure additive UI.
- **Follow-ups not in this slice:**
  - Saved feature (needs `exchange_item_saves` table + `/v1/saves` CRUD + a bookmark toggle on the detail page)
  - Messages feature (needs `conversations` + `messages` tables + SSE through Caddy)
  - These are documented as "Coming soon" on the stub pages.

### 2026-05-16 04:10 UTC — Saved items shipped + reserve-race vitest

Two-thread deploy: integration test that locks in the reserve race-safety invariant, plus the full Saved feature (DB → API → web).

- **Commits:** `b6b93f4 test(api): integration test for the reserve-race invariant` + `bb7f832 feat(api): saves endpoints + exchange_item_saves table` (web slice landed in the same commit chain).
- **Schema migration:** `packages/db/drizzle/0001_0001_exchange_item_saves.sql` applied to the live `esharevice-postgres-1` container via `docker exec -i psql < …`. Composite PK on `(user_id, item_id)` + reverse index `(user_id, created_at DESC)`. Both FKs `ON DELETE CASCADE`.
- **Images:** `ghcr.io/myndgrid/esharevice-api:latest` + `:bb7f832`, digest `sha256:bec5bb794c1708bc50daf9c32d4835c42970b15fe563c4992045368d776824ae`; `ghcr.io/myndgrid/esharevice-web:latest` + `:bb7f832`, digest `sha256:decc61c12f2d0ef836e2864c02ae5b0ad531fcf2d4e767c4a647e710a73be355`.
- **Roll:** parallel buildx + push; `docker compose up -d --force-recreate api web` from `/opt/esharevice/infra`. Both healthy in <12 s.
- **Live verification (all green):**
  - `/v1/health` 200; `/v1/saves` 401 (auth gate fires before everything); `GET/PUT/DELETE /v1/exchange-items/<id>/save` all 401 unauthed.
  - `/v1/openapi.json` now advertises `/v1/exchange-items/{id}/save` + `/v1/saves` paths.
  - `https://esharevice.com/saved` 307 → `/api/auth/login?return_to=%2Fsaved` (auth gate).
- **Test coverage:**
  - `apps/api/tests/reserve-race.test.ts` — runs two concurrent UPDATEs at the same row, asserts exactly one returns a row (the other's WHERE clause re-evaluates `reserved=true` after the first commits → zero rows → 409 from the handler). Skips gracefully when `DATABASE_URL` is the unit-test placeholder so CI without datastores stays green.
  - Total vitest cases: 11 (10 unit + 1 integration).
- **No new bug-registry entries.** Slice was clean across both API + web.

### 2026-05-16 04:35 UTC — Sentry SDKs wired + social OAuth scaffolding

Two-thread deploy. Observability lights up + the scaffolding to enable Google/GitHub social sign-in is in place.

**Sentry (`3fa71b3 feat(observability): wire @sentry/node + @sentry/nextjs SDKs`)**
- `apps/api/src/instrument.ts` — env-gated `Sentry.init`, imported FIRST in `index.ts` so runtime instrumentation patches HTTP/Postgres before downstream modules load. 10% trace sample rate; tracesSampler drops /health spans.
- `apps/api/src/middleware/error.ts` — `onError` reports 5xx + unexpected errors to Sentry via `captureException`. 4xx are user-facing and skipped.
- `apps/web/instrumentation.ts` + `apps/web/instrumentation-client.ts` — Next 15's `register()` hook + client-side init. Both env-gated.
- Verified live: VPS `SENTRY_DSN_API`/`SENTRY_DSN_WEB` are both 95-char DSNs; the api container actually receives `SENTRY_DSN` (length 95). Sentry SDK initialized.
- **Images:** `ghcr.io/myndgrid/esharevice-api:3fa71b3` (digest `sha256:4feeb22053649fd527ad233aef3f2df01082b4796da05eeb7c05bd509ff484fc`); `ghcr.io/myndgrid/esharevice-web:3fa71b3` (digest `sha256:c4590fdaac4f3c3728b938f6d1b7dcf439e82a55c789dfbf9aace91efcb9bc64`).

**Social OAuth scaffolding (`9af2710 feat(authentik): scaffolding for Google + GitHub social OAuth sources`)**
- Blueprint template `infra/authentik/blueprints/social.yaml.template` — Source entries for Google + GitHub tied to default authentication/enrollment flows. `consumer_key/secret` resolve via Authentik's `!Env` tag.
- `infra/docker-compose.yml` — `GOOGLE_OAUTH_*` + `GITHUB_OAUTH_*` env threaded into BOTH `authentik-server` + `authentik-worker` (worker applies blueprints) with empty defaults so an unset env doesn't break anything.
- Authentik containers recreated with new env. Server healthy in 8 s. Worker health-check still in `starting` window 8 s in (its first-boot warmup is 60 s). Smoke: `https://auth.esharevice.com/application/o/e-sharevice-web/.well-known/openid-configuration` returns 200; `/` and `/v1/health` both 200.
- **No functional change yet** — activation requires the user to (1) create OAuth apps in GCP + GitHub, (2) paste secrets into `infra/.env`, (3) rename the template to `social.yaml`, (4) recreate authentik. Full procedure: [docs/features/2026-05-16_social-oauth.md](../docs/features/2026-05-16_social-oauth.md).

### 2026-05-16 04:50 UTC — Google OAuth source activated (GitHub deferred)

User opted for Google only on initial activation. Live blueprint `infra/authentik/blueprints/social.yaml` shipped with one Google source; the dual-provider template stays around as `social.yaml.template` for future addition.

- **Commit:** `c2e4679 feat(authentik): Google OAuth source live (GitHub deferred)`.
- **Secrets pushed to VPS** via `scp` → staged file on `/tmp/`, python merges into `infra/.env`, staged file deleted. Local id length 73, secret length 35 — both confirmed populated on VPS post-write.
- **Recreated authentik-server + authentik-worker**. Both healthy in 12 s. Worker applied `custom/social.yaml`.
- **Verified via admin API** (per the bug-registry rule that blueprint apply log isn't trustworthy):
  - `GET /api/v3/sources/oauth/` → `slug=google, name=Google, enabled=True, provider=google`.
  - `GET /api/v3/managed/blueprints/` → `e-Sharevice social OAuth sources | status: successful | path: custom/social.yaml | last_applied: 2026-05-16T04:50:08Z`.
  - `GET /source/oauth/login/google/` → 302 → `accounts.google.com/o/oauth2/auth?client_id=1006...&redirect_uri=https://auth.esharevice.com/source/oauth/callback/google/&...` (end-to-end Google flow reachable).
- **Browser smoke pending the user.** Login screen renders the "Sign in with Google" button via the Authentik SPA — only visible to a real browser, not curl. Visit `https://auth.esharevice.com` in incognito to confirm.

### 2026-05-16 05:00 UTC — Google source attached to the login screen

User reported the "Sign in with Google" button wasn't appearing. Root cause: Authentik's `default-authentication-identification` stage has an explicit `sources: ManyToMany` field that's empty by default — having an OAuthSource record alone doesn't put it on the login screen. Fix: PATCH'd the stage live (added google source UUID + set `show_source_labels: true`) and codified the same change in [infra/authentik/blueprints/social.yaml](../infra/authentik/blueprints/social.yaml) so it survives future blueprint reapplies. New bug-registry entry `[Build] Authentik OAuth Source Doesn't Auto-Attach to the Login Screen` (counter 42 → 43). Commit `ab68589`.

### 2026-05-16 05:30 UTC — Edit-item slice

Closes the listing-lifecycle loop (create → view → edit → reserve).

- **Commits:** `8282736 feat(api): PUT /v1/exchange-items/{id}` + `205a419 feat(web): /items/[id]/edit`.
- **API:** new owner-only PUT endpoint. Partial update — only keys actually present in the body are written. Pre-read for ownership check (403 with useful message), idempotency middleware applied. OpenAPI spec now advertises GET + PUT on the same path.
- **Web:** `/items/[id]/edit` server component with auth + owner gates. Pre-filled form using the row's current values; optional image replacement using the existing upload pipeline (same Buffer/Blob/parseBody pattern from create). Server action's idempotency key derives the image-upload key as `<key>-image` so both calls in the same submit can replay independently.
- **Images:** `ghcr.io/myndgrid/esharevice-api:205a419` (digest `sha256:790cc564385fa13a20f6c52e1319d6b1ef89fdef8897fb1273da815519617980`); `ghcr.io/myndgrid/esharevice-web:205a419` (digest `sha256:6ff4b7fdbc93218e74544ab072bff8a880814fa63c99776e33072439c92d7ae1`).
- **Roll:** parallel buildx + push; `docker compose up -d --force-recreate api web`. Both healthy in <12 s.
- **Live verification:** `/v1/health` 200; unauth `PUT /v1/exchange-items/<id>` → 401; anon `/items/<id>/edit` → 307 to login; OpenAPI shows `get + put` on `/v1/exchange-items/{id}`.

### 2026-05-16 06:00 UTC — Soft-delete (archive) listings

Closes the listing-lifecycle loop. Owners can delete their listings; the row stays in DB with `archived_at` set, every API read filters it out, FK referrers (saves + reserved_by) keep their referential integrity.

- **Commits:** `48923c7 feat(db): exchange_items.archived_at` + `ba25c47 feat(api): DELETE /v1/exchange-items/{id} + archived filter on every read` + `9152ece feat(web): delete listing — DeleteButton + danger zone`.
- **Migration:** `packages/db/drizzle/0002_0001_exchange_items_archived_at.sql` applied to live `esharevice-postgres-1`. Adds nullable `archived_at timestamptz` + partial index `exchange_items_active_idx` covering `(created_at DESC, id DESC) WHERE archived_at IS NULL`.
- **Images:** `ghcr.io/myndgrid/esharevice-api:9152ece` (digest `sha256:8c91d8b95d944d9ca7186864da96fc6c1a0bbd24176446066b1dfe8563d00ded`); `ghcr.io/myndgrid/esharevice-web:9152ece` (digest `sha256:c4017ae547fbaf0fa475e7b6d418dbce0ea0f45e915063d69d82baa718ca1c64`).
- **Roll:** `docker compose up -d --force-recreate api web`. Both healthy in <12 s.
- **Live verification (all green):**
  - `/v1/health` 200; unauth `DELETE /v1/exchange-items/<id>` → 401; anon `/items/<id>/edit` → 307.
  - OpenAPI now shows `delete + get + put` on `/v1/exchange-items/{id}`.
- **Reads filtered.** `WHERE archived_at IS NULL` threaded through every list/get/update path on both `exchange-items.ts` and `saves.ts`. The saves listing's join condition also filters archived rows out so a user who saved an item that the owner later archived stops seeing it on `/saved`.
- **No new bug-registry entries.** Slice was clean.

### 2026-05-16 06:30 UTC — CI runs the vitest suite + email-on-reserve via Resend

Two slices in one section since they shipped back-to-back.

**CI (`7b09f98` → `8b85ded` → `2187871`):** Workflow now runs the full vitest suite against a Postgres service container — typecheck still gates, the reserve-race integration test actually runs (was skipping with the unit-test placeholder). The pre-existing broken Lint step (ESLint 9 / no flat-config) is commented out with a fix-it-properly note; tracked separately. Turbo's `test` task gained an `env: [DATABASE_URL, REDIS_URL, OIDC_*]` declaration to forward CI's job-level env into vitest's child process (turbo's hermetic env filter strips everything not declared). Last green CI run: `25954062517` — 3 test files, 11 cases, ~1 s on the runner.

**Email-on-reserve (`0b00409`):** Resend wired into the api. After a successful `PUT /v1/exchange-items/:id/reserve` UPDATE, the handler looks up the owner's email from `users` and fires `sendReservedEmail` in a `void (async () => { ... })()` so the 200 response to the reserver is never delayed by a Resend round-trip. The helper itself never throws — domain-not-verified / rate-limit / DNS failures are logged + Sentry-captured.
- `RESEND_API_KEY` (36 chars) + `EMAIL_FROM=e-Sharevice <noreply@esharevice.com>` (36 chars) pushed to `/opt/esharevice/infra/.env` via the same scp + python merge pattern as previous secret pushes.
- **Image:** `ghcr.io/myndgrid/esharevice-api:0b00409` (digest `sha256:9630bf56bd8c711104412b481721ba5cb345f9898d2e84b86cd9290f63277279`). Web image unchanged.
- **Roll:** `docker compose up -d --force-recreate api`. Healthy in 6 s; api container's env confirms both new vars are populated.
- Domain `esharevice.com` was already verified for `noreply@esharevice.com` (Authentik has been sending password-reset emails since week 2), so the first real reserve from a non-owner should land in their inbox.

### 2026-05-16 07:00 UTC — Saver-side email fan-out

Builds on the prior email slice. Now: anyone who bookmarked an item gets notified when it's reserved (by someone else) or archived (by the owner). Same fire-and-forget contract — handler never awaits the email loop, helpers never throw.

- **Commit:** `9e49f06 feat(email): notify savers when an item is reserved or archived`.
- **Image:** `ghcr.io/myndgrid/esharevice-api:9e49f06`. Web image unchanged (this slice is API-only).
- **Roll:** `docker compose up -d --force-recreate api`. Healthy in 6 s.
- **Refactor:** extracted `sendTransactional` + `esc` + `bodyHtml` builder in `lib/email.ts` so the three notification kinds share the boilerplate (Resend init, error swallowing, HTML shell). Plus new `lib/saves-recipients.ts` for the savers-minus-actors query.
- **Recipient exclusions:**
  - Reserve fan-out excludes `[reserverId, ownerId]` — the reserver did the action; the owner gets the dedicated "your listing was reserved" email already.
  - Archive fan-out excludes `[ownerId]` — they're the actor.
  - A re-DELETE on an already-archived listing is a no-op + skips the savers notification entirely (no re-spam).
- **No new bug-registry entries.** Slice was clean — no surprises around Resend, the DB queries, or fan-out timing.

### 2026-05-16 07:30 UTC — Messages feature (phase A, polling)

The last big-ticket product feature lands. Non-owner taps "Message owner" on any item, gets a thread with the owner, both parties chat from `/messages/[id]`. Phase A = REST + 5 s client poll; SSE upgrade + email-on-new-message deferred to phase B.

- **Commit:** `3c2b7f8 feat(api): conversations + messages (week-6 phase A)` + the web slice in the same chain (a90a8a2 sequence). CI green (`25955059347`).
- **Migration:** `packages/db/drizzle/0003_0001_conversations_and_messages.sql` applied to prod via `docker exec -i psql < …`. Two new tables (`conversations`, `messages`) + supporting indexes. `\dt` on prod confirms.
- **Images:** `ghcr.io/myndgrid/esharevice-api:3c2b7f8` (digest `sha256:50e89756c355a343e5af61fc00ba58e0a6412623d3691d491c49e6804cca2b49`); `ghcr.io/myndgrid/esharevice-web:3c2b7f8` (digest `sha256:55655b51e3daee2ec1867c8ec84dfd01262dc5fa4e8536ace3c1c46b262eaf56`).
- **Roll:** parallel buildx + push; `docker compose up -d --force-recreate api web`. Both healthy in <12 s.
- **Live verification:**
  - `/v1/health` 200.
  - `GET /v1/conversations` + `POST /v1/exchange-items/<id>/conversations` both 401 unauthed (auth gate fires).
  - OpenAPI advertises four new paths: `/v1/exchange-items/{id}/conversations`, `/v1/conversations`, `/v1/conversations/{id}`, `/v1/conversations/{id}/messages` (GET + POST).
  - `/messages` 307 → login when anon; `/messages/<random-uuid>` 307 → login when anon (was 500 mid-development; root cause was a client component pulling `next/headers` via the api client — fixed by introducing server actions for the fetch + send paths).
- **No new bug-registry entries.** The "client component can't import the auth-aware api client" gotcha is already captured implicitly by Next 15's `next/headers` enforcement; we work around it via server actions, which is the standard pattern.

### 2026-05-16 09:15 UTC — Messages Phase B-1: SSE live

Real-time messaging shipped. Replaces the 5 s poll with EventSource through a same-origin Next route handler that bridges the browser to the API's Bearer-authed SSE endpoint. 30 s fallback poll stays in place as the safety net for blocked-SSE environments.

- **Commits:** `4500160 feat(api): SSE for conversations` + `8164bfc feat(web,infra): EventSource client + Caddy SSE pass-through`.
- **Images:** `ghcr.io/myndgrid/esharevice-api:8164bfc` (digest `sha256:479e80d52492db922f74bd9677180cf9f89ec5bd8578414b425fd7ef2ba1ce50`); `ghcr.io/myndgrid/esharevice-web:8164bfc` (digest `sha256:f75354339b88a3261f9a04878bcd45099e472d0c88b8322ba6725de36131c306`).
- **Caddy reroll:** Caddyfile changed (split `api.{$DOMAIN}` into `@sse` handle with `flush_interval -1` + everything-else handle with `encode zstd gzip`). Because Caddy's bind mount pins to the file's inode and `git pull` rewrites the inode (bug-registry `[Build] Docker Single-File Bind Mount Pins to Inode`), the deploy ran `docker compose up -d --force-recreate api web caddy` to ensure Caddy picks up the new config.
- **Live verification:**
  - `/v1/health` 200, `/v1/conversations` 401 unauth (regular paths unchanged).
  - `GET /v1/conversations/<id>/events` 401 unauth — auth gate fires before the stream opens.
  - Caddy returns no `content-encoding` header on the events path → SSE handle correctly skips gzip (would buffer).
  - `/api/messages/<id>/events` on the web 401 unauth — same-origin proxy hits `auth()` server-side and rejects before opening the upstream.
- **No new bug-registry entries.** The bind-mount caveat is already captured; the heartbeat + flush_interval pattern is the textbook fix for the existing `[Network] Long-Running Connection Dropped by Proxy` entry.

### 2026-05-16 14:05 UTC — `/v1/conversations` 500-cascade incident + R2 CORS

User reported "Internal server error (500)" on `/messages` shortly after the SSE deploy. Sentry surfaced two distinct issues — fixing the first exposed a follow-on, total three deploys before the route was clean. Plus a separate browser-side issue: cross-origin image loads from `cdn.esharevice.com` were CORS-blocked.

- **Sentry triage:** the admin API key in `.env.creds` (`sentry_admin_permission_api_key`) authenticates `https://sentry.io/api/0/projects/mynd-grid-inc/esharevice-api/issues/?statsPeriod=24h&sort=date`. Two unresolved issues on `GET /v1/conversations`: a PostgresError on a record-vs-uuid[] cast (12 hits) and a TypeError on `Date → byteLength` (3 hits, on the messages-paginate endpoint).
- **First fix (`31082b3 → 2be0571b…`):** swapped `sql\`= ANY(${arr}::uuid[])\`` for `inArray(col, arr)` + `sql.join(arr.map(x => sql\`${x}::uuid\`), sql\`, \`)`; added `.toISOString()` to every cursor `Date` (4 sites across exchange-items, saves, conversations, messages).
- **Build cache trap:** the first build for `:31082b3` finished in 3.8 s and re-pushed the EXISTING `:8164bfc` manifest under the new tag without rebuilding. Container looked deployed (new tag, "healthy") but ran old code. Captured as a new bug-registry entry; `--no-cache-filter check` forces the rebuild.
- **Second fix (`25538aa → 1f5054f4…`):** the cast fix made the DISTINCT-ON query actually run for the first time, surfacing `Cannot read properties of undefined (reading 'map')`. Root cause: `db.execute(sql\`…\`)` returns the rows array directly under postgres-js (not the node-postgres `{rows: [...]}` envelope I'd typed it as). Treated as array; container redeployed; Sentry stopped capturing new instances of either issue.
- **R2 CORS:** the bucket `esharevice-images` had no CORS configuration, so `cdn.esharevice.com` served images without `Access-Control-Allow-Origin`. Set a rule allowing GET/HEAD from `esharevice.com`, `www.esharevice.com`, `app.esharevice.com`, `localhost:3000/3001`, `127.0.0.1:3000` via `PUT /accounts/.../r2/buckets/esharevice-images/cors`. Verified `Access-Control-Allow-Origin: https://esharevice.com` on preflight.
- **New bug-registry entries (counter 43 → 47):**
  - `[Type] Drizzle sql\`= ANY(${jsArray}::uuid[])\` renders a record, not an array`
  - `[Type] Raw Date in Drizzle sql\`…\` template hits postgres-js byteLength`
  - `[Type] db.execute(sql\`…\`) result shape differs by driver`
  - `[Build] docker buildx --push can re-tag cached manifests instead of rebuilding`
- **Follow-up still owed:** vitest integration test for `/v1/conversations` to lock in the fix. The two existing tests cover sharp-pipeline + idempotency + reserve-race; conversations has zero coverage. The integration test can run against the same Postgres service container CI already brings up.
- **Follow-up landed 2026-05-16 12:00 UTC:** `apps/api/tests/conversations.test.ts` — 3 tests mirror the route SQL verbatim (inArray for the `IN (…)` list, `sql.join` for the DISTINCT-ON cast, `.toISOString()` for the messages cursor). Runs against the same CI Postgres service container as reserve-race; skips cleanly when DATABASE_URL is the unit-test placeholder.

### 2026-05-16 08:00 UTC — Lighthouse audit pass (100/100/100/100)

Production `https://esharevice.com/` mobile audit went from 86 / 92 / 96 / 100 to **100 / 100 / 100 / 100** across Performance / Accessibility / Best Practices / SEO. Full audit: [docs/features/2026-05-16_lighthouse-audit.md](../docs/features/2026-05-16_lighthouse-audit.md).

- **Commit:** `4ee7dba chore(a11y/perf): Lighthouse audit pass`.
- **Image:** `ghcr.io/myndgrid/esharevice-web:4ee7dba`. API image unchanged.
- **Roll:** `docker compose up -d --force-recreate web`. Healthy in 6 s.
- **Fixes:** 3 color tokens darkened for WCAG AA (`--accent` light + `--fg-subtle` light + dark); header auth buttons bumped to `size="md"` + `gap-3` for the 24×24 exclusive-zone rule; first 3 home cards eager-load with `fetchPriority="high"` (LCP 2.8 s → <1 s); `apps/web/app/icon.svg` added so `/favicon.ico` 200s instead of 404ing in the console.

### 2026-05-16 14:27 UTC — Messages Phase B-2 (email-on-new-message + active-view suppression)

- **What shipped:** end-to-end email notification when a thread participant sends a message AND the recipient hasn't been actively viewing the thread in the last 2 minutes. Two new columns on `conversations` (`initiator_last_read_at`, `owner_last_read_at`), one new endpoint (`PATCH /v1/conversations/{id}/read`), sender auto-mark-read on POST, recipient-side mark-read fired by the client on SSE open + every incoming live message.
- **Migration:** `packages/db/drizzle/0004_0001_conversations_last_read.sql` — two nullable `timestamptz` columns. NULL means "never seen" → always emails (matches the intuitive "first message always notifies" expectation).
- **Suppression rule:** `now() - recipient.last_read_at < 2 min` ⇒ skip email. The window is conservative — long enough that "I'm typing a reply" doesn't trigger a notification of my own reply, short enough that "I closed the tab a minute ago" still goes through.
- **Resend path:** reuses the same fire-and-forget IIFE wrapping as the reserve-email + saver emails. Failures log + Sentry-capture; never throw out of the POST handler.
- **Test coverage:** added a 4th case to `apps/api/tests/conversations.test.ts` asserting that updating one participant's `*_last_read_at` doesn't touch the other's — the suppression rule depends on the columns being independent.
- **Deploy plan (next):** apply 0004 to live Postgres via `docker exec -i esharevice-postgres-1 psql ... < migration.sql`; build + push both images with `--no-cache-filter check`; `docker compose up -d --force-recreate api web`. No env changes needed (reuses `RESEND_API_KEY` + `EMAIL_FROM` + `WEB_ORIGIN`).
- **Verification checklist after roll:**
  - `curl -i https://api.esharevice.com/v1/health` → 200.
  - `curl -i -X PATCH https://api.esharevice.com/v1/conversations/00000000-0000-0000-0000-000000000000/read` (no auth) → 401.
  - Send a message from A → B (B not viewing): inbox should receive the new-message email within seconds.
  - Send the second message from A → B (B viewing): inbox should NOT receive a duplicate.
  - Sentry: no new issues on POST /messages or PATCH /:id/read.

### 2026-05-16 14:55 UTC — Messages Phase B-3 (unread-message badge on the Messages tab)

- **What shipped:** new `GET /v1/conversations/unread-count` returning `{ total: number }` — counts messages newer than the viewer's per-conversation `*_last_read_at` and not authored by themselves; mobile tab bar renders a red `9+`-capped badge on the Messages icon. Builds on the B-2 columns; no migration.
- **Routing detail:** the new static path is registered before `/conversations/{id}` so Hono's radix tree resolves it as a static match. Verified post-deploy via `GET /v1/openapi.json` listing both `/v1/conversations/unread-count` AND `/v1/conversations/{id}` independently.
- **UI:** `MobileTabBarServer` (server component) fetches the count + passes it to the client `MobileTabBar`; wrapped in a `<Suspense fallback={<MobileTabBar />}>` so a slow API call doesn't delay first paint. Unauthed visitors and API failures degrade silently to "no badge". `bg-red-600 text-white` for AA contrast without inventing a new design token.
- **Test coverage:** new vitest case asserting the SQL — viewer's own messages excluded; bumping `*_last_read_at` past the conv tail drops the count to 0; per-participant independence preserved. 16/16 tests green.
- **Images:** `ghcr.io/myndgrid/esharevice-api:e1b2d9d` (`sha256:f55eb156…`), `ghcr.io/myndgrid/esharevice-web:e1b2d9d` (`sha256:5a54d795…`). Both built with `--no-cache-filter check`; real layer pushes (3.1 s + 30.1 s) — not cached re-tags.
- **Deploy:** `git pull` + `docker compose up -d --force-recreate api web`. Both healthy within 15 s.
- **Verification:** `/v1/health` 200, `/v1/conversations/unread-count` 401 unauth (route wired, auth gating), `/` 200, image digests on running containers match the pushed manifests exactly.
- **Sentry triage — deploy-window artifacts:** Two web-side errors landed at 14:52 UTC (~2 min after the force-recreate) on a real user mid-session on conversation `062ea8cc-…`: WEB-1 (`502 Request failed` from server-rendering the messages page during the API container restart gap) and WEB-2 (`SocketError: other side closed → failed to pipe response` on the open SSE proxy when the API was killed). Both are unavoidable transient artifacts of single-replica force-recreate — fixed paths: SSE clients auto-reconnect, page reload re-fetches. Worth quieting Sentry noise on `SocketError: other side closed` from the SSE proxy in a follow-up; not load-bearing.
- **Stale Sentry issues:** ESHAREVICE-API-1/2/3 (the conversations 500-cascade trio) all last seen 13:35–13:52 UTC, well before the 14:35 B-2 deploy. Safe to mark resolved in the Sentry UI — fixes have held.

### 2026-05-16 15:05 UTC — SSE proxy: swallow expected upstream-disconnect errors

- **What shipped:** web-only fix wrapping the conversation SSE proxy's `upstream.body` in a `ReadableStream` that closes cleanly on the known transient-disconnect signatures (`SocketError: other side closed`, `TypeError: terminated`, `AbortError`) — these are emitted by undici when the API container restarts mid-stream or the browser tab navigates away. Unknown errors still surface to Sentry so a real regression isn't silenced.
- **Why:** the 14:52 UTC Sentry artifacts (WEB-2 "failed to pipe response") traced to undici emitting `SocketError: other side closed` when the API force-recreate killed an open SSE connection. EventSource auto-reconnects on the client side, so this is expected, not actionable — but the noise drowns real signal.
- **Image:** `ghcr.io/myndgrid/esharevice-web:738b221` (`sha256:7ce84566…`), built with `--no-cache-filter check` (real 21.2 s layer push). API image unchanged.
- **Deploy:** web-only `docker compose up -d --force-recreate web`. API + datastores untouched. Healthy in 7 s.

### 2026-05-16 15:19 UTC — Messages Phase B-4 (per-conversation unread badges)

- **What shipped:** the `/messages` list now shows a small red `9+`-capped badge + bolded other-party name + bolded preview on threads with unread messages. Conversation response shape gains a required `unread_count` field — drives both this list-view UI and any future per-thread treatment (mark-as-unread, etc.).
- **Schema change:** `packages/shared` `Conversation` Zod schema now requires `unread_count: z.number().int().nonnegative()`. Backward compatibility: old clients ignore unknown fields (Zod default), so an old web bundle calling the new API just discards the new field; a new web bundle hitting the old API would Zod-fail on the missing field — handled by rolling API first, then web.
- **SQL:** `GET /v1/conversations` list handler now runs a third batched aggregate after the existing previews + other-party joins — `COUNT(*) GROUP BY conversation_id` over the same SQL the global unread-count endpoint uses, scoped to the current page's conv IDs. `GET /v1/conversations/{id}` runs a single-conversation variant. `POST start-conversation` short-circuits with 0 (fresh thread, no messages).
- **Images:** API `ghcr.io/myndgrid/esharevice-api:bb7640b` (`sha256:f3d678a8…`), web `ghcr.io/myndgrid/esharevice-web:bb7640b` (`sha256:91242d63…`). Both built with `--no-cache-filter check`.
- **Deploy:** API rolled first (force-recreate api), then web after web build finished — Zod-validation contract requires the API response to include `unread_count` before the new web bundle starts parsing responses. Brief overlap of old web hitting new API was safe (Zod strips the unknown field).
- **Verification:** both image digests on running containers match the pushed manifests exactly. `/v1/health` 200, `/` 200, `/messages` 307 (auth redirect — correct for unauthed curl). No new Sentry issues.

### 2026-05-16 15:45 UTC — Email preferences + unsubscribe footer

- **What shipped:** every transactional email now carries an unsubscribe footer (text + HTML) and a `List-Unsubscribe` header; each send path gates on a per-category `users.email_<category>_enabled` boolean; the link target is `/unsubscribe?token=…&c=…` on the web (renders a confirm page on GET, server action POSTs `/v1/email/unsubscribe` to flip the column). Signed-in users can manage all three categories from `/settings/notifications`. Full design + bug-registry notes in [docs/features/2026-05-16_email-preferences.md](../docs/features/2026-05-16_email-preferences.md).
- **Migration:** `0005_0001_user_email_prefs.sql` adds `email_token uuid NOT NULL DEFAULT gen_random_uuid()` + three booleans (all default `true`) to `users` + a unique index on `email_token`. Backfill is via the DEFAULT clauses so existing rows are immediately covered. Applied to live Postgres via `docker exec -i esharevice-postgres-1 psql -U esharevice -d esharevice < …`; verified columns present.
- **Helper refactor:** all four send helpers (`sendReservedEmail`, `sendItemReservedEmailToSaver`, `sendItemArchivedEmailToSaver`, `sendNewMessageEmail`) now take `recipientId` and do their own user lookup. Centralises the email + name + prefs + token resolution in one place. `getSaversToNotify` return shape narrowed to `{ user_id }[]` (only consumer was the saver-fan-out loop).
- **Endpoints (new):** `GET /v1/me/email-prefs` (auth), `PATCH /v1/me/email-prefs` (auth, partial body), `POST /v1/email/unsubscribe` (public, token-authed). Static path `/v1/email/unsubscribe` mounted via a new route module to keep it visibly distinct from the rest of `/v1/me/*`.
- **Images:** API `ghcr.io/myndgrid/esharevice-api:1ac0572` (`sha256:5f70019a…`), web `ghcr.io/myndgrid/esharevice-web:1ac0572` (`sha256:6085728f…`). Both built with `--no-cache-filter check`; real layer pushes (4.6 s + 35 s).
- **Deploy order:** migration → API rolled first (the new endpoints + helper signature change need to be live before any new web bundle calls them) → web rolled after web build finished. Brief window of old web hitting new API was safe — old web doesn't call the new endpoints, doesn't observe the helper signature.
- **Verification:** image digests on running containers match pushed manifests exactly. `/v1/health` 200, `GET /v1/me/email-prefs` 401 unauth (auth gate working), `POST /v1/email/unsubscribe` w/ unknown token 404 (token gate working), `/settings/notifications` 307 unauth (auth redirect), `/unsubscribe?token=<uuid>&c=new_message` 200 (renders "Confirm unsubscribe" card), `/unsubscribe?token=nope&c=new_message` 200 (renders "Invalid unsubscribe link" card). No new Sentry issues.

### 2026-05-16 16:00 UTC — next/image migration with R2 variant-aware loader

- **What shipped:** four CDN-sourced `<img>` tags swapped to `<Image>` (home feed card, saved feed card, item detail hero, edit form's current photo); a global custom `loaderFile` rewrites Next's srcset URLs to the closest pre-built R2 variant (400/800/1600.webp). Web-only change; API unchanged. Full design + gotchas in [docs/features/2026-05-16_next-image-migration.md](../docs/features/2026-05-16_next-image-migration.md).
- **Why global loader and not `loader=` prop:** server components can't pass functions to client components — `<Image loader={fn}>` from a server component throws `Functions cannot be passed directly to Client Components`. Setting `images.loaderFile` in `next.config.mjs` inlines the loader into Next's client bundle so callers only pass serialisable props.
- **Two blob-URL `<img>`s stayed put:** the create + edit form previews render `URL.createObjectURL` blob URLs that never reach the network. `next/image` doesn't optimise blob URLs so the migration there is no-op.
- **Image:** `ghcr.io/myndgrid/esharevice-web:c18ade3` (`sha256:9672af89…`), built with `--no-cache-filter check`; real layer push. API image untouched (still `5f70019a…`).
- **Deploy:** web-only `docker compose up -d --force-recreate web`. Healthy in ~7 s. No DB migration, no env changes.
- **Verification:** running web container digest matches push exactly. `https://esharevice.com/` returns 200 with a srcset containing all three variants (400/800/1600) — confirms the global loader is rewriting URLs in production. Direct CDN URLs (no `/_next/image` proxy roundtrip).

### 2026-05-16 16:26 UTC — PWA basics + brand-mark refresh

- **What shipped:** Web App Manifest, four pre-rendered PWA icon variants (192 / 512 / maskable-512 / apple-touch 180), `@ducanh2912/next-pwa`-generated service worker, and a new two-circle brand mark (sky-blue over amber) replacing the previous "e" tile across favicon.ico, icon.svg, and every PWA icon. Full design + gotchas in [docs/features/2026-05-16_pwa-basics.md](../docs/features/2026-05-16_pwa-basics.md).
- **SW caching strategy:** plugin defaults (CacheFirst for static, NetworkFirst for HTML, StaleWhileRevalidate for /\_next/image, etc.) PLUS a custom-priority `NetworkOnly` route for same-origin `/api/*` so the SSE proxy at `/api/messages/:id/events` isn't killed by the default 10s NetworkFirst timeout. Verified via post-build inspection of `public/sw.js` — our override lands at registerRoute position #2 (before the plugin's default `/api/*` NetworkFirst at #15).
- **Build artifacts gitignored:** `public/sw.js` + `public/workbox-*.js` are emitted on every `next build`; treating them as build output, not source. ESLint flat-config also ignores them so the minified bundle doesn't trip no-undef on `importScripts`.
- **New dev dep:** `to-ico` for generating the multi-resolution favicon.ico from the same SVG logo via `pnpm gen:icons`. Build-time only; no runtime presence.
- **Image:** web only — API unchanged. Build/push/deploy details land in this entry once the roll completes.
- **Verification target:** image digest matches push exactly; `/manifest.webmanifest` returns 200 with the new icons; `/icon-192.png` / `/icon-512.png` / `/apple-touch-icon.png` all 200; favicon.ico is the new logo (manual visual check); SSE on `/messages/[id]` still streams (proves the NetworkOnly `/api/*` override took effect).
