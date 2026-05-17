# Task: PR 1a — Marketplace Visual Foundation + Auth.js Env Scaffolding

**Created:** 2026-05-17 04:32 UTC
**Last Updated:** 2026-05-17 04:32 UTC
**Status:** Complete — shipped as [PR #1](https://github.com/myndgrid/esharevice/pull/1)

## Objective

Ship the first slice of the [2026-05-16 marketplace overhaul plan](2026-05-16_premium-marketplace-redesign-plan.md). The plan's PR 1 as written bundles visual system + Auth.js swap + Authentik teardown into a single PR; that's a multi-day unit that's hard to land safely in one session because the Auth.js wire-up touches live auth. This task carves out the **zero-risk foundation slice** that can ship today:

- Visual token system (sky-500 brand + amber-500 accent, full ramps, dark mode).
- Button taxonomy rename with sweep of every existing callsite.
- Additive migration 0006 for the future Auth.js Credentials provider.
- Auth.js env scaffolding (documented + RS256 keypair generated, no code consuming yet).

The Auth.js wire-up itself follows in PR 1b.

## Clarifying Questions & Answers

Asked + answered in-session (2026-05-17 03:30 – 04:00 UTC range):

| Question | Answer |
|---|---|
| Where to start? | PR 1a only: visual + migration 0006 + Auth.js env scaffolding. Defer Auth.js wire-up to PR 1b. |
| Branch strategy? | Feature branch per PR — `feat/pr1a-visual-foundation` cut from main. |
| External prereqs ready? | Canadian Business Number ✓, Stripe platform account (test mode) ✓, Google OAuth client credentials ✓. |
| Infra caution? | Full autonomy on infra (user override of CLAUDE.md defaults). |
| Commit plan/mockup files? | Leave untracked — user reviews + commits separately. |
| `.env` files? | User confirmed update both `.env.example` AND the runtime `apps/web/.env.local`. `apps/api/.env` unchanged (no AUTH_* consumers in API; OIDC_* values flip in PR 1b). |

## Plan

1. Cut `feat/pr1a-visual-foundation` from `main`.
2. Rewrite `packages/ui/src/styles.css` with the duo-palette token system.
3. Extend `apps/web/app/globals.css` `@theme inline` block with the new brand + accent ramps.
4. Rewrite `packages/ui/src/button.tsx` with `brand / ghost / accent / ink / danger / link` taxonomy.
5. Sweep every `variant="primary"/"secondary"` callsite + every `*-accent*` className across `apps/web` → brand-equivalent (10+ files).
6. Update viewport theme-color metadata in `apps/web/app/layout.tsx`.
7. Add migration `0006_0001_users_password_hash.sql` (nullable `password_hash` column on `users`) + Drizzle schema mirror.
8. Document `AUTH_*` env vars in `apps/web/.env.example`, `apps/api/.env.example`, and root `.env.example`.
9. Generate RS256 PKCS#8 keypair, base64-encode the private key, append to `.env.creds` (gitignored) with the public-key SHA-256 fingerprint for later verification.
10. Append the same `AUTH_*` keys to `apps/web/.env.local` so dev runs are ready when PR 1b lands.
11. Verify with `pnpm typecheck` across all 5 workspace packages.
12. Commit + push + open PR against `main`.

## Edge Cases to Handle

- **Existing teal `--accent` token is the "primary brand" in legacy code.** Renaming it to amber AND adding blue `--brand` means every existing `bg-accent` / `text-accent` callsite needs to migrate (or they'll silently shift teal → amber). Solved with a full grep sweep + 10 file edits.
- **Save button's two-state variant `saved ? "secondary" : "ghost"`.** Old `secondary` (filled-bg-subtle outlined) doesn't map cleanly to the new vocab. Resolved by collapsing to `variant="ghost"` for both states — the bookmark icon's filled prop already signals state. UX polish revisit lives in a later surface PR.
- **macOS `sed -z` doesn't exist.** First attempt to append the PEM private key to `.env.creds` produced an empty value. Replaced with a Python script that base64-encodes the PEM (single line, portable), records the public-key SHA-256 fingerprint inline, and never echoes the secret bytes to stdout.
- **Existing `apps/web/middleware.ts`** does live Authentik refresh-token rotation via `oauth4webapi`. Explicitly NOT touched in PR 1a — clobbering it before Auth.js is wired would break login site-wide. Lives in PR 1b.

## Progress Log

### 2026-05-17 03:30 UTC
- Read the master plan; identified that PR 1 as written is a multi-day unit.
- Asked the human partner about scope. Locked in PR 1a (visual + migration + env scaffolding) as the safe first slice.

### 2026-05-17 03:45 UTC
- Audited current state of `packages/ui`, `apps/web` layout/middleware, `apps/api` auth + env, `infra/docker-compose.yml`, `scripts/lighthouse-auth.cjs`.
- Confirmed Inter font + `next/font` is already wired (saves one step).
- Confirmed `apps/web/middleware.ts` is doing live Authentik refresh-token rotation — flagged for "do NOT touch in PR 1a".

### 2026-05-17 04:00 UTC
- Cut `feat/pr1a-visual-foundation` from main.
- Wrote new `packages/ui/src/styles.css` with full sky-500 + amber-500 ramp.
- Extended `apps/web/app/globals.css` `@theme inline` block.
- Rewrote `packages/ui/src/button.tsx` with new variant taxonomy.
- Swept 10 web files for `variant="primary"/"secondary"` + `*-accent*` callsites.

### 2026-05-17 04:15 UTC
- Wrote migration `0006_0001_users_password_hash.sql`. Added matching `password_hash` text column to `users` in Drizzle schema (nullable, never set on social-only path).
- Wrote `AUTH_*` documentation into `apps/web/.env.example` + root `.env.example`.
- Updated `apps/api/.env.example` with the forward-looking note about the PR 1b OIDC_* cutover.

### 2026-05-17 04:25 UTC
- Generated RS256 PKCS#8 keypair via openssl. Base64-encoded the private key, appended to `.env.creds` (gitignored, mode 0600). Recorded the public-key SHA-256 fingerprint inline for later verification: `aa4ce6baefab639755e77512500de140044689f681617cc9d77dc566a33a7129`.
- Generated `AUTH_SECRET` (32 bytes, base64). Appended.
- Sourced `AUTH_*` values from `.env.creds` into `apps/web/.env.local` via a python script that never echoes key bytes. 9 new keys added.

### 2026-05-17 04:30 UTC
- Hit one missed `variant=` callsite in `save-button.tsx` on first typecheck. Fixed.
- `pnpm typecheck` clean across all 5 workspace packages.
- Committed 22 files as `feat: marketplace visual foundation + auth.js env scaffolding (PR 1a)` on `feat/pr1a-visual-foundation`.
- Pushed + opened [PR #1](https://github.com/myndgrid/esharevice/pull/1).

## Bugs / Issues Encountered

| Bug | Category | Resolution |
|---|---|---|
| First sweep grep missed `save-button.tsx`'s ternary `saved ? "secondary" : "ghost"` — caught only on typecheck. | [Build] | Read + fixed inline. Took the safe call: both states use `ghost`; icon fill already differentiates. UX polish deferred. |
| macOS `sed -z` doesn't exist; first attempt to append a multi-line PEM to `.env.creds` produced an empty value. | [Encoding] | Switched to Python `subprocess` + `base64` and a single-line value with a documented decode convention. Cleaner long-term anyway — dotenv parsers handle single-line robustly across loaders. |

Neither bug is novel enough to merit a Living Bug Registry entry in CLAUDE.md — both have existing-pattern entries already.

## Files Changed

22 staged in the commit. The plan + mockup files were intentionally left untracked per user direction.

**Visual system:**
- `packages/ui/src/styles.css` — full token rewrite to oklch sky-500 + amber-500 with AA-checked dark mode
- `packages/ui/src/button.tsx` — new variant taxonomy
- `apps/web/app/globals.css` — `@theme inline` exposes brand + accent ramps to Tailwind
- `apps/web/app/layout.tsx` — viewport `themeColor` matches new neutral surface

**Variant + accent-token sweep (10 web files):**
- `apps/web/components/header.tsx`
- `apps/web/components/mobile-tab-bar.tsx`
- `apps/web/app/items/[id]/page.tsx`
- `apps/web/app/items/[id]/reserve-button.tsx`
- `apps/web/app/items/[id]/save-button.tsx`
- `apps/web/app/items/[id]/edit/edit-item-form.tsx`
- `apps/web/app/items/[id]/edit/delete-button.tsx`
- `apps/web/app/items/new/create-item-form.tsx`
- `apps/web/app/messages/[id]/conversation-view.tsx`
- `apps/web/app/profile/page.tsx`
- `apps/web/app/settings/notifications/page.tsx`
- `apps/web/app/unsubscribe/page.tsx`

**Schema 0006:**
- `packages/db/drizzle/0006_0001_users_password_hash.sql` (new)
- `packages/db/src/schema.ts` (added `password_hash` column)

**Env documentation:**
- `.env.example` — root, full forward-looking notes
- `apps/web/.env.example` — full Auth.js variable set documented
- `apps/api/.env.example` — note about the PR 1b OIDC_* cutover

**Repo hygiene:**
- `.gitignore` — adds `YCombinator/` so strategy + research docs stay out of the working tree

**Outside the commit** (gitignored, never committed):
- `.env.creds` — appended `AUTH_SECRET` + `AUTH_JWT_PRIVATE_KEY` (base64 PKCS#8 RS256) + public-key SHA-256 fingerprint
- `apps/web/.env.local` — sourced 9 new `AUTH_*` keys from `.env.creds` so dev runs are ready when PR 1b's code lands

## Outcome

PR #1 open against `main`. Typecheck green. Live Authentik OIDC flow unaffected (verified by inspection — `auth.ts`, `middleware.ts`, `apps/api/src/middleware/auth.ts`, and all OIDC env values left untouched).

## What's Deferred to PR 1b

The Auth.js wire-up itself. Recommended for a separate session because it bundles live-auth changes, container teardown, and the dual-issuer API verifier:

- Install `next-auth@beta` + provider deps in `apps/web`.
- `apps/web/auth.ts` — Auth.js v5 config with Google + Apple + Email magic-link + Credentials providers, RS256 JWT strategy, session callback.
- `apps/web/app/.well-known/jwks.json/route.ts` — public JWKS endpoint derived from `AUTH_JWT_PRIVATE_KEY`.
- `apps/web/app/api/auth/[...nextauth]/route.ts` — Auth.js handler (GET + POST).
- `apps/web/app/login/page.tsx` — branded login UI replacing Authentik's hosted flow.
- Replace `apps/web/middleware.ts` — Auth.js middleware for session resolution (currently does Authentik refresh-token rotation; the replacement is much simpler because Auth.js handles rotation internally).
- Extend `apps/api/src/middleware/auth.ts` with the `iss`-routed dual-JWKS verifier (accepts BOTH Authentik AND Auth.js issuers during the 7-day overlap window).
- Extend `apps/api/src/lib/users.ts::resolveUserFromSub` to handle the Auth.js sub formats (`google:1234…`, `apple:abc…`, `email:user@example.com`).
- New endpoint `apps/api/src/routes/v1/me-provision.ts` — called by Auth.js `signIn` callback to upsert the local `users` row.
- Add `STRIPE_*` envs to `apps/api/src/env.ts` (PR 4 prerequisite — landing here keeps the env schema cohesive).
- Rewrite `scripts/lighthouse-auth.cjs` for Auth.js cookie injection (current script drives Authentik's flow-executor with `X-Authentik-CSRF` header).
- After 7-day overlap window: remove Authentik containers from `infra/docker-compose.yml`, remove the `auth.esharevice.com` block from `infra/Caddyfile`, delete `infra/authentik/` directory.
- Write `docs/features/2026-05-17_authjs-migration.md` runbook capturing the flag flip + container teardown + post-migration verification.

## Next Up After PR 1b

Per the master plan's execution order: PR 2 (schema 0007 listing taxonomy + extended exchange-items API) → PR 3 (schema 0008 bookings + EXCLUDE no-overlap constraint) → PR 4 (Stripe Connect Canada). Each is a separate session.
