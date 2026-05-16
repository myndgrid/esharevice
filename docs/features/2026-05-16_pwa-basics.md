# Feature: PWA basics — manifest, app icons, service worker

**Created:** 2026-05-16 16:26 UTC
**Last Updated:** 2026-05-16 16:26 UTC
**Status:** Live. Web App Manifest declares e-Sharevice as `display: "standalone"`; `@ducanh2912/next-pwa` generates a Workbox-backed service worker on every `next build`; new two-circle brand mark replaces the previous "e" tile across favicon, SVG icon, PWA icons (192 / 512 / maskable-512), and Apple touch icon. Chrome/Edge will offer "Install" once a user has visited twice within 5 min; iOS users can Add to Home Screen via Share.

## Overview

Three things ship together because they're tightly coupled:

1. **The brand mark.** A new logo (two overlapping circles — `rgb(14, 165, 233)` sky-blue on top of `rgb(245, 158, 11)` amber) becomes the visual identity. It's the SVG site icon, the PWA install icon at every required Android + iOS resolution, and the legacy multi-resolution `favicon.ico`.

2. **The manifest.** [apps/web/app/manifest.ts](../../apps/web/app/manifest.ts) declares `display: "standalone"`, `start_url: "/"`, the three icon variants (192 + 512 + maskable-512), brand colors, and a few `categories` for app-store-style listings. Next 15's file-convention router serves it at `/manifest.webmanifest`.

3. **The service worker.** [apps/web/next.config.mjs](../../apps/web/next.config.mjs) wraps the Next config with `@ducanh2912/next-pwa`. On every `next build` it generates `public/sw.js` + `public/workbox-<hash>.js` (both gitignored as build artifacts). The plugin's default Workbox runtime caching is mostly used as-is; one custom override prepends a `NetworkOnly` route for same-origin `/api/*` requests so the SSE proxy at `/api/messages/:id/events` isn't killed by the default 10s NetworkFirst timeout.

## Modules / Classes Involved

| File | Role |
|---|---|
| [apps/web/app/manifest.ts](../../apps/web/app/manifest.ts) | TS manifest, served at `/manifest.webmanifest`. |
| [apps/web/app/icon.svg](../../apps/web/app/icon.svg) | New brand mark. Next auto-emits `<link rel="icon" type="image/svg+xml">`. |
| [apps/web/app/favicon.ico](../../apps/web/app/favicon.ico) | Multi-resolution ICO (16/32/48 PNGs) generated from the same logo. |
| [apps/web/app/layout.tsx](../../apps/web/app/layout.tsx) | `metadata` now declares `manifest`, `applicationName`, `appleWebApp`, `icons.apple`. |
| [apps/web/next.config.mjs](../../apps/web/next.config.mjs) | `withPWAInit` wrapper + Workbox `runtimeCaching` override for `/api/*`. |
| [apps/web/scripts/generate-pwa-icons.mjs](../../apps/web/scripts/generate-pwa-icons.mjs) | Build-time script: SVG → sharp → square white tile at multiple sizes → PNG + ICO. Run with `pnpm gen:icons`. |
| [apps/web/public/icon-192.png](../../apps/web/public/icon-192.png) | Android home-screen icon. |
| [apps/web/public/icon-512.png](../../apps/web/public/icon-512.png) | Android splash, larger contexts. |
| [apps/web/public/icon-maskable-512.png](../../apps/web/public/icon-maskable-512.png) | Android adaptive icon (logo at 70% of canvas so it stays inside the OS safe zone after masking). |
| [apps/web/public/apple-touch-icon.png](../../apps/web/public/apple-touch-icon.png) | iOS home screen, linked explicitly via `metadata.icons.apple`. |

## Service-worker caching strategy

`@ducanh2912/next-pwa` ships a sensible Workbox config out of the box. The compiled SW (see `apps/web/public/sw.js` after a build) registers ~18 routes; the relevant ones:

