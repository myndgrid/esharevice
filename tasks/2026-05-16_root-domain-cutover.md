# Task: Move web app from `app.esharevice.com` to root `esharevice.com`

**Created:** 2026-05-16 01:52 UTC
**Last Updated:** 2026-05-16 01:52 UTC
**Status:** Complete

## Objective

Serve the Next.js web app at the root domain `https://esharevice.com` instead of the `app.` subdomain. Keep `app.esharevice.com` and `www.esharevice.com` provisioned and 301-redirecting to root so old bookmarks and any in-flight links keep working.

## Clarifying Questions & Answers

- **What happens to `app.esharevice.com`?** → Permanent 301 to root (preserves bookmarks and SEO). Caddy keeps the hostname provisioned so the cert stays valid for the redirect itself.
- **What happens to active sessions on `app.esharevice.com`?** → No mitigation. Cookies are host-scoped; users orphan-expire on the old hostname within 30 days (session) or ~15 minutes (access token). On their next visit they'll be 301'd to root and re-login. Acceptable for a pre-launch user count.
- **Order of operations to avoid OIDC redirect-uri-mismatch lockout?** → Authentik provider gets the new redirect URI ADDED (additive, keeps old) BEFORE any Caddy / env flip. Old URI removed days later once nothing reaches the old host.

## Plan

1. PATCH the live Authentik `e-sharevice-web` OAuth2 provider to ADD `https://esharevice.com/api/auth/callback`.
2. Edit repo:
   - `infra/Caddyfile` — root domain becomes the reverse_proxy; `app.*` + `www.*` redirect to root.
   - `infra/docker-compose.yml` — `OIDC_REDIRECT_URI` and `WEB_ORIGIN` → root.
   - `infra/authentik/blueprints/esharevice.yaml` — redirect_uris (root + legacy + localhost) and meta_launch_url updated to match live state.
   - `README.md`, `docs/features/2026-05-14_web-oidc-login-flow.md`, `docs/features/2026-05-13_v1-api-surface.md` — references updated.
3. Commit + push.
4. On VPS: `git pull`, validate + reload Caddy, recreate api + web with new env.
5. Verify externally (curl) and via the redirect_uri encoded into the authorize URL.

## Edge Cases to Handle

- **OIDC redirect_uri mismatch** if Caddy flips before Authentik allows the new URL — handled by sequencing step 1 first.
- **Stale Docker bind mount** after `git pull` — file gets a new inode but the container's mount still points at the old one. Symptom: validate + reload both succeed but external traffic shows old behavior. Fix: `--force-recreate` the consumer container.
- **Local VPS edit blocking `git pull`** — resolved with `git stash`, verify the stash matches HEAD, drop the stash.
- **Authentik blueprint vs live state divergence** — manual PATCH made live state correct first; pushing the matching blueprint to disk lets Authentik's blueprint watcher reconcile durably across restarts.

## Progress Log

### 2026-05-16 00:30 UTC
- Inventoried every hardcoded reference to `app.esharevice.com`: 4 in `infra/` (Caddyfile bare-domain block, Caddyfile app.* block, compose `OIDC_REDIRECT_URI`, compose `WEB_ORIGIN`) and 2 in `infra/authentik/blueprints/esharevice.yaml` (redirect_uris[0] + meta_launch_url). Plus docs in README + 2 feature docs.
- Confirmed `.env.creds` has the `authentik_token` for admin-API access. Confirmed the `cloudflare_global_api_key` is available (will be needed for R2 / `cdn.esharevice.com` work, not used here).

### 2026-05-16 00:35 UTC
- PATCHed `https://auth.esharevice.com/api/v3/providers/oauth2/17/` (the `e-sharevice-web` provider, pk=17) to ADD `https://esharevice.com/api/auth/callback` while keeping the existing app + localhost URIs. Authentik confirmed the three-URI list back in the response.

### 2026-05-16 00:45 UTC
- Edited Caddyfile, docker-compose.yml, blueprint, README, both feature docs. `pnpm typecheck` clean.
- Commit `09d19d3 feat(infra): serve app at root domain, 301 from app.* and www.*` pushed to main.

