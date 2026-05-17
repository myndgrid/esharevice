# Task: PR 5 — Marketplace UI Primitives

**Created:** 2026-05-17 14:30 UTC
**Last Updated:** 2026-05-17 14:30 UTC
**Status:** Complete — shipped as `feat/pr5-ui-primitives`

## Objective

Build the 20 marketplace UI primitives the master plan calls for in `packages/ui`. Frontend-only, no schema or auth touch. Unblocks PRs 6–11 (landing redesign, item detail, listing wizard, booking flow, buy flow, payout setup, profile redesign — each of which composes these primitives).

Visual reference: [docs/mockups/2026-05-16_landing-marketplace.html](../docs/mockups/2026-05-16_landing-marketplace.html). Design tokens already live in [packages/ui/src/styles.css](../packages/ui/src/styles.css) (oklch sky-500 + amber-500 brand, Airbnb-spec neutrals).

## Clarifying Questions & Answers

| Question | Answer |
|---|---|
| Date / duration pickers — library or hand-roll? | `react-day-picker` v10 for the date range (~25KB gzipped, headless + styleable). DurationPicker hand-rolled — it's just hour increments. |
| Components QA page format? | Static HTML in `docs/mockups/_components.html` — matches the existing landing mockup pattern, no build step needed. |
| Test scope? | Logic-only with vitest + @testing-library/react. Cover ActionPanel dispatch, PriceBreakdown math/formatting, StatusTimeline step calc, DurationPicker custom-input clamping. Visual regression is overkill until PR 12. |
| Branching | Single `feat/pr5-ui-primitives` PR — matches the plan's PR boundary. |

## Plan

1. Cut branch + add `react-day-picker` / `date-fns` / vitest / @testing-library deps to `packages/ui`.
2. Build 20 components, batched by complexity:
   - **Simple (5)** — Heart, RatingStar, TypeBadge, StatusPill, BecomeBand.
   - **Mid (10)** — SearchPill, MobileSearchPill, CategoryStrip, ListingTypeChips, LiveCard, HoodTile, MobileTabBar, TrustSignalsRow, TypeWizardCard, PriceBreakdown.
   - **Complex (4)** — StatusTimeline, DurationPicker, DateRangePicker, ActionPanel + 5 renderers.
3. Wire everything in `src/index.ts`.
4. Logic tests (vitest + jsdom).
5. Static QA page at `docs/mockups/_components.html`.
6. `pnpm typecheck` + `pnpm --filter @esharevice/ui test` + `pnpm --filter @esharevice/ui lint` — all green.
7. Commit + push + open PR.

## Edge Cases to Handle

- **Heart accent colour** — orange-fill saved state is intentionally the rare amber-color affordance in an otherwise blue-primary palette (per the design spec). Don't paint it blue.
- **TypeBadge selectivity** — only `gift`/`trade`/`hire` render by default; `rent`/`sell` return `null` because their price suffix is self-labelling. Caller passes `always` for status-pill-style uniform displays.
- **RatingStar empty state** — value 0 / NaN renders nothing rather than "0.00". A brand-new listing with no reviews shouldn't show a rating line at all.
- **TrustSignalsRow empty state** — when no rating, no completed transactions, no verified — return `null` entirely so the row doesn't leave an awkward gap on hero bands.
- **StatusTimeline branches** — `cancelled` and `declined` collapse to a single red-banner row instead of walking the whole 5-step path. `stepIndex()` returns `-1` for these so consumers can detect terminal-negative without conditional rendering.
- **DurationPicker clamping** — custom hour input is bounded to `[min/60, max/60]`. Default range 30 minutes → 24 hours. Out-of-range values clamp to the nearest boundary (typed "6" hours with max=300 minutes clamps to 5h).
- **PriceBreakdown math** — the component renders, it never computes. All fee math lives server-side (Stripe + platform fee + tax). Money values are minor units (cents) per the rest of the codebase; `Intl.NumberFormat` handles locale formatting.
- **DateRangePicker disabledDates** — caller computes the list from the bookings table; the picker doesn't fetch anything. Defaults to today→+365 days for `fromDate`/`toDate` when not specified.
- **ActionPanel exhaustiveness** — TS `never`-check in the dispatcher's default case catches a future `listing_type` landing without a renderer (compile-time error). Runtime fall-through renders a neutral placeholder so a stale prod image doesn't crash.

