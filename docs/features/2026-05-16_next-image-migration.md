# Feature: next/image migration with R2 variant-aware loader

**Created:** 2026-05-16 16:00 UTC
**Last Updated:** 2026-05-16 16:00 UTC
**Status:** Live. Four CDN-sourced `<img>` tags swapped to `<Image>`; a custom global loader rewrites the srcset URLs to the closest pre-built R2 variant (400/800/1600.webp). The browser now fetches the right-sized image for each card slot instead of always pulling the 800w default.

## Overview

The upload pipeline materialises three .webp variants per image at fixed widths (400 / 800 / 1600). Until this change the web app always asked for the 800w variant — defined as `DEFAULT_VARIANT_WIDTH` in [apps/api/src/lib/image-url.ts](../../apps/api/src/lib/image-url.ts). Card-sized slots on the home feed (≤ 33vw on desktop) were over-fetching by 4× relative to displayed pixels; the detail-page hero was usually fine but never crossed into 1600w on retina laptops.

This change swaps the four CDN-backed `<img>`s for `<Image>` and wires a custom global loader that snaps Next's requested srcset widths to the smallest pre-built variant `>= width`. Result: each card slot fetches `400.webp` on mobile / `800.webp` on tablet / `1600.webp` on desktop retina — no `/_next/image` proxy roundtrip, just direct CDN URLs.

## Modules / Classes Involved

| File | Role |
|---|---|
| [apps/web/lib/r2-image-loader.ts](../../apps/web/lib/r2-image-loader.ts) | Default-exports a `(props) => string` loader that rewrites `…/<variant>.webp` URLs based on Next's requested `width`. Pure function; no env access at call time. |
| [apps/web/next.config.mjs](../../apps/web/next.config.mjs) | `images.loader = "custom"` + `images.loaderFile = "./lib/r2-image-loader.ts"` makes every `<Image>` use the loader globally. |
| [apps/web/app/page.tsx](../../apps/web/app/page.tsx) | Home feed card. `<Image fill priority={priority} sizes="...">` inside a `relative aspect-[4/3]` wrapper. |
| [apps/web/app/saved/page.tsx](../../apps/web/app/saved/page.tsx) | Saved feed card (same shape). |
| [apps/web/app/items/[id]/page.tsx](../../apps/web/app/items/[id]/page.tsx) | Item detail hero. Explicit `width={1600} height={1200}` + `max-h-[60vh]` (lets non-4:3 sources display naturally). |
| [apps/web/app/items/[id]/edit/edit-item-form.tsx](../../apps/web/app/items/[id]/edit/edit-item-form.tsx) | Edit form's "current photo" — same explicit-dimensions shape. |

## What stayed as plain `<img>`

Two `<img>` sites kept (one in [create-item-form.tsx](../../apps/web/app/items/new/create-item-form.tsx) line 171, one in [edit-item-form.tsx](../../apps/web/app/items/[id]/edit/edit-item-form.tsx) line ~182). Both render `blob:` URLs from `URL.createObjectURL` against the freshly-selected `File`. `next/image` doesn't optimise blob URLs (they're local-only) and adding the component there would just shed the eslint comment for no rendering benefit.

## R2 loader logic

```ts
function pickVariant(width: number): 400 | 800 | 1600 {
  if (width <= 400) return 400;
  if (width <= 800) return 800;
  return 1600;
}
```

The loader matches a trailing `/(400|800|1600).webp` on the input src and swaps it for the chosen variant. Anything else passes through unmodified — defensive against future image sources that don't follow our variant scheme.

## Edge Cases & Gotchas

- **`loader` prop crosses the RSC boundary.** The first attempt passed `loader={r2ImageLoader}` directly. Server-component renders threw: *"Functions cannot be passed directly to Client Components."* `<Image>` is a client component under the hood, and functions can't serialise across the RSC bundle boundary. The fix is `images.loaderFile` in `next.config.mjs` — Next inlines the loader into the client bundle, so server components only pass the (serializable) src/width/alt/etc. Don't reintroduce `loader=` from server components.
- **`next.config.mjs` doesn't hot-reload.** Adding `loaderFile` requires a dev-server restart for the config to take effect. Symptoms before restart: `<Image>`s 404 against `/_next/image` because the default Next proxy isn't configured for our CDN. Easy to think it's a code bug; it's just a stale config.
- **`fill` requires a sized parent.** The cards use `<div className="relative aspect-[4/3] w-full">` around the `<Image fill>` so the image has somewhere to live. Drop the wrapper and the image collapses to 0×0.
- **Detail hero uses explicit dims, not `fill`.** Originally tried `fill` + `aspect-[4/3]` for the hero but that crops non-4:3 sources. Switching to `width={1600} height={1200}` + `max-h-[60vh] object-cover` lets CSS handle the resize, the props just define aspect-ratio for srcset math.
- **`/_next/image` proxy is bypassed entirely.** Once the custom loader is in place, Next emits direct `<https://cdn.esharevice.com/.../{variant}.webp>` URLs in the srcset. No proxy hop = no extra layer to debug + zero cost to our Next server CPU budget.

## Environment Variables Required

None new.

## Changelog

| Date | Change |
|---|---|
| 2026-05-16 16:00 UTC | Initial documentation; shipped as commits `0ccfe25` (loader infra) + `c18ade3` (site migrations). Web image `sha256:9672af89…`. |
