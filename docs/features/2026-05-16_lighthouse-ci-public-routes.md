# Feature: Lighthouse CI — public + auth-gated route audits

**Created:** 2026-05-16 17:10 UTC
**Last Updated:** 2026-05-16 18:18 UTC
**Status:** Live. Five URLs audited on every push to main: home (`/`), item detail (`/items/<demo>`), and three auth-gated routes (`/messages`, `/items/new`, `/settings/notifications`). Auth-gated routes use a `puppeteerScript` that drives Authentik's flow-executor JSON API to obtain an `lh-bot` session, then injects the cookies into the Lighthouse browser context.

## What's audited

| URL | Auth | Notes |
|---|---|---|
| `/` | Public | Home feed. |
| `/items/62756a14-5e08-4700-9f4f-1cf9dc14a1bf` | Public | Pinned to the **Lorem Ipsum demo listing** — kept around specifically as a stable target for this audit. Don't archive or delete it. |
| `/messages` | Auth | Empty-state conversation list. lh-bot has no seeded threads; the audit measures the page chrome, not the list content. |
| `/items/new` | Auth | Create-listing form. |
| `/settings/notifications` | Auth | Email-preference toggles. |

Shared assertions across all five: performance ≥ 0.85, a11y ≥ 0.95, best-practices ≥ 0.9, SEO ≥ 0.95. Two runs per URL (LHCI median).

## The auth script

[scripts/lighthouse-auth.cjs](../../scripts/lighthouse-auth.cjs) is the LHCI `puppeteerScript`. It runs once per audit, BEFORE Lighthouse opens the URL. The script:

1. Hits our web's `GET /api/auth/login?return_to=/` so the OIDC state cookie `esharevice_oidc_state` is seeded on `esharevice.com`.
2. Follows the redirect to Authentik's authorize endpoint, capturing `authentik_session` + `authentik_csrf` cookies on `auth.esharevice.com`.
3. Drives the `default-authentication-flow` via `POST /api/v3/flows/executor/<slug>/?query=...` for the identification + password stages.
4. Follows the post-auth redirect into the `default-provider-authorization-implicit-consent` flow.
5. Submits the consent stage with the one-time `token` field **plus the `X-Authentik-CSRF` header** (which is the un-obvious bit — see Gotchas).
6. Follows the final redirect to `/api/auth/callback?code=...&state=...` — our web's callback handler matches the state, exchanges the code for tokens, and sets `esharevice_session` + `esharevice_at` cookies.
7. Reads the `esharevice.com` cookie jar and calls `browser.setCookie(...)` so Lighthouse inherits the session.

Total wall-time: ~1.5 s per audit. The whole thing is fetch-based JSON-API calls — no DOM scraping, no shadow-DOM piercing, no form selectors.

## Env vars + secrets

Two env vars consumed by the script:

| Variable | Where it lives |
|---|---|
| `LH_USER` | GitHub Actions secret. Local copy in `.env.creds` (`lh_bot_username`). |
| `LH_PASSWORD` | GitHub Actions secret. Local copy in `.env.creds` (`lh_bot_password`). |

The script is a **no-op if either is missing** — local LHCI runs against forks (which can't read repo secrets) still produce reports for the public URLs.

`.github/workflows/ci.yml` passes both via the `env:` block on the `treosh/lighthouse-ci-action@v12` step.

## Edge Cases & Gotchas

- **Authentik uses a non-default CSRF header name.** Django settings: `CSRF_HEADER_NAME = HTTP_X_AUTHENTIK_CSRF`. That maps to the HTTP header `X-Authentik-CSRF`. Sending Django's stock `X-CSRFToken` (which is what most reference code uses) returns `ak-stage-flow-error` at consent submission with only a `request_id`. The error is server-side; the response payload is opaque. Diagnosis is `docker logs esharevice-authentik-server-1 | grep <request_id>` on the VPS. The actual exception trace shows `rest_framework.exceptions.PermissionDenied: CSRF Failed: CSRF token missing.`
- **`/api/auth/login` MUST run first.** Our web seeds `esharevice_oidc_state` containing the OIDC state + PKCE verifier. Skipping it (going straight to `/application/o/authorize/`) means the eventual callback returns `?auth=missing_state` because the state cookie isn't present to match.
- **Two per-host cookie jars.** `auth.esharevice.com` holds the Authentik session/CSRF cookies; `esharevice.com` holds the web session + state. The script keeps them separate so the right cookie set is sent on each request.
- **The pinned item-detail URL.** If the Lorem Ipsum listing is archived or deleted, `/items/<pinned-id>` 404s and LHCI fails on a broken URL. Mitigation: a `_about` comment in `lighthouserc.json` calls out the pin so the next operator knows to rotate it.
- **PR-time runs against fork branches won't have `LH_USER`/`LH_PASSWORD`.** The action's `env:` block reads from `secrets.*` which returns empty for fork PRs. The script's missing-creds early-return means LHCI still produces reports for the public URLs only.
- **Empty-state pages.** lh-bot has zero seeded data (no listing, no conversation, no saved item). The auth'd URLs render their empty states — fine for catching chrome regressions but doesn't measure list-with-content perf. If we ever care about that, seed lh-bot via the API.

## Environment Variables Required

| Var | Where | Notes |
|---|---|---|
| `LH_USER` | GitHub Actions secret + `.env.creds` | Authentik username. |
| `LH_PASSWORD` | GitHub Actions secret + `.env.creds` | Authentik password. |

## Changelog

| Date | Change |
|---|---|
| 2026-05-16 17:10 UTC | Initial documentation; `lighthouserc.json` audits `/` + `/items/<pinned>`. |
| 2026-05-16 17:45 UTC | Auth-CI follow-up updated with parked status. |
| 2026-05-16 18:18 UTC | Auth-CI unblocked. The flow-executor consent error was a missing `X-Authentik-CSRF` header. Added three auth-gated URLs + the puppeteerScript + GitHub Actions secrets. |
