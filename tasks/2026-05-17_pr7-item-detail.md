# Task: PR 7 — Item Detail with Polymorphic Action Panel

**Created:** 2026-05-17 16:00 UTC
**Last Updated:** 2026-05-17 16:00 UTC
**Status:** Complete — shipped as `feat/pr7-item-detail`

## Objective

Rewrite `apps/web/app/items/[id]/page.tsx` to compose the marketplace-redesign detail layout with the polymorphic `<ActionPanel>` driving the right CTA per `listing_type`. Booking + buy CTAs link to placeholder flow pages that PRs 9 + 10 will fill in.

## Clarifying Questions & Answers

| Question | Answer |
|---|---|
| Legacy reserve flow — keep or remove? | Remove. The page-co-located `reserve-button.tsx` + `reserve-action.ts` are gone. The bookings flow replaces them; PR 13 will drop the underlying DB column. |
| "How fees work" — drawer, page, or inline? | Inline `<details>` accordion under the description. Zero-JS, server-safe, accessible by default. A real Sheet primitive can land in PR 12 if the pattern grows beyond this single use. |
| Disabled dates for the rent calendar — wire now or stub? | Stub with `disabledDates={[]}`. PR 9 (booking flow) adds `/v1/items/:id/availability` and consumes it here. |

## Plan

1. Cut `feat/pr7-item-detail` from `feat/pr6-landing-redesign` (stacked PR).
2. Build `apps/web/app/items/[id]/item-action-panel.tsx` — a client wrapper that holds per-type interactive state (date range / duration / fulfilment) and converts CTAs into route navigations.
3. Rewrite `apps/web/app/items/[id]/page.tsx`:
   - Photo hero with floating Back + Save (Heart) buttons.
   - Title row + RatingStar + neighbourhood.
   - Two-column layout: description + specs + host card (left), sticky `<ItemActionPanel>` (right). Stacks on mobile with the panel inline above the description.
   - Specs grid is type-aware + sparse (only fields the listing actually has).
   - Inline `<details>` "How fees work" accordion for rent / hire.
   - Mobile sticky bottom CTA bar.
4. Add 3 placeholder pages under `apps/web/app/items/[id]/`:
   - `book/page.tsx` — rent / hire / gift requests; replaced by PR 9.
   - `buy/page.tsx` — sell checkout; replaced by PR 10.
   - `propose/page.tsx` — trade counter-offer; replaced by PR 9.
5. Remove `reserve-button.tsx` + `reserve-action.ts`.
6. `pnpm typecheck` + `pnpm lint` clean.
7. Dev-server smoke — all 4 routes (detail + 3 placeholders) return 200.
8. Commit + push + open PR with base = `feat/pr6-landing-redesign`.

## Edge Cases to Handle

