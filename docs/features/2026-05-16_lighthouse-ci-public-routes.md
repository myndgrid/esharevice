# Feature: Lighthouse CI — add public item-detail route

**Created:** 2026-05-16 17:10 UTC
**Last Updated:** 2026-05-16 17:10 UTC
**Status:** Live. Lighthouse CI now audits both `/` (home feed) and `/items/<id>` (item detail / deep-link share target). Same desktop preset + same 0.85/0.95/0.9/0.95 score thresholds across both URLs. Auth-gated routes (`/items/new`, `/messages`, `/settings/*`) remain unmeasured pending a separate test-user-in-Authentik build-out.

## Why this scope

The original backlog item asked for `/items/new` and `/messages` to be gated too. Both are auth-required: hitting them anonymously yields a 307 to `/api/auth/login`, which redirects off-domain to Authentik. Headless Chrome can't pass through OIDC without a scripted login dance — Lighthouse would either time out at the IdP or measure the Authentik form, neither of which is useful signal for *our* app's perf/a11y/SEO.

`/items/<id>` is the obvious next pick: it's the **deep-link share target**. If someone tweets or texts a listing URL, that's the page that loads cold without an in-app warm cache. Measuring its performance has higher impact than measuring an interior auth'd page, and it costs zero auth infrastructure.

## What's measured

| URL | Surface | Notes |
|---|---|---|
| `https://esharevice.com/` | Home feed | Already on the audit; unchanged. |
| `https://esharevice.com/items/62756a14-5e08-4700-9f4f-1cf9dc14a1bf` | Item detail | New. Pinned to the **Lorem Ipsum demo listing** posted by `demo_user` — kept around specifically as a stable target for this audit. Don't archive or delete it. |

Both URLs share the same gate: performance ≥ 0.85, a11y ≥ 0.95, best-practices ≥ 0.9, SEO ≥ 0.95. Two runs per URL (LHCI's `numberOfRuns: 2`) — median is the assertion target.

## Edge Cases & Gotchas

- **The item-detail URL is pinned to one specific listing.** If that listing is deleted or archived, the audit hits the not-found state, which has different perf characteristics (no image to LCP, no FTS lookup) and may score worse on SEO. Mitigation: a `_about` comment in `lighthouserc.json` calls out the pin so the next operator knows to rotate it. Long-term answer is a fixture seeder that creates a known-good demo item on every deploy — out of scope here.
- **Lighthouse follows redirects.** If the pinned item ID becomes invalid AND the not-found path 404s instead of rendering a soft 404, the audit will fail with a different category of error than "score below threshold". Currently `app/items/[id]/page.tsx` calls `notFound()` which Next renders as a 404 with the global not-found UI; LHCI treats that as an audit failure (broken URL).
- **The audit only measures what the unauthenticated visitor sees.** No `<ReserveButton>`, no `<SaveButton>` (those render conditionally on session). Lighthouse's perf score is therefore optimistic relative to the signed-in experience — a logged-in user does a few extra fetches (saves-state, conversations) that the audit misses. This is the same tradeoff that's always existed for `/`.

## Deferred follow-up: auth-gated routes

**Status: started 2026-05-16 17:30 UTC, parked at consent-stage flow-error.** Two approaches attempted, both blocked.

### What's already in place

- `lh-bot` user provisioned in production Authentik (pk=8, member of `esharevice-users` group).
- Password generated + stored in `.env.creds` (gitignored) as `lh_bot_username` / `lh_bot_password`.
- The user is created but has NO seeded data (no listing, no conversation, no saved item). Seeding was blocked downstream by the auth-failure.

### Approach A — Puppeteer clicks the Authentik form (abandoned)

Authentik renders its identification + password stages with Lit web components. The form `<input>` elements that appear in the light DOM (`input[name=username]`, `input[name=password]`) are SUBMIT-TARGET DECOYS — positioned at `top: -2000` to be invisible. The actual visible inputs + submit buttons live inside web-component shadow roots. Puppeteer's selector engine doesn't pierce shadow DOM by default; chasing the visible elements required walking shadow roots recursively, and the result was brittle across stage transitions (the rendered shadow trees re-mount on each stage).

Stop signal: the brittleness warning I gave up-front about Authentik form selectors turned out to be precisely correct.

### Approach B — Direct flow-executor JSON API (abandoned at consent stage)

Authentik exposes `/api/v3/flows/executor/<flow-slug>/` for programmatic flow walking. The first two stages worked cleanly:

1. `GET /application/o/authorize/?client_id=...&...&code_challenge=...` → 302 to `/flows/-/default/authentication/?next=...` + sets `authentik_session` cookie.
2. `POST /api/v3/flows/executor/default-authentication-flow/?query=<encoded next>` with `{component: "ak-stage-identification", uid_field: "lh-bot"}` → returns `ak-stage-password`.
3. Same endpoint with `{component: "ak-stage-password", password: "..."}` → returns `xak-flow-redirect` to `/application/o/authorize/?...` (auth done).
4. Following that redirect → 302 to `/if/flow/default-provider-authorization-implicit-consent/?...` (consent flow).
5. `GET /api/v3/flows/executor/default-provider-authorization-implicit-consent/?query=...` → returns `ak-stage-consent` with a one-time `token`, scope list, and pending user info.
6. `POST` same URL with `{component: "ak-stage-consent", token: "<the token>"}` (+ `X-CSRFToken` header from the `authentik_csrf` cookie) → **`ak-stage-flow-error`** with only a `request_id`. No detail in the response payload.

To diagnose: SSH into the VPS and `docker logs esharevice-authentik-server-1 | grep <request_id>` — that should surface the actual exception. The error happens server-side and Authentik doesn't ship the message to the client.

### What's needed to finish

1. **Server-log diagnosis** of the consent-stage failure (5–15 min).
2. Likely fix: missing field in the POST body (consent may need a `selected_permissions` array, or the `token` field may need different framing) OR `X-CSRFToken` mismatch with how `authentik_csrf` is set vs what Django expects.
3. **Seed lh-bot's data** via the API: 1 listing (POST to `/v1/exchange-items`), 1 conversation (POST to `/v1/exchange-items/<some-other-item-id>/conversations` from lh-bot's perspective so /messages has content), 1 saved item.
4. **Lighthouse CI wiring** once the auth script works: add a `puppeteerScript` that does the flow-executor walk + injects the resulting `__session` cookie into the Puppeteer browser context BEFORE Lighthouse runs.
5. **GitHub secrets**: `LH_USER` + `LH_PASSWORD` via `gh secret set`.
6. **CI workflow**: confirm the `treosh/lighthouse-ci-action` resolves a puppeteerScript correctly.

Estimated remaining: 1–2 hours once the server-log diagnosis is in hand.

## Environment Variables Required

None new for the public-routes change. The auth-gated follow-up would need `LH_USER` + `LH_PASSWORD` as GitHub Actions secrets.

## Changelog

| Date | Change |
|---|---|
| 2026-05-16 17:10 UTC | Initial documentation; `lighthouserc.json` now audits `/` + `/items/<pinned>`. |
| 2026-05-16 17:45 UTC | Auth-CI follow-up updated with what was tried + parked. `lh-bot` user is live in Authentik but unseeded; consent-stage flow-error needs server-log diagnosis to unblock. |