- **Precache:** Everything under `/_next/static/*` (immutable build output: JS chunks, CSS, fonts, the four icon PNGs). Workbox emits a hash-revisioned manifest at SW-install time and caches them all.
- **NetworkOnly for `/api/*`** *(our custom override)* — must take priority over the plugin defaults because the SSE proxy at `/api/messages/:id/events` would otherwise hang on NetworkFirst's 10s timeout. `extendDefaultRuntimeCaching: true` keeps the rest of the defaults intact.
- **CacheFirst for fonts, images, `/_next/static/*.js`** — 30-day expiration.
- **StaleWhileRevalidate** for everything else served by the same origin (RSC payloads, HTML, JSON).
- **NetworkFirst with 10s fallback** for cross-origin requests.

Net effect for the user: first visit installs the SW silently; second visit loads instantly from the precache because the immutable build assets are served from disk. Real-time SSE still goes straight to the network.

## Logo design choices

- **Wide aspect ratio (`-68.75 -43.75 137.5 87.5` viewBox)** preserves the user-supplied mark exactly. The SVG renders correctly in browser tab favicons (which letterbox-fit any SVG into a square) but needs deliberate handling for square PWA icons.
- **Square PNG tiles** centre the logo on a 100% white background. Logo occupies 80% of the canvas for standard icons (`icon-192.png`, `icon-512.png`, `apple-touch-icon.png`) and 70% for the maskable variant — the 70% number is below the 80% "safe zone" guaranteed by the [maskable.app spec](https://maskable.app/) so the logo doesn't get clipped when Android renders it inside a circle / squircle / rounded square depending on launcher.
- **`favicon.ico` is a real multi-resolution ICO** with 16 / 32 / 48 PNG entries (built via `to-ico`). Older Windows + Outlook contexts that don't honour the SVG `<link rel="icon">` get a crisp small icon instead of the previous "e" tile.

## Edge Cases & Gotchas

- **Service workers stick around.** Once the SW registers, the user keeps it forever (until the SW itself unregisters or the user clears site data). If we ever want to remove the PWA, we ship a "kill switch" SW first that calls `self.registration.unregister()` and `clients.claim()` — only after every active client has rolled to that version can we safely remove the SW from the build. Don't just delete `next-pwa` from the config.
- **`disable: process.env.NODE_ENV === "development"` for the SW.** Hot reload + an active SW = constant cache invalidation noise. Dev never generates the SW; prod always does.
- **`skipWaiting: true` + `clientsClaim`.** A deploy lands on the user's next page navigation, not the one after. Tradeoff: a tab that's open during a deploy briefly mixes old + new code (the old JS is precached; new HTML pulled from network). Acceptable for our scale; would warrant version-pinned manifest entries at higher traffic.
- **`/api/*` MUST be NetworkOnly.** Position #2 in the runtime-caching order, before the default plugin's `/api/*` NetworkFirst at position #15. Workbox dispatches to the first matching route. The defaults catch our /api/auth/callback specifically but not /api/messages/:id/events — without the override, the SW would either cache an empty SSE body or kill the connection.
- **Generated SW + workbox bundles are gitignored.** They're emitted by `next build` deterministically from the source + plugin version. Committing them would mean every commit has a no-op .next/static manifest delta.
- **ESLint flat-config ignores `public/sw.js` + `public/workbox-*.js`.** Without that, the minified Workbox bundle trips no-undef on `importScripts` and a dozen other expression-style warnings. They're not source.
- **iOS install needs explicit `apple-touch-icon` link.** The manifest's `icons` array doesn't drive iOS — `metadata.icons.apple` in [layout.tsx](../../apps/web/app/layout.tsx) emits the required `<link rel="apple-touch-icon">`. Without it, iOS uses a screenshot of the page instead of the brand mark.
- **PWA install criteria are Chromium-only.** Chrome offers "Install" once: (a) manifest valid + `display: standalone`, (b) HTTPS, (c) SW registered + responding to `fetch`, (d) user engagement (visited twice within 5 min). Firefox doesn't surface an install prompt at all. iOS Safari uses the manifest + apple-touch-icon for Add-to-Home-Screen but never prompts.

## Environment Variables Required

None new.

## Changelog

| Date | Change |
|---|---|
| 2026-05-16 16:26 UTC | Initial documentation; shipped as commit `77ad066`. New favicon.ico generated via the same script. |
