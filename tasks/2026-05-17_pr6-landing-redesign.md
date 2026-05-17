# Task: PR 6 — Marketplace Landing Redesign

**Created:** 2026-05-17 15:30 UTC
**Last Updated:** 2026-05-17 15:30 UTC
**Status:** Complete — shipped as `feat/pr6-landing-redesign`

## Objective

Replace the placeholder `apps/web/app/page.tsx` body with the marketplace landing per the master plan's "Direct adoption of the marketplace mockup" spec. First visible product-impact PR since the Auth.js cutover.

## Clarifying Questions & Answers

| Question | Answer |
|---|---|
| Listing card — extend `<Card>` or new `<ListingCard>`? | New `<ListingCard>` (21st primitive in `packages/ui`). The generic `<Card>` is used in 3+ places; keeping it untouched. |
| Filter-chip behaviour — server-routed or client-only? | Server-routed via `?type=` query. SEO-friendly, no JS required, every filter is a real URL. The /v1/exchange-items endpoint already accepts the listing_type query (PR 2). |
| Happening-right-now rail — real data or placeholder? | Hardcoded 5-card placeholder for now. `/v1/activity/recent` is a PR-9-era follow-up once real booking + listing activity is there to surface. |

## Plan

1. Cut `feat/pr6-landing-redesign` from `feat/pr5-ui-primitives` (PR 5 isn't merged yet but PR 6 depends on it). PR base will be PR 5; rebases cleanly once PR 5 merges to main.
2. Build `<ListingCard>` in `packages/ui` — composes Heart + RatingStar + TypeBadge with type-aware meta + neighbour-favourite pill + optional Save toggle.
3. Extend `api.listExchangeItems` with `listing_type` + `category_slug` filters (pass-through to /v1/exchange-items).
4. Rewrite `apps/web/app/page.tsx`:
   - Hero with centered headline + brand-underlined accent + SearchPill
   - Sticky CategoryStrip + ListingTypeChips (server-routed Links)
   - 2/3/4/5-col responsive grid of ListingCards
   - BecomeBand → How-It-Works → Happening-Right-Now → Neighbourhood tiles → footer
5. Mark interactive primitives `"use client"` so the server-rendered page can import them via the barrel.
6. Logic test for ListingCard.
7. `pnpm typecheck` + `pnpm --filter @esharevice/ui test` + `lint`.
8. Restart dev server + curl smoke.
9. Commit + push + open PR (base = `feat/pr5-ui-primitives`).

## Edge Cases to Handle

- **Empty listings state** — when the filter has no results, show a friendly empty state with "clear filters" + "add a listing" links instead of just an empty grid.
- **API error fallback** — try/catch around `api.listExchangeItems`; on failure show an error card with a retry link. Already the pattern from the old landing.
- **invalid `?type=` value** — `isListingType()` predicate rejects anything outside the 5-listing-type enum, so `?type=foo` falls through to "all". No 500.
- **Category tabs on mobile** — horizontal scroll with `[scrollbar-width:none]` to hide the native scrollbar (mobile UX expectation). Same for the chip row.
- **Server/client boundary** — primitives that have hooks (PriceBreakdown / DurationPicker) or inline event handlers (Heart, SearchPill, MobileSearchPill, CategoryStrip, ListingTypeChips, MobileTabBar, TypeWizardCard) need `"use client"`. The page itself stays server-rendered (faster TTFB, SEO).
- **Heart inside ListingCard** — only rendered when `saved` is a boolean (allows the page to omit the heart entirely if the user isn't authed or doesn't have a Save flow wired yet).

## Progress Log

### 2026-05-17 15:05 UTC — ListingCard built
- New `packages/ui/src/listing-card.tsx`. Composes Heart + RatingStar + TypeBadge. Type-aware default meta (caller can override with the `meta` prop for live pricing). Optional "Neighbour favourite" pill. `href` slot for Next.js Link wrapping. Photo carousel dots NOT in this primitive — PR 7 introduces a full gallery for the detail page.

### 2026-05-17 15:08 UTC — API client extended
- `api.listExchangeItems` now accepts `listing_type` + `category_slug` opts. Pass-through query params to `/v1/exchange-items` (which already parses them — PR 2 shipped the server-side filter).

### 2026-05-17 15:20 UTC — landing rewrite
- New `apps/web/app/page.tsx` (470 lines from the prior 110). Reads `searchParams.type` server-side; falls back to "all" on invalid values. Filter chips are Next `<Link>`s — server-routed. Hardcoded 10-item CategoryStrip + 6-tile neighbourhood grid + 5-card live-activity rail (Toronto-shaped sample data).
- Hero headline + brand-coloured underline accent matches the master-plan spec's "two-color soft underlines".
- 3-up How-It-Works section + 3-column footer + bottom locale row complete the marketplace structure.

### 2026-05-17 15:35 UTC — `"use client"` sweep
- `next dev` flagged PriceBreakdown's `useState` import in the build graph. Since the page's barrel-import pulls every primitive, every interactive primitive needs `"use client"`. Added to: heart, search-pill, mobile-search-pill, category-strip, listing-type-chips, mobile-tab-bar, type-wizard-card, duration-picker, price-breakdown, listing-card. ActionPanel + DateRangePicker already had it. Display-only primitives (RatingStar, TypeBadge, StatusPill, BecomeBand, LiveCard, HoodTile, TrustSignalsRow, StatusTimeline) stay server-component-safe.
- Caught the lint complaint: `@next/next/no-img-element` rule isn't installed in packages/ui's ESLint config; the eslint-disable directive itself errored. Dropped the directive — plain `<img>` is fine in a UI primitive package (consumers can swap to `next/image` when they wrap it).

### 2026-05-17 15:42 UTC — dev smoke + tests + lint
- `curl http://localhost:3000/` → 200 + headline + every section + 5 chip Links + ListingCard for the seed data.
- `curl http://localhost:3000/?type=rent` → 200 + the rent chip is highlighted with the brand colours.
- `pnpm --filter @esharevice/ui test` — 35/35 (added 8 ListingCard tests on top of yesterday's 27).
- `pnpm typecheck` — clean across all 5 workspace packages.
- `pnpm lint` — clean for ui + web.

## Bugs / Issues Encountered

| Bug | Category | Resolution |
|---|---|---|
| `next dev` failed on first compile: "You're importing a component that needs `useState`. This React Hook only works in a Client Component." for PriceBreakdown. | [Build] | The page's barrel import (`@esharevice/ui`) pulls every primitive through `index.ts`, including stateful ones. Marked all primitives with hooks or inline event handlers as `"use client"`. Pure-presentation primitives stay server-component-safe. |
| `getByText("Hire")` in ListingCard test matched both the TypeBadge text AND the default meta string ("Hire" appears in both places for `type: "hire"`). | [Logic] | Switch to `getAllByText().length` for the rerender-each-type assertion. Same issue would bite `getByText("Free")` if the meta line ever read just "Free" — kept assertions on the badge-only set safely. |
| ESLint complained about `@next/next/no-img-element` rule definition not found in packages/ui's config. | [Build] | Dropped the disable directive. The rule lives in `eslint-plugin-next` which only `apps/web` has; a UI-library `<img>` is reasonable since consumers can wrap with `next/image` when they need optimization. |

## Files Changed

**New:**
- `packages/ui/src/listing-card.tsx` (153 lines)
- `packages/ui/src/listing-card.test.tsx` (60 lines, 8 tests)
- `tasks/2026-05-17_pr6-landing-redesign.md` (this file)

**Rewritten:**
- `apps/web/app/page.tsx` — 110 → 470 lines. Full marketplace landing per the redesign spec.

**Modified:**
- `apps/web/lib/api.ts` — `listExchangeItems` accepts `listing_type` + `category_slug` filter opts.
- `packages/ui/src/index.ts` — export `ListingCard` + `ListingCardProps`.
- `packages/ui/src/heart.tsx` — `"use client"`.
- `packages/ui/src/search-pill.tsx` — `"use client"`.
- `packages/ui/src/mobile-search-pill.tsx` — `"use client"`.
- `packages/ui/src/category-strip.tsx` — `"use client"`.
- `packages/ui/src/listing-type-chips.tsx` — `"use client"`.
- `packages/ui/src/mobile-tab-bar.tsx` — `"use client"`.
- `packages/ui/src/type-wizard-card.tsx` — `"use client"`.
- `packages/ui/src/duration-picker.tsx` — `"use client"`.
- `packages/ui/src/price-breakdown.tsx` — `"use client"`.
- `packages/ui/src/listing-card.tsx` — `"use client"`.

## Outcome

The home page is no longer the placeholder it was 90 days ago — it's a real marketplace landing with type filters wired to the live API, all the marketplace structure (hero / chips / grid / become-a-provider band / how-it-works / activity rail / hoods / footer), and zero new backend deps. PR 7 (item detail with polymorphic action panel) is the natural next step.

## What's Next

PR 7 — Item detail with polymorphic action panel. Rewrite `apps/web/app/items/[id]/page.tsx` to render all 5 listing types correctly, with the `<ActionPanel>` dispatcher driving the right CTA + booking entry point per type. Booking + buy CTAs link to (not-yet-built) flow pages.
