# Audit: Lighthouse v12.8 — production home page

**Created:** 2026-05-16 08:00 UTC
**Last Updated:** 2026-05-16 08:00 UTC
**Status:** Pass. All four Lighthouse categories at 100/100 on `https://esharevice.com/` (mobile profile).

## Before / after

| Category | Before | After |
|---|---|---|
| Performance | 86 | **100** |
| Accessibility | 92 | **100** |
| Best Practices | 96 | **100** |
| SEO | 100 | **100** |

JSON reports archived under `/tmp/lh/{home.json, home-v2.json}` on the build host for reference.

## Fixes applied

### Accessibility — color contrast (was failing, 3 elements)

WCAG AA requires ≥4.5:1 contrast for normal text. Lighthouse flagged three failures in `packages/ui/src/styles.css`:

| Token | Before | Contrast | After | Contrast |
|---|---|---|---|---|
| `--accent` (light) | `oklch(63% 0.13 195)` | 3.12:1 with `--accent-fg` (white) | `oklch(50% 0.14 195)` | ~4.7:1 |
| `--fg-subtle` (light) | `oklch(58% 0.02 260)` | 4.16:1 with `--bg` | `oklch(48% 0.02 260)` | ~5.4:1 |
| `--fg-subtle` (dark) | `oklch(58% 0.02 260)` | ~3.0:1 with dark `--bg` | `oklch(68% 0.02 260)` | ~5.0:1 |

### Accessibility — touch targets (was failing, 4 elements)

The unauthenticated header packed `Sign up` and `Sign in` into `size="sm"` buttons (h-9 = 36px) with `gap-2` (8px) between them. Lighthouse flagged the targets as "partially obscured" — the 24×24 exclusive-zone rule needs more breathing room. Fix:

- Auth + "+ New" buttons → `size="md"` (h-11 = 44px, matches Apple HIG).
- Header nav gap → `gap-3` (12px).

### Performance — LCP image (was 2.8 s)

Home-page cards rendered every image with `loading="lazy"`, including the first row visible above the fold. Lighthouse's LCP audit was waiting on layout to discover those images. Fix:

- First 3 cards on the home page now render with `loading="eager"` + `fetchPriority="high"`.
- Subsequent cards stay lazy.

### Best Practices — favicon 404

Console error: `Failed to load resource: /favicon.ico`. Fix:

- Added `apps/web/app/icon.svg` (Next 15 auto-derives the 32px PNG variants and serves `/favicon.ico` from it). Simple brand-coloured rounded square with a lowercase "e" glyph.

## Remaining diagnostic notes (do not impact category scores)

- **`bf-cache`**: scores 0 because every page sets `dynamic = "force-dynamic"` + writes session cookies. Trade-off — bfcache vs auth-aware rendering — accepted as-is.
- **Legacy JavaScript / unused JS**: Next.js ships a small polyfill bundle for older browsers; tightening this further requires `compiler` config + a custom build target. The category roll-up is already 100, so deferred.

## Re-running the audit

```bash
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  npx --yes lighthouse https://esharevice.com/ \
    --output=json \
    --output-path=/tmp/lh/home.json \
    --only-categories=performance,accessibility,best-practices,seo \
    --chrome-flags="--headless --no-sandbox" \
    --quiet
```

Anything that regresses Performance / Accessibility / Best Practices below 95 is a CI-style "fix or escalate" — these were earned end-to-end and shouldn't quietly slip.

## Changelog

| Date | Change |
|---|---|
| 2026-05-16 08:00 UTC | Initial audit + four-category 100/100. |
