# Task: Production Catch-up Deploy — PR 1a/2/3/4/1b shipped to live VPS

**Created:** 2026-05-17 13:30 UTC
**Last Updated:** 2026-05-17 13:30 UTC
**Status:** Complete — `esharevice.com` is on `main` (commit `3e8dfd9`) with Auth.js, PRs 2 (taxonomy), 3 (bookings), 4 (Stripe Connect)

## Objective

After the Authentik teardown (PR #9 merged), the VPS was 9 PRs behind `main` (still on `e74eb07` from 2026-05-16). Catch the production VPS up to current `main`: drop the legacy Authentik infra, apply migrations 0006-0009, swap the env file for the Auth.js + Stripe shape, build new images, restart the stack, and verify end-to-end Google sign-in plus all the new API surface area (categories / bookings / payouts).

## Clarifying Questions & Answers

| Question | Answer |
|---|---|
| Build images on the VPS, or push from the Mac via `docker buildx --platform linux/amd64`? | VPS-side build. Avoids Apple-Silicon cross-arch headaches. Build wall-time was ~3 min per image; not worth multi-arch buildkit setup for a single-VPS deploy. |
| Should magic-link (Resend) ship now? | No — Auth.js v5 needs a DB adapter to store the verification token, and `@auth/drizzle-adapter` isn't wired yet. Gate behind `AUTH_RESEND_ENABLED` so the API can still send transactional email without breaking `/api/authjs/providers`. |
| FEATURE flags default? | Off in code (Zod default). True in prod via `infra/.env`. The `.env.example` in repo flips them on now that PRs 2–4 have shipped. |

## Plan

1. Restore SSH to the VPS (broken at session-start — see Bugs).
2. Sync `/opt/esharevice/infra/.env` to the post-Authentik shape via a local Python script (reads `.env.creds`, drops 11 stale Authentik keys, adds 8 Auth.js + Stripe keys, backs up the prior file, atomic-writes the new one).
3. `git pull` main on the VPS.
4. Discover PR #9's squash dropped 18 working-tree edits → commit the remainder as `chore: complete Phase 3 …` and push.
5. Apply migrations 0006-0009 via `docker exec esharevice-postgres-1 psql -v ON_ERROR_STOP=1 < migration.sql`.
6. Build `esharevice-api` + `esharevice-web` images locally on the VPS (no CI image pipeline yet — CI only typechecks/lints/tests).
7. `docker compose up -d --remove-orphans --force-recreate`.
8. Smoke test via the public edge.
9. Fix the regressions surfaced by the smoke test (3 follow-up commits).
10. Manual sign-in verification by the operator.
11. Capture the new bugs in the registry.

## Edge Cases to Handle

- **SSH lockout from fail2ban** — multiple failed expect-driven password attempts during sshpass install triggered a recidive jail. Plus a `90-hardening.conf` drop-in had `PermitRootLogin no` overriding the base config. Resolution: unban via console + permanent `ignoreip` whitelist + flip `PermitRootLogin prohibit-password` so key-auth works.
- **Building on a host without registry push** — VPS has the credentials to run images but not a registry write token. Solution: `docker build -t ghcr.io/<owner>/esharevice-<svc>:latest` locally, compose uses local-cached image when the tag matches.
- **`next build` failing on auth.ts module-load throw** — Auth.js's `if (!AUTH_SECRET) throw …` fires during page-data collection, kills the build with "Failed to collect page data for /_not-found". Fix: build-stage `ENV AUTH_SECRET=build-placeholder-not-used-at-runtime`. The placeholder doesn't ship to the runtime image (different `FROM` stage).
- **FEATURE flags not wired in compose** — api route handlers gate on `env.FEATURE_LISTING_TYPES` / `FEATURE_BOOKINGS` / `FEATURE_STRIPE`, but the `api:` service in `docker-compose.yml` didn't pass any of them through, so the Zod validator defaulted them all to `false`. Result: `/v1/categories`, `/v1/bookings`, `/v1/payouts` all 404'd in prod even though the routes + migrations + tables existed. The OpenAPI spec still listed the paths, which made the failure mode especially confusing.
- **Auth.js needing `AUTH_URL` even with `trustHost: true`** — without it, `signinUrl` / `callbackUrl` are built from the listening socket (`0.0.0.0:3000` inside the container) and Google's OAuth strict-check rejected the bogus URI. `trustHost` only governs the request-host side (cookies + CSRF), not link-building.

## Progress Log

### 2026-05-17 12:30 UTC — SSH lockout untangled
- VPS SSH on :22 was "connection refused" for ~30 min. Hetzner web console reachable.
- Root cause: cumulative effect of fail2ban auto-ban after sshpass attempts with the placeholder `vps_pass` (6-char value in `.env.creds` was a placeholder, not the real password), plus `/etc/ssh/sshd_config.d/90-hardening.conf` setting `PermitRootLogin no` which overrode the base config.
- Restored via: (a) `fail2ban-client` permanent `ignoreip = 127.0.0.0/8 ::1 99.251.92.74` in `/etc/fail2ban/jail.local`, (b) my Mac's `~/.ssh/id_ed25519.pub` appended to `/root/.ssh/authorized_keys` via the console, (c) `PermitRootLogin prohibit-password` in the hardening file.
- Cost about 25 min wall-time. Captured the SSH-recovery commands in this task log for next-time triage.

### 2026-05-17 12:50 UTC — env sync
- `/tmp/sync-vps-env.py`: 26 keys loaded from `.env.creds`, 29 from current VPS .env, 11 stale Authentik keys dropped, 8 new keys added (`AUTH_SECRET`, `AUTH_JWT_PRIVATE_KEY`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_RESEND_FROM`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_ACCOUNT_COUNTRY`). Backup at `/opt/esharevice/infra/.env.bak.20260517-124946`.
- Secrets never appeared on argv or stdout — script reads from `.env.creds` locally and streams the merged file body to the VPS via base64-over-ssh-stdin.

### 2026-05-17 13:05 UTC — Phase 3 cleanup remainder discovered + landed
- After `git pull origin main` on VPS, `infra/docker-compose.yml` still had Authentik. Diagnosis: PR #9's squash merge carried only the staged Phase 3 changes (`lib/oidc.ts` delete, `lib/session.ts` delete, `/api/auth/{login,callback,logout}/` route deletes, `infra/authentik/` blueprint deletes). The matching edits to `infra/docker-compose.yml`, `infra/Caddyfile`, `apps/web/middleware.ts`, env examples, lockfiles, and `scripts/lighthouse-auth.cjs` were applied to disk during the session but never staged. 18 files orphaned.
- Bug-registry entry written for "Incomplete PR squash — uncommitted working-tree edits silently dropped from merge".
- Committed as `15834da chore: complete Phase 3 — commit the Authentik teardown's infra + lockfile edits`. Also cleaned the Authentik dump out of `infra/scripts/backup.sh` so the daily cron stops needing `AUTHENTIK_POSTGRES_PASSWORD`.

### 2026-05-17 13:12 UTC — migrations
- Applied 0006-0009 via `docker exec esharevice-postgres-1 psql -v ON_ERROR_STOP=1 < migration.sql`. All four clean (`ALTER TABLE`, `INSERT 0 40` for the category seed, `CREATE EXTENSION IF NOT EXISTS btree_gist` succeeded silently — wasn't needed since the extension already exists in the dev DB image).
- Schema verified: `users.password_hash` column, `bookings_no_overlap` EXCLUDE constraint (`contype = 'x'`), 40 categories seeded, `stripe_accounts` + `stripe_events` tables present.

### 2026-05-17 13:18 UTC — image builds (round 1)
- API built cleanly in ~2 min.
- Web build failed at `next build` with `Failed to collect page data for /_not-found`. Module-load throw in `apps/web/auth.ts` (`if (!AUTH_SECRET) throw …`).
- Fix: `ENV AUTH_SECRET=build-placeholder-not-used-at-runtime` in the builder stage of `apps/web/Dockerfile`. Confined to the build stage; runtime image starts from a fresh `FROM` so the placeholder never ships. Committed as `a0c4677`.

### 2026-05-17 13:25 UTC — image builds (round 2) + compose up
- Web rebuilt cleanly with the placeholder.
- `docker compose up -d --force-recreate`: 6 containers up, all healthy.

### 2026-05-17 13:30 UTC — initial smoke test → 2 regressions
- `/v1/health` 200, `/login` 200 with "Continue with Google", legacy `/api/auth/login` 404 ✓.
- `/api/authjs/providers` returned `{message: "problem with the server configuration"}`. Web logs: `MissingAdapter: Email login requires an adapter.` Auth.js v5 needs a DB adapter for the Resend (magic-link) provider.
- `/v1/categories` 404. Same for `/v1/bookings`. OpenAPI spec listed all the paths, but the FEATURE_* flags weren't wired in compose, so the Zod env validator defaulted them to false and the route handlers 404'd.

### 2026-05-17 13:38 UTC — regression fixes (`a52eb34`)
- `apps/web/auth.ts`: gate Resend on `AUTH_RESEND_ENABLED=true`. Comment explains the adapter dependency.
- `infra/docker-compose.yml`: add `FEATURE_LISTING_TYPES` / `FEATURE_BOOKINGS` / `FEATURE_STRIPE` + Stripe secrets to the `api:` environment block.
- `infra/.env.example`: add the FEATURE flags with `=true` defaults (post-PR-4 shape).
- VPS `infra/.env` appended with the three flags (idempotent grep-then-append). Web rebuilt. Api + Web recreated.
- Smoke test: `/api/authjs/providers` now returns Google only, `/v1/categories` 200 with 40 rows, `/v1/bookings` 401 (route live, auth-gated), `/v1/exchange-items` 200.

### 2026-05-17 13:48 UTC — manual sign-in failed at `0.0.0.0:3000/login?error=Configuration`
- The Google OAuth dance ended on `https://0.0.0.0:3000/login?error=Configuration` instead of `https://esharevice.com/`. Browser caught it as `ERR_SSL_PROTOCOL_ERROR` on the literal `0.0.0.0:3000` URL.
- Root cause: Auth.js v5 builds `signinUrl` / `callbackUrl` from `AUTH_URL`. With it unset, v5 falls back to the listening socket address. `trustHost: true` only handles the request-host derivation for cookies + CSRF — link-building consults `AUTH_URL` first.
- Fix: `AUTH_URL: https://${DOMAIN}` added to the `web:` env block. Committed as `3e8dfd9`. No rebuild — env-only change, just `docker compose up -d --force-recreate web`.
- `/api/authjs/providers` now reports `signinUrl: "https://esharevice.com/api/authjs/signin/google"` ✓.

### 2026-05-17 13:55 UTC — manual sign-in verified by operator
- Google account chooser appeared, picked `myndgridinc@gmail.com`, lands authenticated at `/` with the avatar in the header. `/profile` renders. Sign-out works.
- End-to-end Auth.js path through the public edge: working.

## Bugs / Issues Encountered

| Bug | Category | Resolution |
|---|---|---|
| SSH on :22 connection-refused after sshpass attempts with placeholder password | [Environment] / [Build] | fail2ban `ignoreip` whitelist + `PermitRootLogin prohibit-password` + ed25519 pub key in authorized_keys |
| `PermitRootLogin no` in `90-hardening.conf` shadowed the base sshd_config's `yes` even with a valid SSH key | [Security] / [Build] | Set to `prohibit-password` (allows key, rejects password) |
| PR #9 squash carried staged changes only — 18 working-tree edits orphaned, leaving the VPS pulling a half-Phase-3 compose file | [Build] | Follow-up commit `15834da` ships the remainder. Bug-registry entry added so future merges flag uncommitted edits |
| `next build` fails with "Failed to collect page data for /_not-found" when `auth.ts` module-load throws on missing AUTH_SECRET | [Build] | Build-stage `ENV AUTH_SECRET=build-placeholder…` in the builder stage of `apps/web/Dockerfile` |
| Auth.js `MissingAdapter` error from registering Resend provider without a DB adapter | [Build] | Gate Resend on a second flag (`AUTH_RESEND_ENABLED=true`) so the API can still use the Resend API key for transactional sends without breaking `/api/authjs/providers` |
| `/v1/categories` / `/v1/bookings` / `/v1/payouts` all 404 in prod despite live migrations + routes | [Build] | The api service's compose `environment:` block didn't pass through the three `FEATURE_*` flags. Wired all three plus Stripe secrets through and bumped `.env.example` to `=true` |
| Google sign-in lands on `0.0.0.0:3000/login?error=Configuration` instead of the canonical origin | [Build] | `AUTH_URL: https://${DOMAIN}` in the web env block. `trustHost` alone is insufficient for link-building in Auth.js v5 |

## Files Changed

**Committed (4 follow-ups since `be1d2bd`):**
- `15834da chore: complete Phase 3 — commit the Authentik teardown's infra + lockfile edits` (19 files / +181 / -732)
- `a0c4677 fix(web): build-time AUTH_SECRET placeholder so 'next build' can import auth.ts` (`apps/web/Dockerfile`)
- `a52eb34 fix: gate Resend behind AUTH_RESEND_ENABLED + wire FEATURE_* flags in compose` (`apps/web/auth.ts`, `infra/docker-compose.yml`, `infra/.env.example`)
- `3e8dfd9 fix(web): set AUTH_URL so Auth.js derives the right public origin` (`infra/docker-compose.yml`)

**Production state (not in git):**
- `/opt/esharevice/infra/.env` rewritten — 11 Authentik keys dropped, 8 Auth.js + Stripe keys added, 3 FEATURE flags appended. Backup at `/opt/esharevice/infra/.env.bak.20260517-124946`.
- `/etc/fail2ban/jail.local` — `ignoreip` whitelist for the operator's Mac WAN.
- `/etc/ssh/sshd_config.d/90-hardening.conf` — `PermitRootLogin prohibit-password`.
- `/root/.ssh/authorized_keys` — operator's Mac ed25519 pub key.
- Locally-tagged Docker images: `ghcr.io/myndgrid/esharevice-{api,web}:latest` + `:3e8dfd9` (not pushed to GHCR — VPS-local).

**Migrations applied to prod Postgres:**
- `0006_0001_users_password_hash.sql` — `users.password_hash text` column for the credentials provider (currently unused; Auth.js v5 magic-link / Google don't touch it).
- `0007_0001_listing_taxonomy.sql` — `listing_type` enum, `categories` table + 40-row seed, listing-type / category_slug / paid_listing columns on `exchange_items`.
- `0008_0001_bookings.sql` — `bookings` table, `btree_gist` extension, `bookings_no_overlap` partial EXCLUDE constraint.
- `0009_0001_stripe_connect.sql` — `stripe_accounts` (UNIQUE user_id + account_id) + `stripe_events` (PK on event_id).

## Operator Actions Already Done

1. Cloudflare DNS record `auth.esharevice.com` deleted via API (earlier in the session).
2. VPS Authentik containers + 4 volumes torn down via `docker compose stop/rm` + `docker volume rm` (earlier in the session).
3. Console-side: fail2ban whitelist + sshd PermitRootLogin flip + authorized_keys append (this task).
4. Google Cloud Console: confirmed `https://esharevice.com/api/authjs/callback/google` is in the OAuth client's authorized redirect URIs (already was — no action needed).

## What's Next

The deploy is closed. Plan tracker bumps PRs 1a, 1b (all 3 phases), 2, 3, 4 to "shipped to prod". PR 5 (UI primitives) is the next sprint.

## Outcome

`esharevice.com` runs `main@3e8dfd9` with:
- Auth.js v5 (Google + magic-link UI, magic-link wired off pending `@auth/drizzle-adapter`)
- Postgres FTS + listing taxonomy (40 categories)
- Bookings with EXCLUDE-USING-gist no-overlap constraint
- Stripe Connect Canada (Express accounts + transfer_data destination + webhooks)
- All 6 containers healthy, 0 Authentik references remaining anywhere in the system
- 4 new bug-registry entries captured for next time