## Progress Log

### 2026-05-17 14:05 UTC — branch + deps
- Cut `feat/pr5-ui-primitives` from `main` (`9424682`).
- `pnpm --filter @esharevice/ui add react-day-picker date-fns` + `pnpm --filter @esharevice/ui add -D vitest @testing-library/react @testing-library/dom jsdom react react-dom @types/react-dom`.
- Wired `vitest.config.ts` with jsdom + globals.

### 2026-05-17 14:12 UTC — simple primitives
- Heart, RatingStar, TypeBadge, StatusPill, BecomeBand — pure-presentation pieces. forwardRef + cn pattern matching `button.tsx`/`avatar.tsx`. All accept `className`.

### 2026-05-17 14:20 UTC — mid-complexity primitives
- SearchPill, MobileSearchPill, CategoryStrip, ListingTypeChips, LiveCard, HoodTile, MobileTabBar, TrustSignalsRow, TypeWizardCard, PriceBreakdown.
- `CategoryStrip` and `ListingTypeChips` both hide their native horizontal scrollbars via `[scrollbar-width:none] [&::-webkit-scrollbar]:hidden`.
- `MobileTabBar` adds `pb-[env(safe-area-inset-bottom)]` for the iPhone home-indicator clearance.

### 2026-05-17 14:28 UTC — complex primitives
- StatusTimeline with `BOOKING_STEPS` + `stepIndex()` helpers — exported so the booking detail page can derive UI from the same canonical step order without re-deriving.
- DurationPicker with clamping logic on the custom input.
- DateRangePicker wraps `react-day-picker` v10's DayPicker; classNames map the v10 slot names (`month_caption`, `button_previous`, `weekday`, `day_button`, etc. — v10 renamed everything from v8).
- ActionPanel as a discriminated-union dispatcher, with 5 concrete renderers + dot-access shorthand (`<ActionPanel.Rent ...>`). Each renderer owns its own loading/error states per the design spec.

### 2026-05-17 14:35 UTC — typecheck fixes
- 11 errors from `exactOptionalPropertyTypes` and prop-name conflicts with `HTMLAttributes` (`onChange` on a div is `ChangeEventHandler<HTMLDivElement>` — collided with my custom-typed `onChange` on DateRangePicker + DurationPicker). Fixed via `Omit<HTMLAttributes<HTMLDivElement>, "onChange">` + explicit `| undefined` on optional prop types.
- TypeWizardCard's `type: ListingType` clashed with `ButtonHTMLAttributes<HTMLButtonElement>`'s `type?: "button" | "submit" | "reset"`. Fixed with `Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">`.
- StatusTimeline `forwardRef` was typed `HTMLDivElement` but the element was `<ol>` — switched to `HTMLOListElement`.
- DayPicker v10 needs `required={false}` explicitly to match the `PropsRange` (not `PropsRangeRequired`) variant under `exactOptionalPropertyTypes`. And `onSelect` doesn't accept `undefined`, so we pass `(() => {})` as a fallback when the consumer doesn't.

### 2026-05-17 14:42 UTC — logic tests + QA page
- 27 vitest tests across 4 files (ActionPanel · PriceBreakdown · StatusTimeline · DurationPicker). All pass.
- One regex-on-currency bug along the way — `CA?` requires a literal `C` (the `?` only applies to the trailing `A`). Fixed with `(CA)?` so the optional `CA` prefix actually optional. Also worth noting: Node's en-CA Intl renders CAD as `$25.00` not `CA$25.00` since Canada uses `$` natively — same browser may render `CA$25.00`. Tests now match either form.
- `_components.html` built as a self-contained static page with hand-rendered HTML for each component variant (matching the existing landing-mockup pattern). Open directly in a browser, no build step. Sections: each component + title + description + 1-3 visual variants. DateRangePicker is a placeholder note since the real react-day-picker calendar is too much surface to hand-render statically.

### 2026-05-17 14:50 UTC — final checks + commit
- `pnpm typecheck` clean across all 5 workspace packages.
- `pnpm --filter @esharevice/ui test` — 27/27 pass.
- `pnpm --filter @esharevice/ui lint` — clean.

## Bugs / Issues Encountered

