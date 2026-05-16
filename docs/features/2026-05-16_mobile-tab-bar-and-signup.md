# Feature: Mobile tab bar + Sign-up CTA + Saved/Messages stubs

**Created:** 2026-05-16 03:55 UTC
**Last Updated:** 2026-05-16 03:55 UTC
**Status:** Stable. Live on `https://esharevice.com` for mobile widths; desktop layout unchanged.

Closes the mobile-nav gap from the original Phase-3 design spec and gives unauthenticated visitors a visible "Sign up" path that lands them on the Authentik registration screen directly (instead of the login screen).

## Routes / API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/saved` | requireAuth | Stub page — bookmarks land in a later slice |
| GET | `/messages` | requireAuth | Stub page — DMs land in a later slice |
| GET | `/api/auth/login?signup=1` | — | Login route now honours an optional `signup=1` query param and forwards `prompt=create` to Authentik's authorize endpoint (OIDC-standard hint to render the registration screen) |

## Modules / Classes Involved

| File | Role |
|---|---|
| [apps/web/components/mobile-tab-bar.tsx](../../apps/web/components/mobile-tab-bar.tsx) | New client component. `usePathname` for active state; `fixed bottom-0` + `md:hidden` so desktop is unaffected; safe-area-inset for iOS; inline SVG icons (no new dep) |
| [apps/web/app/layout.tsx](../../apps/web/app/layout.tsx) | Mounts the tab bar; adds mobile-only bottom padding so content doesn't hide behind the bar |
| [apps/web/app/saved/page.tsx](../../apps/web/app/saved/page.tsx) | Stub page with `requireAuth` gate + "Coming soon" copy |
| [apps/web/app/messages/page.tsx](../../apps/web/app/messages/page.tsx) | Same shape as Saved |
| [apps/web/components/header.tsx](../../apps/web/components/header.tsx) | "Sign up" button appears next to "Sign in" when unauthenticated. Both `prefetch={false}` |
| [apps/web/app/api/auth/login/route.ts](../../apps/web/app/api/auth/login/route.ts) | Forwards `prompt=create` when `?signup=1` is on the query string |

## Persistence (files or tables touched)

None — no DB or storage changes.

## Edge Cases & Gotchas

- **Mobile-only.** The tab bar is `md:hidden` so desktop users continue to navigate via the top header. Verified against the existing header which only renders on screens ≥ md too (sticky top, max-w-5xl center).
- **Safe-area inset.** `paddingBottom: env(safe-area-inset-bottom)` on the nav so iPhone home-indicator devices don't clip the bar.
- **Body padding.** `<body className="... pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">` — the bar is 56 px tall, plus inset; desktop pb-0. Without this, the last bit of any page would sit underneath the bar.
- **prompt=create may not be universally honoured.** Authentik's OIDC implementation supports `prompt=create` as of recent versions, but if the deployment doesn't, the user lands on the regular login screen which still has a visible "Need an account? Sign up" link. Same end state, one extra click. Documented inline in the login route.
- **Prefetch hygiene.** Both Sign in and Sign up links carry `prefetch={false}` — matches the pattern established in the week-5 logout-prefetch fix. State-affecting auth routes should never have their GET responses speculatively fetched.

## Environment Variables Required

None new.

## Changelog

| Date | Change |
|---|---|
| 2026-05-16 03:55 UTC | Initial documentation; live on `https://esharevice.com` |