### 2026-05-16 01:05 UTC
- SSH'd to VPS, `git pull --ff-only` aborted on a local edit to `infra/authentik/blueprints/esharevice.yaml`. Investigated: the local edit added the `offline_access` scope mapping to both web and mobile providers — a manual hotfix from week 2/3 that has since landed in main (commit `b8ceccf`). Stashed, pulled cleanly, confirmed stash content was a duplicate, dropped stash.
- Validated the new Caddyfile inside the container (`caddy validate`) — green. `caddy reload` reported success.
- `docker compose up -d --force-recreate api web` — both healthy, env vars confirmed pointing at `https://esharevice.com`.

### 2026-05-16 01:15 UTC
- **Smoke tests revealed Caddy was still serving the OLD config.** External `curl https://esharevice.com/` returned `301 → https://app.esharevice.com/` (the OLD behavior).
- Root cause: `docker compose`'s single-file bind mount (`./Caddyfile:/etc/caddy/Caddyfile:ro`) pins to the file's inode at mount time. `git pull` replaced the file with a new inode; the container's mount still pointed at the orphaned old inode. `cat` on the host showed the new content, `cat` inside the container showed the OLD content — and `caddy validate` + `caddy reload` happily operated on the OLD file.
- Fix: `docker compose up -d --force-recreate caddy`. After recreation the container picked up the new file.

### 2026-05-16 01:30 UTC
- Re-ran external smoke tests:
  - `HEAD https://esharevice.com/` → `200` (Caddy proxies to web).
  - `HEAD https://app.esharevice.com/` → `301 Location: https://esharevice.com/`.
  - `HEAD https://www.esharevice.com/foo/bar` → `301 Location: https://esharevice.com/foo/bar` (path preserved through the redirect).
  - `POST /api/auth/logout` → `303 Location: https://esharevice.com/` (the prior week-5 logout hotfix is unaffected).
  - `GET /api/auth/login` → `307 → auth.esharevice.com/.../authorize/?redirect_uri=https://esharevice.com/api/auth/callback&client_id=e-sharevice-web`. Confirmed via URL parsing that the redirect_uri in the authorize call now points at the root domain.

### 2026-05-16 01:45 UTC
- Documentation updates:
  - `README.md` — live URLs table + redirect description updated.
  - `docs/features/2026-05-14_web-oidc-login-flow.md` — status line, `OIDC_REDIRECT_URI` example, redirect-URI list (now 3 URIs with rationale for keeping the legacy entry).
  - `docs/features/2026-05-13_v1-api-surface.md` — `WEB_ORIGIN` example.
  - `tasks/2026-05-12_vps-deployment-log.md` — appended new section "2026-05-16 01:52 UTC — Root-domain cutover".
  - `CLAUDE.md` — bug-registry entry `[Build] Docker Single-File Bind Mount Pins to Inode — git pull Silently Breaks It`; footer counter 39 → 40.
  - This task log.

## Bugs / Issues Encountered

| Bug | Category | Resolution |
|---|---|---|
| `git pull` blocked by stale local hotfix on VPS | [Environment] | Stashed, pulled, verified stash matched HEAD, dropped. |
| Caddy served stale config after `git pull` updated Caddyfile | [Build] | `--force-recreate` the caddy container; new bug-registry entry captures the inode-pinning gotcha. |

## Files Changed

- `infra/Caddyfile` — root reverse_proxy; www/app redirect-to-root block.
- `infra/docker-compose.yml` — `OIDC_REDIRECT_URI` + `WEB_ORIGIN` point at root.
- `infra/authentik/blueprints/esharevice.yaml` — redirect_uris list (root + legacy + localhost); meta_launch_url → root.
- `README.md` — live URLs + redirect description.
- `docs/features/2026-05-14_web-oidc-login-flow.md` — env + provider config + status.
- `docs/features/2026-05-13_v1-api-surface.md` — `WEB_ORIGIN` example.
- `CLAUDE.md` — new bug-registry entry + footer.
- `tasks/2026-05-12_vps-deployment-log.md` — appended new deploy section.
- `tasks/2026-05-16_root-domain-cutover.md` — this file.

## Outcome

The app serves at `https://esharevice.com` end-to-end: home page renders, OIDC login flow uses the root-domain redirect URI, logout uses the root-domain post_logout_redirect_uri. Legacy `app.*` and `www.*` 301 to root with path preservation. Documentation is in sync with reality. The next maintainer who runs `git pull` on the VPS will see the bind-mount gotcha captured in the bug registry; no surprise reproduction.