| Bug | Category | Resolution |
|---|---|---|
| `exactOptionalPropertyTypes` rejects passing `T | undefined` to a prop typed `T?`. Hit it on Pick<Common, ...> in ActionPanel + when consuming optional props in helper subcomponents. | [Type] | Add explicit `| undefined` to the helper-component prop types so the inferred destructured types match. |
| `onChange?: (custom) => void` collides with `HTMLAttributes<HTMLDivElement>`'s `onChange?: ChangeEventHandler<HTMLDivElement>`. The intersection creates an unintersectable type. | [Type] | `Omit<HTMLAttributes<HTMLDivElement>, "onChange">` then re-declare. Same pattern for any custom prop that shares a name with an HTML attribute. |
| `type: ListingType` collides with `ButtonHTMLAttributes<HTMLButtonElement>`'s `type?: "button" | "submit" | "reset"`. | [Type] | `Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">`. |
| react-day-picker v10 renamed every `classNames` slot from v8/v9 (`caption` → `month_caption`, `nav_button` → `button_previous`/`button_next`, `head_cell` → `weekday`, `day` → `day_button` for the actual button — `day` is now the cell wrapper). | [Build] | Match v10's slot names exactly. The TS error "Object literal may only specify known properties, and 'caption' does not exist in type 'Partial<ClassNames>'" pointed straight at it. |
| DayPicker `PropsRange` under `exactOptionalPropertyTypes` needs `required={false}` explicitly + a non-undefined `onSelect` handler. Passing `onSelect={undefined}` fails type-check. | [Type] | Default the handler to a no-op when the consumer doesn't pass one: `onSelect={onChange ?? (() => {})}`. |
| Regex `CA?` requires a literal `C` (the `?` only quantifies the trailing `A`), so the test pattern didn't match `$25.00` without a "C" prefix. | [Logic] | Use `(CA)?` to make the whole `CA` prefix optional. Worth a bug-registry entry — it's an easy mistake to make when intending "optional currency prefix". |

## Files Changed

**New components (`packages/ui/src/`):**
- `heart.tsx`, `rating-star.tsx`, `type-badge.tsx`, `status-pill.tsx`, `become-band.tsx`
- `search-pill.tsx`, `mobile-search-pill.tsx`, `category-strip.tsx`, `listing-type-chips.tsx`, `live-card.tsx`, `hood-tile.tsx`, `mobile-tab-bar.tsx`, `trust-signals-row.tsx`, `type-wizard-card.tsx`, `price-breakdown.tsx`
- `status-timeline.tsx`, `duration-picker.tsx`, `date-range-picker.tsx`, `action-panel.tsx`

**Tests:**
- `action-panel.test.tsx` (9 tests)
- `price-breakdown.test.tsx` (6 tests)
- `status-timeline.test.tsx` (7 tests)
- `duration-picker.test.tsx` (5 tests)

**Wiring:**
- `packages/ui/src/index.ts` — exports for all 20 components + their prop types + helpers (`BOOKING_STEPS`, `stepIndex`, `DURATION_PRESETS`).
- `packages/ui/package.json` — `react-day-picker` + `date-fns` runtime deps; vitest + @testing-library + jsdom + react/react-dom dev deps; `test` + `test:watch` scripts.
- `packages/ui/vitest.config.ts` — jsdom environment.

**Docs:**
- `docs/mockups/_components.html` — static visual QA page for the design review.

## Outcome

`packages/ui` grew from 4 components (Avatar, Button, Card, plus `cn`) to 24. Every component is forwardRef-friendly, accepts `className`, ships with TS types, and uses the existing oklch token system via Tailwind utilities (`bg-brand`, `text-fg-muted`, `bg-[var(--accent-soft)]` etc.). 27 tests pass. Static QA page renders all 20 components without a build step.

PRs 6–11 (landing redesign, item detail, listing wizard, booking flow, buy flow, payout setup, profile redesign) can now compose these primitives instead of inventing new markup per surface.

## What's Next

PR 6 — Landing redesign. Replace `apps/web/app/page.tsx` body with the marketplace landing, wiring `SearchPill` + `CategoryStrip` + `ListingTypeChips` + `LiveCard` + `HoodTile` + `BecomeBand`. Type-filter chips wire to the existing `/v1/exchange-items?listing_type=...` query param (which PR 2 already shipped).