- **No image** — placeholder camera glyph in the hero. Matches the landing's empty-state pattern.
- **Anonymous viewer** — Heart isn't rendered (no Save state to track); primary CTA on the mobile bottom bar routes to `/login?callbackUrl=/items/:id` instead of the booking flow.
- **Owner viewing own listing** — owner-only "Edit listing" card appears under the description; the action panel still renders but the CTAs would 404 (intentional — owners don't book their own items).
- **Reserved listing** — "Reserved" pill in the photo hero + a green StatusPill near the title. The ActionPanel still renders for now (PR 9 will gate booking attempts on the reserve state).
- **Type-specific specs** — the grid only renders rows for fields the row has data for. A brand-new listing with no condition / no neighbourhood / no availability dates renders zero spec rows, and the section header is hidden (no awkward "Details" heading above nothing).
- **Mobile sticky bottom bar** — sits above the existing `<MobileTabBar>` (which the root layout pins). Uses `bottom-[calc(3.5rem+env(safe-area-inset-bottom))]` to clear the tab bar + the iPhone home indicator.
- **`exactOptionalPropertyTypes` traps** — same kind of issues as PR 5/6: passing `range: DateRange | undefined` to a prop typed `range?: DateRange` fails. Resolved by conditional spread (`...(range ? { range } : {})`) at the call site, keeping the primitive's types strict.

## Progress Log

### 2026-05-17 15:50 UTC — branch + survey
- Cut `feat/pr7-item-detail` off `feat/pr6-landing-redesign`. Inspected the existing 146-line detail page: legacy reserve flow, single-image hero, no type awareness. The action handlers `message-owner-action.ts` (start conversation) + `save-action.ts` + `save-button.tsx` stay; the reserve pair gets deleted.

### 2026-05-17 16:00 UTC — ItemActionPanel client wrapper
- New `apps/web/app/items/[id]/item-action-panel.tsx`. `useState` for the rent date range, hire duration, sell fulfilment. `useTransition` for the route navigation so the CTA flips to "Sending…" between click and route change.
- CTA wiring per type (all unauthed clicks redirect to /login first):
  - gift → `/items/:id/book`
  - trade → `/items/:id/propose`
  - rent → `/items/:id/book?from=...&to=...`
  - hire → `/items/:id/book?duration=...`
  - sell → `/items/:id/buy?fulfillment=...` (Make-offer adds `&offer=1`)
- Live total computed inline for rent (price × nights) + hire (price/60 × minutes). Server-side math is the authoritative figure on the booking page; this is just a UI preview.

### 2026-05-17 16:08 UTC — page rewrite + placeholders
- New `apps/web/app/items/[id]/page.tsx` (~280 lines from the prior 146). Two-column desktop layout, mobile-stacked. Type-aware sparse specs grid. Inline fees-explainer accordion via `<details>`. Mobile sticky bottom CTA bar.
- Three placeholder pages: `book/page.tsx`, `buy/page.tsx`, `propose/page.tsx`. Each renders a friendly "coming soon" card with Back + Message provider buttons so the user has somewhere to go.
- `git rm` on `reserve-button.tsx` + `reserve-action.ts`.

### 2026-05-17 16:12 UTC — typecheck + lint + smoke
- `pnpm typecheck` — two `exactOptionalPropertyTypes` errors. Fixed by conditional spread for `range` on RentPanel, and by gating `<TrustSignalsRow rating={...}>` on `typeof item.rating === "number"`.
- `pnpm lint` — one warning about `priceUnit` being declared-but-unused. Renamed to `_priceUnit` in the destructured signature with a comment explaining the forward-compat reservation.
- Killed + restarted `pnpm dev`. Smoke tests against the local dev server (with the local API on :8080):
  - `GET /items/<real-id>` → 200, content includes "About this listing", "How fees work", "Request to book"
  - `GET /items/<real-id>/book` → 200, "Booking flow coming soon"
  - `GET /items/<real-id>/buy` → 200, "Buy now coming soon"
  - `GET /items/<real-id>/propose` → 200, "Propose a trade"

## Bugs / Issues Encountered

| Bug | Category | Resolution |
|---|---|---|
| `exactOptionalPropertyTypes` rejected passing `range: DateRange \| undefined` to RentPanel's `range?: DateRange`. Same shape as PR 5 errors. | [Type] | Use conditional spread at the call site: `...(range ? { range } : {})`. Keeps the primitive's prop type strict. |
| `pnpm lint` flagged `priceUnit` as defined-but-unused. The prop is on the contract for forward-compat (PR 9 will read it for multi-unit rent display) but the current code always renders "/ day". | [Build] | Rename the destructured local to `_priceUnit` with a comment explaining why the prop stays on the interface. ESLint's underscore-prefix convention skips the warning. |
| zsh interpreted the `?` in `http://localhost:8080/v1/exchange-items?limit=1` as a glob in a smoke-test script and crashed before curl ran. | [Build] | Quote the URL in the smoke script. Operator hygiene — not a code bug, but worth a note for future smoke scripts. |

## Files Changed

**New:**
- `apps/web/app/items/[id]/item-action-panel.tsx` — client wrapper around `<ActionPanel>`.
- `apps/web/app/items/[id]/book/page.tsx` — booking-flow placeholder.
- `apps/web/app/items/[id]/buy/page.tsx` — buy-flow placeholder.
- `apps/web/app/items/[id]/propose/page.tsx` — trade-propose-flow placeholder.
- `tasks/2026-05-17_pr7-item-detail.md` — this file.

**Rewritten:**
- `apps/web/app/items/[id]/page.tsx` — 146 → ~280 lines. Marketplace detail layout, polymorphic ActionPanel, type-aware specs, host card, fees accordion, mobile sticky bottom bar.

**Removed:**
- `apps/web/app/items/[id]/reserve-button.tsx`
- `apps/web/app/items/[id]/reserve-action.ts`

## Outcome

The item detail page now composes the redesign-plan primitives end-to-end. All 5 listing types render with the correct ActionPanel variant + CTA. The fees explainer is inline. The mobile sticky bottom CTA matches the desktop primary. PR 8 (the type-first listing wizard) is the next natural step — it gives providers the matching create-side surface so the entire "list it → see it → request it" loop is visible (with the actual booking flow stubbed until PR 9).

## What's Next

PR 8 — type-first listing wizard. Rewrites `apps/web/app/items/new/page.tsx` as a 2-step wizard:
- Step 1: pick a listing type via `<TypeWizardCard>` (5-up grid / horizontal scroll on mobile).
- Step 2: type-specific form (photos / title / description / category, plus per-type fields).
POSTs to the existing `/v1/exchange-items` endpoint (which PR 2 extended to accept the discriminated union).
