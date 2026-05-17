# Task: e-Sharevice Systems Overhaul — Multi-Type Marketplace with Payments

**Created:** 2026-05-16 22:30 UTC
**Last Updated:** 2026-05-17 06:10 UTC
**Status:** In Progress — PRs 1a + 2 + 3 + 4 shipped; PR 1b open; PRs 5–12 ahead

## Objective

One unified plan covering everything that ships in the next 90 days: the **product pivot** (from trade-only commons to a 5-listing-type consumer marketplace with payments), the **visual redesign** (Airbnb-recolored under the esharevice brand), the **backend systems work** (schema migrations, Stripe Connect, bookings, reviews, disputes), the **UI surfaces** that follow, and the **launch sequencing** that turns it into revenue.

Single source of truth. Everything else — `YCombinator/*.md` research, the existing mockups, the deep-dive memos — is reference material that informed this plan. This plan is what gets executed.

Baseline mockup (visual system reference): [docs/mockups/2026-05-16_landing-marketplace.html](docs/mockups/2026-05-16_landing-marketplace.html)

## Decision Log

- **2026-05-16 22:30 UTC** — First mockup was an "editorial press" direction (Fraunces serif, warm paper, deep moss accent, trade-pair as signature component). User feedback: *"too editorial, not enough marketplace; stick close to Airbnb structure; just change colours; background must be white."*
- **2026-05-16 23:15 UTC** — Pivoted to Airbnb-structured marketplace. First pass used orange as the primary brand colour. Editorial mockup retained as `docs/mockups/2026-05-16_landing-editorial.html` for reference but superseded.
- **2026-05-16 23:35 UTC** — Selected **blue from the logo as the primary brand colour** (`#0EA5E9`), orange demoted to secondary accent (`#F59E0B`). Mockup tokens flipped: `--brand` is blue. Two-overlap-circle mark (orange-on-blue with multiply blend) confirmed as the logo.
- **2026-05-17 00:15 UTC** — Strategic pivot lock-in (per YCombinator/ research): the product is no longer trade-only. It is a **5-listing-type local marketplace** (gift, trade, rent, hire, sell), with **Stripe Connect payments** as the monetization wedge, **e-Sharevice brand kept** (no rename), **mobile native after payments**. The "Wants in trade" panel becomes a polymorphic action panel that handles all five types. This plan supersedes the trade-only UI plan.
- **2026-05-17 01:00 UTC** — Final open items locked: (1) Exact colours pulled from the shipped `apps/web/app/icon.svg` — blue `#0EA5E9` (sky-500), orange `#F59E0B` (amber-500). (2) Logo lock-up matches the SVG: orange circle in front (left), blue circle behind (right), **flat overlap (no `mix-blend-mode`)**. (3) Take rate split: 10% rent + sell, 12% hire. (4) Deposit: optional, provider-set. (5) **First launch market: Toronto, ON — postal code M5A 4M3 (Corktown / St. Lawrence / Distillery District)**. (6) Stripe Tax + Stripe Identity enabled from day one. (7) Pro tier free for life for first 100 Pro signups. (8) Sell flow: provider chooses pickup-only or shipping. (9) Mobile native deferred until first revenue signal (day 60+). (10) **Auth: swap Authentik → Auth.js / NextAuth** (free, self-hostable, social + email/password + magic-link). Token bridge to the Hono API uses Auth.js asymmetric JWT with a JWKS endpoint published by the Next.js app — preserves the existing `jose`-based `requireAuth` verifier with a one-line `OIDC_JWKS_URL` change. Toronto-specific implications (CAD, GST/HST, urban-not-suburban supply mix, Bunz/Kijiji competitive context) threaded into the 90-day launch plan below.

## Product Model — The 5 Listing Types

Every listing is exactly one of:

| Type | What it means | Money? | UI affordance | Example |
|---|---|---|---|---|
| **gift** | "Free, come pick it up." | No | "Free" pill + "Request" button | Hand-me-down crib |
| **trade** | "I'll trade this for X." | No | "Wants: [thing]" line + "Propose a trade" button | Singer 401A for 4 hr weeding |
| **rent** | "Borrow for a fee, return after." | Yes | "$N/day" + date picker + deposit + "Request to book" | Pressure washer $40/day |
| **hire** | "I'll do this work for a fee." | Yes | "$N/hr" + duration picker + "Request to book" | Yard cleanup $25/hr |
| **sell** | "Pay, take, keep." | Yes | "$N" + condition badge + "Buy now" / "Make offer" | Used drone $200 |

**Why all five in one app, not five separate apps:** the same neighbour lists a free crib *and* rents a pressure washer *and* mows lawns on weekends. Forcing the user to context-switch between "Buy Nothing app" / "Turo for tools" / "TaskRabbit lite" is friction. One inbox, one identity, one trust score.

**Currency note:** every `$` figure in this plan is **CAD** unless otherwise stated. The Toronto launch market settles in CAD via Stripe Connect Canada. Multi-currency support (USD, GBP, etc.) is post-v1 and not in scope.

**The free path stays free.** Gift and trade listings have zero platform fees. They exist to drive retention, SEO, and trust signal. Paid types (rent, hire, sell) carry the take rate (10% for rent/sell, 12% for hire).

## Visual System — Source of Truth

| Token | Value | Used for |
|---|---|---|
| Background `--white` | `#ffffff` | Default body bg |
| Surface 2 | `#f7f7f7` | Section bands, mobile preview bg, message bubble incoming |
| Surface 3 | `#ebebeb` | Image placeholder, hover state of subtle bg |
| Text `--text` | `#222222` | Primary text |
| Text 2 / 3 / 4 | `#6a6a6a / #717171 / #b0b0b0` | Hierarchy of muted text |
| Border | `#dddddd` | Dividers, card outlines |
| **Brand blue `--brand`** | **`#0EA5E9`** | Primary CTAs, search button, saved heart, search-icon pill, live-pulse dot, mobile FAB, "Request to book" / "Buy now" |
| Brand blue-h | `#0284C7` | Hover |
| Brand blue-p | `#0369A1` | Pressed |
| Brand blue-deep | `#075985` | Text-on-soft when contrast demands it |
| Brand blue-soft | `#E0F2FE` | Hero word underline, focus-ring fill, selected radio background, "Trade" badge background |
| Brand blue-grad | `linear-gradient(135deg, #38BDF8 0%, #0EA5E9 50%, #0369A1 100%)` | Primary CTA buttons, "Become a provider" band base |
| **Accent orange `--accent`** | **`#F59E0B`** | Secondary accent — alternating live-ticker avatars, "Trade of the week" pill, the warm halo on the provider band, "Free" badge background, "Hire" badge background |
| Accent orange-h | `#D97706` | Hover on accent surfaces |
| Accent orange-soft | `#FEF3C7` | Soft accent fill (Superneighbour badge, soft-callout backgrounds, "Free" pill bg) |
| Duo expression | Provider band uses the blue gradient with a soft orange halo bottom-right — the **one** moment both colours sing together. Elsewhere, blue does primary work and orange shows up as accent (never both as equal-weight CTAs on the same screen). |
| Star | `#222222` (Airbnb-style black star, not yellow) | Rating glyph |
| Font | Inter (400–800) | All text — matches Airbnb's Cereal look-and-feel |
| Radii | `8 / 10 / 12` + pill | Same Airbnb radius scale |
| Shadow | Airbnb-spec — soft, neutral rgba | Cards, hover lift, modal |

**Critical fix from prior plan:** the CSS `Token Migration` block in the previous draft had `--brand: orange` while this table specified `--brand: blue`. The CSS block below this plan now matches the table. Blue is `--brand`. Orange is `--accent`. Implementers: this table is the source of truth.

### Listing-type badge palette

| Type | Badge bg | Badge fg | Where shown |
|---|---|---|---|
| gift | `--accent-soft` (`#FEF3C7`) | `--text` (`#222`) with "Free" label | Top-left of card photo |
| trade | `--brand-soft` (`#E0F2FE`) | `--brand-deep` (`#075985`) with "Trade" label | Top-left of card photo |
| rent | white card (`bg` + 1px border) | `--text` (`#222`) — price-led | No badge; price is the affordance |
| hire | `--accent-soft` | `--text` with "Hire" label | Top-left of card photo |
| sell | white card | `--text` — price-led | No badge; price is the affordance |

Rationale: gift, trade, hire are "different mode" types that need labeling. Rent and sell follow normal marketplace convention where price IS the affordance — no badge needed.

## What's Borrowed From Airbnb (Marketplace DNA)

- Sticky 3-column top bar (logo / centered mini-search-pill / language + avatar menu)
- Centered hero with a soft underline on a key word + the big split-pill search bar
- Sticky category strip with icon-over-word tabs + Filters + Toggle on the right
- Photo-first square 1:1 card grid (1→2→3→4→5 columns by breakpoint)
- Heart wishlist control (top-right of each photo), star rating, "Guest favourite" pill (renamed "Neighbour favourite")
- Listing detail two-column layout: photos + description on the left, action panel sticky on the right
- "Become a host" call-to-action band rendered as a colored panel before How-It-Works (renamed "Become a provider")
- 3-up How-It-Works section + horizontal-scroll Live row + Neighbourhoods tile grid
- Tabbed footer (Popular / By skill / By tool / By neighbourhood) + columns + locale row at the bottom

## What's Different (Just Enough To Be e-Sharevice)

| Airbnb | e-Sharevice |
|---|---|
| Rausch `#FF385C` everywhere | Blue `#0EA5E9` primary, orange `#F59E0B` accent — duo identity pulled from the logo |
| Bélo logo | **Two overlapping circles** — orange (amber-500) on the left, in front; blue (sky-500) on the right, behind. Flat overlap, no blend mode (matches the shipped `apps/web/app/icon.svg`). |
| Single transaction type ("stay") | **5 listing types in one app** — card meta, item detail action panel, and listing form all polymorph on `listing_type` |
| Card meta: "$N night" | Card meta: type-aware. Rent: "$40/day". Hire: "$25/hr". Sell: "$200". Gift: "Free · Pickup". Trade: "Wants: [short prose]" |
| "Stays" / "Experiences" tabs | Categories: Tools, Skills, Kitchen, Wheels, Garden, Studio time, Lessons, Edibles, Verified, New (filterable by listing type via a secondary chip row) |
| Reservation = booking + payment in one shot | **Listing-type-aware action panel** — see "Action Panel" surface spec below |
| "Become a host" red panel | "Become a provider" blue-gradient panel with an orange halo bottom-right — the duo moment |
| Live "Recently booked" row | Live "Trades happening right now in [city]" row with a **blue pulse dot**. Avatars alternate blue / orange to carry the duo into the row. Activity events include gift drops, completed trades, completed bookings, sales. |
| Reviews appear at listing level | **Bidirectional, post-transaction reviews** (Airbnb's blind-submission model — neither party sees the other's until both submit or 14d elapses) attached to bookings |

---

## Backend Systems — Schema Migrations

Six additive migrations, sequenced and shippable independently. Continue from existing numbering (`0000`–`0005` exist).

| # | Migration | What it adds | Ships in PR |
|---|---|---|---|
| **0006** | `users_password_hash.sql` | Nullable `password_hash` column on `users` for the Auth.js Credentials provider. Shipped together with the Auth.js swap so PR 1 is self-contained. | PR 1 |
| **0007** | `listing_taxonomy.sql` | `listing_type` enum + `price_cents`, `price_unit`, `deposit_cents`, `condition`, `available_from`/`to`, `location_lat`/`lng`/`precision`, `category_id` FK; new `categories` table with 40-row seed. Backfills existing rows to `listing_type='trade'`. | PR 2 |
| **0008** | `bookings.sql` | `bookings` table with `booking_status` enum (`requested → confirmed → active → returned → completed`), pricing snapshot, Stripe linkage, lifecycle timestamps. **Critical: `EXCLUDE USING gist` constraint preventing overlapping confirmed bookings on the same item.** | PR 3 |
| **0009** | `stripe_connect.sql` | `stripe_accounts` (one per provider, lazy-created on first booking), `stripe_events` (webhook idempotency store). | PR 4 |
| **0010** | `reviews.sql` | Bidirectional reviews per booking, blind-submission visible_at logic, 14-day window. | PR 9 |
| **0011** | `disputes.sql` | `disputes` + `dispute_evidence` tables, dispute_status enum, refund tracking. | PR 10 |
| **0012** | `subscriptions.sql` | `subscriptions` table for Verified ($15 CAD/mo) + Pro ($29 CAD/mo) tiers via Stripe Billing. | PR 12 |

Full SQL for each migration is in [YCombinator/2026-05-16_deep-dive-pivot-execution.md § Schema Migration](../YCombinator/2026-05-16_deep-dive-pivot-execution.md). PRs reference that file as their migration source; no duplication. **Numbering note:** the deep-dive doc uses 0006–0011 (pre-auth-swap). After adding `0006_users_password_hash.sql` for the Auth.js Credentials provider, every other migration shifts up by one — the deep-dive's `0006_listing_taxonomy` becomes `0007_listing_taxonomy` here, etc. The SQL content is unchanged; only the file names shift.

**Drizzle schema additions** live in `packages/db/src/schema.ts` alongside existing tables. New enums become `pgEnum` exports. New Zod schemas in `packages/shared/src/schemas/` for `Booking`, `BookingCreate`, `Review`, `Dispute`, plus the polymorphic `ExchangeItemCreate.superRefine()` that enforces "rent/hire requires price_cents + price_unit" etc.

**Migration sequencing rules:**

- Each migration ships behind a **feature flag** in the API. Schema lives in prod; routes 404 until the flag flips.
- Run `EXPLAIN ANALYZE` on every new index against a production-shaped dataset before merge. The `bookings_no_overlap` exclusion is the only non-obvious one.
- Integration test per migration in `apps/api/tests/`. The booking-overlap test is non-negotiable.
- Old fields stay: `reserved`, `reserved_by`, `reserved_at`, the freeform `exchange` text all remain through a 30-day overlap window. Drop in a `0012` after every client uses the bookings API.

## Backend Systems — Stripe Connect

**Account model:** Express accounts (Stripe-hosted onboarding + dashboard + tax forms). One per provider, created lazily on first booking-request to one of their listings. Never blocks signup, never blocks listing creation. Only blocks **accepting payment**.

**State machine** (booking lifecycle):

```
renter requests → payment intent authorized (manual_capture)
   ↓
provider accepts → capture → funds held by platform
   ↓
start_at reached (cron, 5min) → status = active
   ↓
provider marks returned → status = returned, 24h release timer starts
   ↓
24h passes without dispute (cron, 5min) → transfer to provider → completed
```

**Three load-bearing implementation details** (full code in YCombinator/deep-dive):

1. **`capture_method: "manual"`** — funds authorized but not captured. Decline cancels auth (no refund visible on renter's statement).
2. **`transfer_data.destination`** on the payment intent — split is implicit; Stripe handles routing. No manual transfers.
3. **Drizzle insert BEFORE the Stripe call** — the `EXCLUDE` constraint catches double-bookings before the payment intent exists.

**Webhook handler** at `POST /v1/webhooks/stripe`. Verifies signature via `stripe.webhooks.constructEvent`. Idempotency at the storage layer (`stripe_events` PK is the event ID). Events handled in v1: `account.updated`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `customer.subscription.updated`, `customer.subscription.deleted`, `identity.verification_session.verified`.

**Fee model:** 10% on rent/sell, 12% on hire. Worked example for a CAD $40/day pressure washer × 2 days + CAD $50 deposit (Toronto launch market):
- Subtotal: `$80 CAD`
- Platform fee: `$8 CAD` (10%)
- Deposit (held + refunded): `$50 CAD`
- HST collected (13% Ontario, on subtotal + platform fee): `~$11.44 CAD` — remitted via Stripe Tax
- Total renter charged: `~$149.44 CAD`
- Provider receives on completion: `~$72 CAD` (subtotal less platform fee, after Stripe processing)
- Platform retains: `~$8 CAD` gross, `~$3.50 CAD` net of Stripe processing (~2.9% + $0.30 CAD per charge)

**Compliance gates that must ship with Stripe:**

- **Stripe Tax** enabled from day one. Don't retrofit sales tax later.
- **Stripe Identity** for the Verified badge (Pro tier prerequisite).
- **Content policy** mirroring Stripe Connect's restricted businesses list, enforced at listing creation (reject, not flag-and-forget).
- **Canadian tax forms (T4A)** handled by Stripe Connect Express Canada automatically — providers receive T4A slips at year-end. Confirm in dashboard. (No 1099-K — that's US-only; Toronto launch operates under Canadian merchant rules.)
- **Currency:** CAD as default for the Toronto launch market. Stripe Connect Canada settles to CAD bank accounts; price fields stored in cents-CAD. International expansion later can add USD via Stripe's multi-currency pricing.
- **Sales tax:** Stripe Tax configured for Canadian merchant; collects GST/HST automatically (Ontario is 13% HST). Province-detected from renter's billing address.

---

## Backend Systems — Authentication (Authentik → Auth.js)

**Decision (2026-05-17 01:00 UTC):** swap Authentik for **Auth.js / NextAuth v5**. Authentik is enterprise SSO. A consumer marketplace needs Airbnb-grade "tap Google, you're in." Auth.js is open-source, self-hostable, free forever, Next.js-native, and supports Google + Apple + email/password + email magic-link out of the box.

### What this changes

| Layer | Today (Authentik) | After (Auth.js) |
|---|---|---|
| Identity provider | `goauthentik/server:2024.12` container + `authentik-worker` + dedicated Postgres on the VPS | Auth.js inside `apps/web` — no extra container |
| Login UI | Authentik's hosted flow (enterprise-looking) | Custom-styled Next.js page with our brand tokens |
| Social providers | Configured via blueprint, harder to update | Single env var per provider, drop-in |
| OIDC issuance | Authentik signs RS256 JWTs against its JWKS | Auth.js issues RS256 JWTs against `/api/auth/jwks` (Next.js route handler) |
| API verification | `apps/api/src/middleware/auth.ts` uses `jose` against `OIDC_JWKS_URL` | **Same code path, same `jose` verifier — just a different `OIDC_JWKS_URL`.** The API doesn't care who signs the JWT, only that the signature + issuer + audience check out. |
| User provisioning | Authentik webhook + lazy `resolveUserFromSub` | Auth.js `signIn` callback calls our API `/v1/me/provision` endpoint with the verified token; existing `resolveUserFromSub` logic stays |
| Sessions | Authentik manages session cookies on `auth.esharevice.com` | Auth.js manages session cookies on `esharevice.com` (no cross-subdomain dance) |
| Infra footprint | Authentik server + worker + dedicated Postgres (~600MB RAM, ~5GB disk on VPS) | Zero additional infra. Auth.js runs inside `apps/web`. |

### What's preserved

- The Hono API's `requireAuth` middleware. `apps/api/src/middleware/auth.ts` keeps its `jose`-based RS256/JWKS verifier. The only change is the `OIDC_JWKS_URL` env value (and the `OIDC_ISSUER` / `OIDC_AUDIENCE` values to match Auth.js's configured issuer + audience).
- The `users` table and `resolveUserFromSub` lazy-provisioning logic. Auth.js's `signIn` callback fires for every login (social OR email) and hands us the verified user attributes. Same upsert pattern, different trigger source.
- The `oidc_sub` column on `users` — Auth.js issues stable provider-prefixed subs (`google:1234…`, `apple:abc…`, `email:user@example.com`). Existing rows keep working since their `oidc_sub` values aren't touched. Auth.js sub format is added to the lazy-provisioning code path; new sign-ups get the new format.

### Migration sequence (ships in PR 1)

1. **Add Auth.js to `apps/web`** alongside the existing Authentik OIDC client. Both work in parallel for the migration window.
2. **Add a feature flag** `AUTH_PROVIDER` with values `authentik` (default) and `authjs`. Each user's session records which provider authenticated them.
3. **Add the Auth.js JWKS endpoint** at `apps/web/app/api/auth/jwks/route.ts` — serves the public keys the API uses to verify tokens.
4. **Cut the API verifier over** to verify against BOTH Authentik's JWKS and Auth.js's JWKS during the migration window (jose supports multi-JWKS via a custom resolver). When `iss` claim matches Auth.js issuer, use Auth.js keys; otherwise Authentik.
5. **Flip the flag to `authjs`** in prod. New sign-ups go to Auth.js. Existing Authentik sessions continue working until they expire (~7 days).
6. **After 7 days**, drop the Authentik verifier branch from the API. Remove Authentik from `infra/docker-compose.yml`, delete `infra/authentik/`, drop `authentik-server`, `authentik-worker`, `authentik-postgres` containers from the VPS. Update Caddyfile to remove the `auth.esharevice.com` subdomain block.
7. **Migration script** runs ONCE at flag-flip time: for every existing user, log them out of Authentik (revokes their session) so they're forced through the Auth.js login next visit. This avoids dual-active-session edge cases.

### Auth.js providers (v1)

- **Google** (highest conversion, near-universal coverage)
- **Apple** (required for iOS-native users later; nice to have at launch)
- **Email magic-link** (passwordless, uses existing Resend SMTP — same credentials currently feeding Authentik)
- **Email + password** (Auth.js Credentials provider; bcrypt-stored hashes in our `users` table — adds a `password_hash` column for users who choose this path)

GitHub provider stays available behind a flag for developer testers; not exposed on the consumer login UI.

### What about Apple developer account?

Apple Sign In requires a paid Apple Developer Program enrollment (CAD $129/year — Canadian pricing for the Toronto-based account) AND a Service ID + key. Ship Google + email at launch. Apple goes in as a follow-up commit on PR 1 once the Developer Program enrollment is approved (Apple's review typically takes 24–48h after payment). The login UI hides the Apple button until `APPLE_SERVICES_ID` is set in env.

### New env vars (added to `apps/web/.env.local`)

```bash
AUTH_SECRET=                # 32-byte random — used by Auth.js for JWE encryption + JWT signing
AUTH_GOOGLE_ID=             # Google OAuth client ID
AUTH_GOOGLE_SECRET=         # Google OAuth client secret
AUTH_APPLE_ID=              # Apple Services ID (e.g. com.esharevice.web.signin) — optional v1
AUTH_APPLE_TEAM_ID=         # Apple Developer Team ID — optional v1
AUTH_APPLE_KEY_ID=          # Apple Sign In Key ID — optional v1
AUTH_APPLE_PRIVATE_KEY=     # Apple .p8 file contents — optional v1
RESEND_API_KEY=             # already present; reused for magic-link email
AUTH_RESEND_FROM=auth@esharevice.com   # already present; from-address for magic-link
```

`apps/api/.env` keeps `OIDC_JWKS_URL`, `OIDC_ISSUER`, `OIDC_AUDIENCE` — just gets new values pointing at Auth.js. The API never sees the Auth.js secret or any provider secrets.

### Risks specific to this swap

- **JWT issuer mismatch during migration window** — the dual-JWKS verifier must correctly route by `iss` claim. Integration test covers both branches.
- **Apple Sign In delay** — Apple's review of Sign-In configurations sometimes takes 24–48h. Don't gate launch on Apple; ship Google + email, add Apple within a week.
- **Email magic-link via Resend** — Resend domain verification already done for Authentik's transactional email; same DNS records work. No new domain work.
- **Auth.js session cookie** — uses `__Secure-authjs.session-token` on the `esharevice.com` apex. Confirm Caddy is forwarding `Cookie` and `Set-Cookie` headers correctly (the existing config does; verify post-migration).

---

## Surface-By-Surface Plan

Every existing surface from the prior plan, generalized for all 5 listing types, plus new payment-related surfaces. Each surface follows the Airbnb pattern for that surface, recolored, with explicit type-polymorphism rules.

### Existing surfaces (rewritten for multi-type)

#### 1. `apps/web/app/page.tsx` — Landing / Browse

Direct adoption of the marketplace mockup:

- Masthead (sticky), 3-column grid: logo + mini-search-pill + language/avatar
- Centered hero with the headline + two-color soft underlines + split-pill search (segments: **What** / **Where** / **When** / search-button)
- **Listing-type filter chip row** below category strip: `All · Free · Trade · Rent · Hire · For sale` (single-select, default "All"). This is the primary type filter and is sticky together with the category strip.
- Sticky category strip (sticky from `top: 82px`)
- 5-column photo card grid, collapses through 4→3→2→1 at breakpoints. **Card meta is type-aware** — see Card spec below.
- "Become a provider" duo-gradient band
- 3-up How-It-Works section (now uses listing-type-aware language: "List it · Get requests · Trade, rent, or sell")
- "Trades happening right now" → renamed **"Happening right now in [city]"** to cover all activity types
- Neighbourhood tiles grid
- Tabbed pre-footer + 3-column footer + locale bottom

#### 2. `apps/web/app/items/[id]/page.tsx` — Item detail (POLYMORPHIC ACTION PANEL)

Airbnb's listing-detail pattern, recolored, with a polymorphic action panel:

- Photo gallery hero (4/5 portrait on mobile, 2-column gallery grid on desktop)
- Back / share / save buttons in floating glass pills (save shows orange heart when active)
- Title + rating row, hosted-by row, neighbourhood + distance
- **Action panel** — single bordered card, sticky on desktop right column, sits inline above the description on mobile. Renders based on `listing_type`:

| Type | Panel content | Primary CTA | Secondary |
|---|---|---|---|
| **gift** | "Free · Pickup only · Available now" | "Request this" (blue) | "Message" (ghost) |
| **trade** | Small blue dot + "Wants:" + wanted-thing prose, optional "Open to other offers" toggle | "Propose a trade" (blue) | "Message" (ghost) |
| **rent** | Price (`$40/day`), date-range picker (calendar with disabled occupied dates), live total `price × nights + deposit`, fee breakdown link | "Request to book" (blue) | "Message" (ghost) |
| **hire** | Hourly rate (`$25/hr`), date + duration picker (default 2 hrs), live total, fee breakdown link | "Request to book" (blue) | "Message" (ghost) |
| **sell** | Price (`$200`), condition badge, "Shipping" or "Local pickup" toggle | "Buy now" (blue) | "Make offer" (ghost) |

- Specs grid (Duration / Pickup / Condition / Includes) — fields shown vary by listing_type. Sell shows Condition + Shipping; Rent shows Duration + Pickup + Includes; Hire shows Duration + Location + What's included; Gift shows Pickup + Condition; Trade shows Duration + Pickup + What you'd want.
- Description in plain prose
- "Meet your trade partner" host card with vouches + completed-transactions count (broken down by type)
- Sticky bottom action bar (mobile): single primary CTA matching desktop primary
- For rent/hire, the action panel includes a clickable "How fees work" link → opens a small drawer explaining the 10–12% platform fee + Stripe processing fee + when funds release

#### 3. `apps/web/app/items/new/page.tsx` — List something (TYPE-FIRST WIZARD)

The single-page form from the prior plan becomes a **type-first 2-step wizard**:

- **Step 1 — Pick a type** (full-bleed screen): 5 large cards in a horizontal scroll (mobile) / 5-up grid (desktop). Each card: icon + type name + 1-line description + tiny example ("e.g. lawn mower for the weekend"). Tap selects.
- **Step 2 — Fill the form** (4 cards in a 2×2 grid, just like before): photos / title + description / what category / type-specific fields. Type-specific block:
  - **gift**: "Pickup location" + "Available from"
  - **trade**: "What you'd want in return" (the original `exchange` field, kept for trade only)
  - **rent**: "Price + unit" + "Deposit (optional)" + "Available dates" + "Condition"
  - **hire**: "Hourly rate" + "Typical duration" + "What's included" + "Available days/times"
  - **sell**: "Price" + "Condition" + "Pickup or shipping"

Continue/Publish button is blue, disabled until required fields valid. The form posts to a single `POST /v1/exchange-items` endpoint that accepts the type-discriminated body and runs the Zod `superRefine` validation.

#### 4. `apps/web/app/messages/page.tsx` + `messages/[id]/page.tsx` — Inbox + thread

- **Inbox list** — Airbnb's `/inbox` pattern. Avatar + name (bold) + message preview + timestamp. Trade title appears in a small grey eyebrow above the preview line. **Type-aware eyebrow**: shows the listing type icon (small) next to the trade title.
- **Thread view** — paper-white background, white message bubbles (1px border) for *them*, **blue-filled bubbles for *you*** (white text). Bubble radius `12px`. (Note: changed from orange-filled per the brand-color fix; orange is accent, blue is primary, you are the primary actor in your own messages.)
- **Trade/booking-context card pinned at top of thread** — small horizontal card showing the listing photo + title + status, linkable to the item AND to the related booking if one exists. For paid types, shows current booking status (Requested / Confirmed / Active / etc.).
- **Proposal acceptance ribbon** — when a counter-offer is accepted (trade) OR a booking is confirmed (rent/hire/sell), an inline blue ribbon ("Booking confirmed · Bastian · Sat 21–Sun 22 May · $80") replaces the input bar for 5 seconds, then returns the input.

#### 5. `apps/web/app/saved/page.tsx` — Saved (Wishlist)

Same gallery grid as landing. Heading: `Wishlist`. Empty state: a single line + ghost "Browse →" button. **Filter chip row at top**: same `All · Free · Trade · Rent · Hire · For sale` chips as landing, defaults to "All".

#### 6. `apps/web/app/profile/page.tsx` — Profile (mine + theirs)

- **Hero band** — large avatar (96px), name (Inter 28–32), neighbourhood, "Member since '25" in grey, **trust signals row**: rating average · completed-transactions broken down by type · Verified badge (if subscribed). For my own profile, includes a "Payout settings" link in the menu.
- **Active listings** — 3-up grid of their open listings (card pattern reused).
- **About** — short paragraph if they've written one.
- **Completed transactions** — vertical timeline list, each row: avatar + counterparty + transaction summary (type-aware: "Rented a chainsaw to Lily · 2 days · ★ 5") + date.
- **Vouched by** — avatar chain of 5-8 mutuals + a "see all" link.

#### 7. `apps/web/app/settings/notifications/page.tsx` — Settings

Airbnb's account-settings pattern. Vertical list of rows, each `[label · description] [toggle]`, `divide-y` between rows. Section heads in small grey caps: `EMAIL`, `PUSH`, `INBOX BADGES`, `BOOKING UPDATES` (new), `PAYOUT NOTIFICATIONS` (new).

#### 8. `apps/web/app/unsubscribe/page.tsx` — Unsubscribe

Single centered card: H1 + paragraph + blue button. (Changed from orange — blue is primary.)

#### 9. Auth / login / callback / loading / error

- **Login** — single-card centered form. Inter sans, **blue `Continue with Google`** as the primary CTA, ghost `Continue with Apple`, then a divider, then an email field with a **blue** `Continue` button (Auth.js routes to magic-link email if the address is unknown, or password screen if known). Auth.js owns the routing; Next.js renders the form.
- **Loading** — skeletal grey rectangles matching gallery card shapes. No spinners.
- **Error** — single-card with a clear message + a **blue** `Retry` button.

### New surfaces (payment flow)

#### 10. `apps/web/app/items/[id]/book/page.tsx` — Booking request (rent / hire)

Full-page booking flow. Shown after user clicks "Request to book" on a rent/hire item:

- **Step 1 — Confirm details**: date range (rent) or date+duration (hire), live price total + deposit, "Message to provider" optional text area.
- **Step 2 — Payment**: Stripe Payment Element (saved cards + new card + Apple/Google Pay). Fee breakdown disclosed: subtotal + platform fee + Stripe fee + total + deposit.
- **Step 3 — Submit**: `POST /v1/items/:id/bookings` with `{start_at, end_at, payment_method_id}`. On 2xx: show "Request sent" success page with "View request" link to the booking detail.

Sticky bottom action bar on mobile.

#### 11. `apps/web/app/items/[id]/buy/page.tsx` — Buy now (sell)

Single-page checkout. Shown after user clicks "Buy now" on a sell listing:

- Order summary card (photo + title + price + shipping choice)
- Shipping or pickup details (radio)
- Payment Element
- "Place order" button (blue, disabled until all fields valid)

#### 12. `apps/web/app/bookings/page.tsx` — My bookings (renter + provider tabs)

Two-tab page. Defaults to the user's "primary" role (whichever has more entries):

- **As renter** tab: list of bookings the user requested/booked, with status pill. Tap → booking detail.
- **As provider** tab: list of bookings on the user's listings, with status pill. Action buttons inline for `requested` status (Accept / Decline).

Each row: provider avatar + item thumb (32px) + title + dates + status pill + total. Filter chips at top: `All · Requested · Confirmed · Active · Completed · Cancelled`.

#### 13. `apps/web/app/bookings/[id]/page.tsx` — Booking detail

- **Header**: item title, status pill, date range, total
- **Counterparty card**: avatar + name + rating + message button
- **Status timeline**: visual progress bar through `Requested → Confirmed → Active → Returned → Completed`
- **Action panel** (state-dependent):
  - `requested` (provider view): Accept (blue) + Decline (ghost) buttons
  - `confirmed` (renter view, pre-start): Cancel booking link (eats deposit per policy)
  - `active` (provider view): "Mark returned" button (blue) once `end_at` reached
  - `returned` (both): "Submit review" button if not yet reviewed (within 14d)
  - `completed`: "Submit review" if still in window, "View payout" for provider
- **Fee breakdown** (collapsible): subtotal, platform fee, Stripe fee, deposit, payout amount
- **Dispute link** at the bottom (always visible during active/returned window): "Something wrong? File a dispute"

#### 14. `apps/web/app/bookings/[id]/review/page.tsx` — Submit review

- Reviewee card (avatar + name)
- 5-star rating control (big, tappable)
- Free-text body (2000 char max, character counter)
- Blue "Submit review" button
- Notice: "Your review won't be visible until your counterparty submits theirs (or 14 days have passed). This is how we prevent retaliation reviews." — directly borrowed from Airbnb's UX

#### 15. `apps/web/app/bookings/[id]/dispute/page.tsx` — File a dispute

- Reason radio: `item_damaged`, `item_not_returned`, `item_not_as_described`, `no_show_provider`, `no_show_renter`, `other`
- Body text area (4000 char max)
- Evidence upload (multipart, multiple files, R2 pipeline reuses the existing sharp + R2 stack)
- Blue "Submit dispute" button
- Notice: "We'll review your dispute within 48 hours. Funds are held until resolution."

Admin-side dispute review UI is OUT OF SCOPE for this plan — for v1, disputes are reviewed manually by the founder via direct SQL + Stripe dashboard.

#### 16. `apps/web/app/payouts/setup/page.tsx` — Stripe Connect onboarding entry

Single-card page:
- H1: "Get paid for your listings"
- Body: "Set up payouts in 5 minutes. Powered by Stripe."
- Blue "Continue with Stripe" button → server action that creates the `accountLink` and 302 redirects to Stripe-hosted onboarding
- Return URL is `apps/web/app/payouts/done/page.tsx` — success card + "View your listings" link

This is auto-shown the first time a provider tries to accept a booking when their Stripe account isn't `payouts_enabled`. Also accessible from profile menu.

---

## Component Inventory (`packages/ui`)

### Carried forward from prior plan

| Component | Notes |
|---|---|
| `<Card>` (rewrite) | **Type-aware meta**: renders `<RatingStar>` + the type-specific meta line (price / wants / "Free · Pickup"); the heart toggle; optional "Neighbour favourite" tag; the dots paginator |
| `<Heart saved>` | Heart icon button with **orange-fill saved state** (one of the few accent-color affordances) |
| `<RatingStar value>` | Black star + 2-decimal value (Airbnb style) |
| `<SearchPill segments>` | Split-pill search (hero) + mini-pill variant (nav) share a primitive |
| `<CategoryStrip items active>` | Horizontal scroll category tabs (icon over label, underline-on-active) |
| `<BecomeBand>` | Duo-gradient call-to-action card |
| `<LiveCard>` | Horizontal-scroll activity card |
| `<HoodTile>` | Neighbourhood tile (64×64 image + name + count) |
| `<MobileTabBar>` | 5-tab bottom nav for mobile |
| `<MobileSearchPill>` | Sticky top search bar for mobile |

### New for the systems overhaul

| Component | Notes |
|---|---|
| `<ListingTypeChips>` | The `All / Free / Trade / Rent / Hire / For sale` filter chip row — single-select, sticky-paired with `<CategoryStrip>` |
| `<TypeBadge type>` | The on-card colored pill (Free / Trade / Hire) — only renders for types that need labelling |
| `<ActionPanel item user>` | The polymorphic detail-page action card; switches subcomponent based on `item.listing_type` |
| `<ActionPanel.Gift>` | `<ActionPanel.Trade>` `<ActionPanel.Rent>` `<ActionPanel.Hire>` `<ActionPanel.Sell>` — five concrete renderers |
| `<DateRangePicker>` | Calendar with disabled dates (unavailable from `bookings`); two-month view desktop, one-month mobile |
| `<DurationPicker>` | Pill row for common durations (1h / 2h / 4h / half-day / full day / custom) for hire bookings |
| `<PriceBreakdown>` | Itemized fee disclosure: subtotal + platform fee + Stripe fee + deposit + total. Collapsible. Used on action panel, booking flow, booking detail. |
| `<StatusPill status>` | Booking status pill, color-coded: requested (grey), confirmed (blue), active (green), returned (orange-soft), completed (grey outline), cancelled/declined (red outline) |
| `<StatusTimeline status>` | Horizontal progress bar through booking lifecycle steps |
| `<StripeElement>` | Thin wrapper over `@stripe/react-stripe-js` Payment Element with branded styling tokens |
| `<TypeWizardCard type>` | The big-card type selector for the listing wizard step 1 |
| `<TrustSignalsRow user>` | Profile + detail-page row showing rating · completed counts by type · Verified badge |

All components keep the existing `cn()` helper, accept `className`, forward refs.

---

## Token Migration (`packages/ui/src/styles.css`)

Replace the current teal-on-near-white oklch palette with the corrected blue-primary system:

```css
:root {
  /* Surfaces */
  --bg:            oklch(100% 0 0);          /* #ffffff */
  --bg-elevated:   oklch(100% 0 0);
  --bg-subtle:     oklch(97% 0 0);            /* #f7f7f7 */
  --bg-soft:       oklch(93.5% 0 0);          /* #ebebeb */

  /* Text */
  --fg:            oklch(20% 0 0);            /* #222222 */
  --fg-muted:      oklch(47% 0 0);            /* #717171 — meets 4.6:1 AA */
  --fg-subtle:     oklch(72% 0 0);            /* #b0b0b0 — only on bg-subtle */

  /* Border */
  --border:        oklch(89% 0 0);            /* #dddddd */
  --border-strong: oklch(72% 0 0);            /* #b0b0b0 */

  /* Brand — SKY-500 from icon.svg (rgb(14,165,233) = #0EA5E9) */
  --brand:         oklch(70.5% 0.16 230);     /* #0EA5E9 sky-500 */
  --brand-h:       oklch(60% 0.155 230);      /* #0284C7 sky-600 */
  --brand-p:       oklch(51% 0.135 230);      /* #0369A1 sky-700 */
  --brand-deep:    oklch(45% 0.115 235);      /* #075985 sky-800 — text-on-soft */
  --brand-soft:    oklch(95% 0.025 220);      /* #E0F2FE sky-100 */
  --brand-fg:      oklch(100% 0 0);
  --brand-grad:    linear-gradient(135deg,
                     oklch(77% 0.135 225) 0%,   /* #38BDF8 sky-400 */
                     oklch(70.5% 0.16 230) 50%, /* #0EA5E9 sky-500 */
                     oklch(51% 0.135 230) 100%);/* #0369A1 sky-700 */

  /* Accent — AMBER-500 from icon.svg (rgb(245,158,11) = #F59E0B) */
  --accent:        oklch(75% 0.165 65);       /* #F59E0B amber-500 */
  --accent-h:      oklch(68% 0.165 50);       /* #D97706 amber-600 */
  --accent-soft:   oklch(96.5% 0.06 95);      /* #FEF3C7 amber-100 */
  --accent-fg:     oklch(20% 0 0);            /* #222 — text on amber-soft */

  /* Feedback */
  --danger:        oklch(58% 0.22 25);
  --success:       oklch(63% 0.16 145);
  --warning:       oklch(75% 0.16 65);        /* shares accent hue */
  --ring:          oklch(70.5% 0.16 230 / 0.4);
}

[data-theme="dark"] {
  --bg:            oklch(15% 0 0);
  --bg-elevated:   oklch(18% 0 0);
  --bg-subtle:     oklch(20% 0 0);
  --bg-soft:       oklch(24% 0 0);
  --fg:            oklch(96% 0 0);
  --fg-muted:      oklch(72% 0 0);
  --fg-subtle:     oklch(55% 0 0);
  --border:        oklch(28% 0 0);
  --border-strong: oklch(40% 0 0);
  --brand:         oklch(76% 0.155 228);      /* lifted for AA on dark bg */
  --brand-h:       oklch(80% 0.15 228);
  --brand-p:       oklch(72% 0.16 230);
  --brand-soft:    oklch(28% 0.05 230);
  --accent:        oklch(80% 0.16 70);        /* lifted for AA */
  --accent-h:      oklch(84% 0.155 70);
  --accent-soft:   oklch(28% 0.05 70);
  --ring:          oklch(76% 0.155 228 / 0.45);
}
```

Font: Inter via `next/font/google`, weights `400/500/600/700/800`, subset `latin`, with `variable: '--font-inter'` wired in `apps/web/app/layout.tsx`.

---

## API Changes

### Extended endpoints

| Endpoint | Change |
|---|---|
| `GET /v1/exchange-items` | Add response fields: `listing_type`, `price_cents`, `price_unit`, `deposit_cents`, `condition`, `available_from`/`to`, `location_lat`/`lng`/`precision`, `category_id` + nested `category`, `wants` (renamed from `exchange` for trade listings), `rating` (computed average), `neighbourhood` (computed from lat/lng), `distance_mi` (computed from caller's location when authenticated), `provider_name`, `neighbour_favourite` (computed boolean). New query params: `listing_type`, `category_slug`, `bbox` (geo bounding box), `min_price`, `max_price`. |
| `POST /v1/exchange-items` | Accept the type-discriminated body. Server enforces the Zod `superRefine` rules (rent/hire require price + unit, sell requires condition, etc.). Reject unknown fields with 400. |
| `PUT /v1/exchange-items/:id` | Same as POST, sparse. Reject `listing_type` changes — type is immutable post-create. |
| `PUT /v1/exchange-items/:id/reserve` | **Deprecated** but kept alive for 30 days. New code uses the bookings endpoints. |

### New endpoints

| Endpoint | Purpose |
|---|---|
| `POST /v1/items/:id/bookings` | Create a booking. Server inserts the row (EXCLUDE constraint protects), creates the Stripe `payment_intent` with manual capture + transfer_data, returns `{ booking, client_secret }`. |
| `GET /v1/bookings` | List the caller's bookings. Query: `role=renter\|provider`, `status=...`, cursor pagination. |
| `GET /v1/bookings/:id` | Single booking with related item + counterparty profile. |
| `POST /v1/bookings/:id/accept` | Provider accepts. Captures the payment intent. |
| `POST /v1/bookings/:id/decline` | Provider declines. Cancels the payment intent. Body: `{ reason }`. |
| `POST /v1/bookings/:id/return` | Provider marks the item as returned. Starts the 24h release window. |
| `POST /v1/bookings/:id/cancel` | Either party cancels pre-start. Refund rules per policy (renter: full if >24h before start; provider: any time, but penalty after 3 strikes). |
| `POST /v1/bookings/:id/reviews` | Submit a review for a completed booking. One per (booking, reviewer). |
| `POST /v1/bookings/:id/disputes` | File a dispute. Multipart with optional evidence files. |
| `POST /v1/payouts/account` | Create or fetch the caller's Stripe Connect account, returns the `accountLink.url` for onboarding. |
| `GET /v1/payouts/status` | Fetch the caller's `stripe_accounts` row (charges_enabled, payouts_enabled, etc.). |
| `POST /v1/webhooks/stripe` | Stripe webhook receiver. Idempotent via `stripe_events` PK. |
| `GET /v1/activity?limit=20` | Latest 20 events for the "Happening right now" row. Cache 60s. Returns `{ actor, verb, object, counterparty, timestamp, listing_type }`. |
| `GET /v1/neighbourhoods` | List of areas with live counts + a thumbnail key. Cache 5 min. |
| `GET /v1/categories` | List of the 40 seeded categories. Cache 24h (rarely changes). |

---

## Interaction State Coverage Matrix

A full pass at the gap the prior plan had. Every UI feature gets explicit spec for every state.

| Surface / Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Landing gallery | Card skeletons (1→2→3→4→5 cols matching breakpoint) | "Nothing in your area yet. List the first thing →" + blue CTA | Inline toast "Could not load. Retry?" + cached cards if any | Cards render with stagger fade-in (200ms, suppressed under reduced-motion) | "Showing nearby results — none in [neighbourhood] yet, here are the 5 closest" |
| Search results | Skeleton cards + sticky "Searching…" pill | "No matches. Try fewer filters." + reset-filters chip | Inline error in result area, search bar stays | Cards + result count "37 in 0–5 mi" | "Some filters loosened — `Rent` was empty, showing `All`" |
| Heart toggle | Heart inflates instantly (optimistic), spinner ring 1s | (N/A — toggle has 2 states) | Heart snaps back, toast "Couldn't save. Tap to retry." | Heart filled orange, micro-grow animation (suppressed under reduced-motion) | (N/A) |
| Item detail | Skeleton hero photo + skeleton title + skeleton panel | (N/A — 404 page if item missing) | "Couldn't load this item. Refresh." + back link | Full render | Photos load progressively (blur-up via R2 LQIP) |
| Action panel — Rent date picker | Calendar shows "Loading availability…" inside the picker | "Provider hasn't set availability yet." + Message CTA | "Couldn't check availability. Try again." | Calendar with disabled dates | "Some dates marked unavailable — provider has bookings" |
| Booking request submit | Button shows spinner, all inputs disabled | (N/A) | Toast with error reason; payment NOT charged ("Card was declined" / "Item just got booked by someone else" / "Network issue") | Redirect to booking detail with success banner | (N/A — submit is atomic) |
| Inbox list | Row skeletons (avatar + 2 text rows) × 8 | "Your inbox is empty. Threads start when you message or get messaged." | "Couldn't load inbox" + Retry | Rows render | Unread rows visually distinct (bold + blue dot) |
| Thread view | Bubble skeletons + sticky "Loading messages…" pill at top | (N/A — empty thread shows just the input bar + the trade-context card) | "Couldn't send" toast on a per-message basis; message stays in input | Bubble appears optimistically grey → confirmed white/blue | "Some older messages didn't load — scroll to retry" |
| Send message | Message bubble grey + "Sending…" + spinner | (N/A) | Bubble red + "Tap to retry" | Bubble fills to final color | (N/A) |
| Image upload (listing form) | Per-image progress ring on the placeholder | (N/A) | Per-image error overlay + "Remove" / "Retry" | Image fades in, overlay removes | "1 of 4 still uploading…" status row above the form |
| Profile | Avatar + name skeleton, sections show row skeletons | "No listings yet" / "No completed transactions yet" / "No vouches yet — ask a neighbour after your first transaction" | "Couldn't load profile" full-page | All sections render | "Trades completed timeline truncated to 20 — Show all" |
| Bookings list | Row skeletons × 6 | Tab-specific: "You haven't booked anything yet" (renter) / "No incoming requests" (provider) | "Couldn't load bookings" full-page | Rows render | "Showing last 30 days — older requests" link |
| Booking detail timeline | Timeline shows step-skeleton bars | (N/A) | "Couldn't load booking" + back link | Timeline current step pulses (blue), past steps filled, future steps grey | "Waiting for provider to mark returned" + ETA |
| Stripe onboarding return | Full-page spinner + "Linking your account…" while we hit `GET /v1/payouts/status` | (N/A) | "Setup didn't complete. Try again." + Retry button | "You're ready to accept bookings" + view-listings link | "Stripe still verifying — you can accept bookings, payouts release once verified" |
| Stripe webhook (server-side) | (N/A — async) | (N/A) | Logged + replayed via Stripe dashboard retry; no user-facing impact | DB updated, idempotency stored | (N/A — webhooks are atomic) |
| Live activity row | Avatar skeletons + ghost ticker | "Quiet right now — check back later" | (N/A — fail silent, hide the row) | Avatars render, blue pulse dot animates (suppressed under reduced-motion) | "Trades + bookings · last hour" |

The `<ActionPanel>` polymorph: every concrete renderer (Gift / Trade / Rent / Hire / Sell) MUST handle its own loading and error variants. The polymorph itself is dumb — switch on type, render the subcomponent.

---

## Mobile Considerations

- **Mini-search-pill** at top of mobile (replacing the desktop centered pill) — single-line, shows the active "What / Where" with the blue search button on the right. Sticky.
- **5-tab bottom nav** — Explore / Wishlist / **+ List** (the FAB-ish center, blue circle, orange-halo on press) / Inbox / Profile. The active tab tints blue. Inbox badge orange. Bookings UI lives under Profile to keep the nav at 5 tabs.
- **Single-column card grid** below 540px. Photos stay 1:1.
- **Sticky bottom action bar** on item detail: type-aware:
  - gift/trade/hire: `[ Message ] [ Primary CTA ]`
  - rent: `[ Message ] [ Request to book ]` opening into a bottom-sheet date picker before payment
  - sell: `[ Make offer ] [ Buy now ]`
- **Sticky cat strip + type filter chips** stay horizontal scroll, snap to start.
- **Touch targets** never below 44×44 — buttons in chips, heart, ticker scroll all sized accordingly.
- **`min-h-[100dvh]`** for any full-height splash.
- **`prefers-reduced-motion`** kills the live-pulse ring + heart-grow + skeleton shimmer + ribbon slide-in.
- **Booking flow on mobile** uses full-page steps (not a bottom sheet) so the keyboard doesn't fight the layout when entering shipping addresses or messages.
- **Tablet (768–1024)** uses 3-column gallery, retains the desktop action panel layout (sticky right column), but condenses spacing by 25%. Don't treat tablet as "big mobile" — it's a distinct breakpoint.

---

## Accessibility Threading

- **Orange on white** passes WCAG AA for large text (3:1) but **fails AA for normal text** (3.0:1). Therefore: never use orange directly for body text. Orange is only ever a background colour (CTAs, badges, saved-heart, "Free" pill) where white text or `--text` sits on top.
- **Blue on white** at `#0EA5E9`: 3.1:1 — same rule, never as body text. Bold buttons + the live pulse dot only. The "wants" dot is decorative; the bold word right next to it is `--text` (#222).
- **Text on white**: `--text` `#222` = 16.0:1 AAA. `--fg-muted` `#717171` = 4.6:1 AA.
- **Star rating + "Neighbour favourite" pill** both use `--text` on white — 16:1.
- **Heart-saved (orange)** is colour + shape + scale — heart toggles fill and grows on save; colour change is never the only signal.
- **Focus ring**: 2px **blue** outline (was orange in prior plan; blue is primary), 2px offset, 6px rounding — visible against white and on top of card photos. On dark mode, the lifted blue (`oklch(76% 0.155 228)`) is used — matches the `--brand` value in the dark-mode token block.
- **Live activity dot pulse animation** suppressed under `prefers-reduced-motion`.
- **Booking status pills** use color + label text + (for the currently-active step) a leading icon. Color is never the only differentiator.
- **Stripe Payment Element** inherits our token CSS variables via `appearance.variables` config — keep contrast ratios above 4.5:1 for the embedded fields.
- **Date picker** keyboard-navigable per ARIA grid pattern. Disabled dates announced as "Not available" via aria-disabled + sr-only text.
- **All form errors** rendered with `aria-live="polite"` regions, not just inline color.

---

## Edge Cases

### From prior plan (carried over)
- **Empty gallery** — single line + blue "List the first thing" button. No illustration, no smiley.
- **No saved items** — "Nothing saved yet. Tap the heart on a listing." Single-line.
- **No vouches yet on a new account** — "Vouched by 0 — ask a neighbour to vouch after your first transaction."
- **Long titles** — `line-clamp: 2` on card titles, full text on detail page.
- **Long "wants" lines** — `line-clamp: 2` on cards, never truncated on detail.
- **Reserved/booked items in gallery** — image gets a 70% white overlay + grey "BOOKED · 2 days" badge top-left.
- **Dark mode** — full token swap; brand colours lift slightly. Duo-gradient "Become a provider" band keeps hues but darkens background blend.
- **Reduced motion** — disable activity-dot pulse, hover image scale-on-card, heart-grow, skeleton shimmer, ribbon slide. Keep all colour + state transitions, clamp duration to 0.

### New for the systems overhaul

- **Provider not Stripe-verified yet** but receives a booking request — booking sits in `requested` for up to 7 days. Email nudges provider to onboard. After 7 days, booking auto-declines + auth voids.
- **Renter's card declines** during request — booking row created, payment intent fails, booking immediately moves to `declined` status. Friendly error: "Card was declined. Try a different card."
- **Item gets booked by someone else** while the renter is on the booking page — EXCLUDE constraint catches it; user sees "Just booked by someone else, sorry" + redirect to the listing.
- **Provider declines after acceptance** (status `confirmed`) — refund full amount, deposit, fees. Cancellation row logged. Strike on provider's account; 3 strikes = manual review.
- **Renter no-shows** for hire booking — provider marks "Renter didn't show" (a special return state) → full payout to provider, no refund.
- **Item damaged on return** — provider files dispute within 48h of `returned`. Funds held until resolution.
- **Mid-booking auth expires** (user's token expires while they're filling the booking form) — silent token refresh via NextAuth refresh-token flow; user sees no interruption.
- **Disabled dates** in the calendar are computed from `bookings` rows with status `confirmed` or `active`. Race window between picker fetch and booking submit: the EXCLUDE constraint is the final guard; UI handles the rare conflict gracefully.
- **Stripe webhook arrives twice** (network blip) — `stripe_events` PK insert fails on the second, handler short-circuits.
- **Stripe webhook arrives out of order** (e.g., `payment_intent.succeeded` before `account.updated`) — handlers are idempotent + check current DB state before writing; no assumption of order.
- **Image upload during listing creation fails mid-multipart** — partial state cleaned up; user sees per-image retry on the form. The listing isn't created until at least 1 image uploads successfully (server-side guard).
- **User edits their listing after a booking is confirmed** — fields like `description`, `provider`, photos are editable. `price_cents`, `available_from/to`, `condition`, `category_id` are LOCKED while any non-terminal booking exists, and the UI greys them out with a tooltip.
- **First-time provider Stripe onboarding interrupted** (user closes the Stripe tab) — when they return, `GET /v1/payouts/status` shows `details_submitted=false` → re-show the onboarding entry card.

---

## Files To Be Created / Touched

### Backend (apps/api + packages/db + packages/shared)

**New:**
- `packages/db/drizzle/0006_auth_password_hash.sql` (adds nullable `password_hash` column to `users` for the Auth.js Credentials provider; renumber listing-taxonomy migration to `0007` and shift the rest down by one accordingly)
- `packages/db/drizzle/0007_listing_taxonomy.sql`
- `packages/db/drizzle/0008_bookings.sql`
- `packages/db/drizzle/0009_stripe_connect.sql`
- `packages/db/drizzle/0010_reviews.sql`
- `packages/db/drizzle/0011_disputes.sql`
- `packages/db/drizzle/0012_subscriptions.sql`
- `apps/api/src/routes/v1/me-provision.ts` (new endpoint that Auth.js `signIn` callback calls to upsert local `users` row from verified token; thin wrapper over existing `resolveUserFromSub`)
- `packages/shared/src/schemas/booking.ts`
- `packages/shared/src/schemas/review.ts`
- `packages/shared/src/schemas/dispute.ts`
- `packages/shared/src/schemas/category.ts`
- `apps/api/src/lib/stripe.ts` (Stripe SDK singleton + helpers)
- `apps/api/src/lib/pricing.ts` (calculateTotals, calculateQuantity helpers)
- `apps/api/src/routes/v1/bookings.ts`
- `apps/api/src/routes/v1/payouts.ts`
- `apps/api/src/routes/v1/webhooks-stripe.ts`
- `apps/api/src/routes/v1/activity.ts`
- `apps/api/src/routes/v1/neighbourhoods.ts`
- `apps/api/src/routes/v1/categories.ts`
- `apps/api/src/jobs/bookings-activate.ts` (cron: confirmed → active)
- `apps/api/src/jobs/bookings-complete.ts` (cron: returned → completed after 24h)
- `apps/api/src/jobs/reviews-reveal.ts` (hourly: reveal mutual reviews)
- `apps/api/tests/bookings.test.ts` (including the EXCLUDE overlap test)
- `apps/api/tests/stripe-webhooks.test.ts` (idempotency, out-of-order)
- `apps/api/tests/reviews.test.ts`

**Rewritten:**
- `packages/db/src/schema.ts` (add new tables, enums, type exports; `users.password_hash` column added)
- `packages/shared/src/schemas/exchange-item.ts` (add `listing_type` discriminator + `superRefine`)
- `apps/api/src/routes/v1/exchange-items.ts` (extend GET response, accept new POST/PUT fields, deprecate `reserve`)
- `apps/api/src/middleware/auth.ts` (extend `jose`-based JWKS verifier to handle BOTH Authentik AND Auth.js issuers via `iss`-routed JWKS resolution during migration window; after 7-day flip, drop the Authentik branch)
- `apps/api/src/lib/users.ts` (extend `resolveUserFromSub` to handle Auth.js sub formats: `google:…`, `apple:…`, `email:…`)
- `apps/api/src/env.ts` (add `STRIPE_*` envs; update `OIDC_*` values to point at Auth.js JWKS during migration; delete Authentik-specific envs after flip)

### Frontend (apps/web + packages/ui)

**New:**
- `packages/ui/src/heart.tsx`
- `packages/ui/src/rating-star.tsx`
- `packages/ui/src/search-pill.tsx`
- `packages/ui/src/category-strip.tsx`
- `packages/ui/src/listing-type-chips.tsx`
- `packages/ui/src/type-badge.tsx`
- `packages/ui/src/become-band.tsx`
- `packages/ui/src/live-card.tsx`
- `packages/ui/src/hood-tile.tsx`
- `packages/ui/src/mobile-tab-bar.tsx`
- `packages/ui/src/mobile-search-pill.tsx`
- `packages/ui/src/action-panel/index.tsx` (polymorph dispatcher)
- `packages/ui/src/action-panel/gift.tsx`
- `packages/ui/src/action-panel/trade.tsx`
- `packages/ui/src/action-panel/rent.tsx`
- `packages/ui/src/action-panel/hire.tsx`
- `packages/ui/src/action-panel/sell.tsx`
- `packages/ui/src/date-range-picker.tsx`
- `packages/ui/src/duration-picker.tsx`
- `packages/ui/src/price-breakdown.tsx`
- `packages/ui/src/status-pill.tsx`
- `packages/ui/src/status-timeline.tsx`
- `packages/ui/src/stripe-element.tsx`
- `packages/ui/src/type-wizard-card.tsx`
- `packages/ui/src/trust-signals-row.tsx`
- `apps/web/app/items/[id]/book/page.tsx` (rent/hire booking flow)
- `apps/web/app/items/[id]/buy/page.tsx` (sell checkout)
- `apps/web/app/bookings/page.tsx` (renter + provider tabs)
- `apps/web/app/bookings/[id]/page.tsx` (booking detail)
- `apps/web/app/bookings/[id]/review/page.tsx`
- `apps/web/app/bookings/[id]/dispute/page.tsx`
- `apps/web/app/payouts/setup/page.tsx`
- `apps/web/app/payouts/done/page.tsx`
- `apps/web/app/api/stripe/create-payment-intent/route.ts` (proxy to api with auth)
- `apps/web/app/api/stripe/onboarding-link/route.ts` (proxy)
- `apps/web/lib/stripe-public.ts` (loadStripe with publishable key)
- `apps/web/auth.ts` (Auth.js v5 config — providers, callbacks, JWT strategy, RS256 signing key)
- `apps/web/app/api/auth/[...nextauth]/route.ts` (Auth.js handler — exports GET + POST)
- `apps/web/app/.well-known/jwks.json/route.ts` (publishes Auth.js public JWKS for the API to verify against)
- `apps/web/app/login/page.tsx` (branded login UI replacing Authentik's hosted flow — Google + Apple + email magic-link + email/password)
- `apps/web/middleware.ts` (Auth.js middleware for session resolution on protected routes)
- `docs/features/2026-05-17_marketplace-design-system.md`
- `docs/features/2026-05-17_bookings-and-payments.md`
- `docs/features/2026-05-17_authjs-migration.md` (migration runbook — flag flip, logout sweep, container teardown checklist)

**Rewritten:**
- `packages/ui/src/styles.css` (blue-primary, orange-accent, dark mode)
- `packages/ui/src/button.tsx` (`brand` / `ghost` / `accent` / `ink` variants)
- `packages/ui/src/card.tsx` (type-aware meta line)
- `apps/web/app/layout.tsx` (Inter via next/font, brand favicon update)
- `apps/web/app/icon.svg` (two-circles brand mark)
- `apps/web/app/globals.css` (consume new tokens)
- `apps/web/app/page.tsx` (landing with type filter chips)
- `apps/web/app/items/[id]/page.tsx` (polymorphic action panel)
- `apps/web/app/items/new/page.tsx` (type-first wizard)
- `apps/web/app/messages/page.tsx`
- `apps/web/app/messages/[id]/page.tsx`
- `apps/web/app/saved/page.tsx` (with type filter chips)
- `apps/web/app/profile/page.tsx` (trust signals, type-aware transactions timeline)
- `apps/web/app/settings/notifications/page.tsx` (booking + payout sections)
- `apps/web/app/unsubscribe/page.tsx`

### Infra (Authentik teardown)

**Rewritten:**
- `infra/docker-compose.yml` (remove `authentik-server`, `authentik-worker`, `authentik-postgres` services; remove their volumes, networks they uniquely use)
- `infra/Caddyfile` (remove the `auth.esharevice.com` block; DNS record can be removed from Cloudflare after 7-day overlap)
- `scripts/lighthouse-auth.cjs` (rewrite for Auth.js cookie injection — current script drives Authentik flow-executor with `X-Authentik-CSRF` header; replace with Auth.js's credentials-callback POST that returns a `__Secure-authjs.session-token` cookie)

**Deleted (after the 7-day overlap window):**
- `infra/authentik/` (entire directory — blueprints, theme overrides, init scripts)
- `infra/postgres/init/02-authentik-extensions.sql` if present
- Authentik-specific env vars in `infra/.env.example`: `AUTHENTIK_*`, `AUTHENTIK_EMAIL_*`, `AUTHENTIK_SECRET_KEY`, `AUTHENTIK_POSTGRES_*`

---

## Execution Order

12 PRs, sequenced for safe incremental shipping. Each PR leaves prod working; each opt-in via feature flags. **PR 1 absorbs the Authentik → Auth.js migration alongside the visual system foundation** — both are zero-marketplace-surface changes and ship together for a single coordinated foundation cut. Numbering matches the prior draft; nothing shifts.

| PR | Scope | Why this order | Feature flag |
|---|---|---|---|
| **PR 1 — Visual system foundation + Auth.js swap** | Token rewrite (`packages/ui/src/styles.css` sky-500/amber-500 + dark mode), `button.tsx` variants, Inter via `next/font`, `icon.svg` unchanged (already the source of truth). **Auth.js drop-in:** Auth.js config, JWKS endpoint at `/.well-known/jwks.json`, branded `/login` page with Google + Apple + magic-link, RS256 key pair generated, API `OIDC_*` env vars swapped. Authentik services removed from compose. `lighthouse-auth.cjs` rewritten for Auth.js cookie injection. No marketplace surface changes yet. | Foundation. Lets every later PR drop into the system. Auth swap rides here because every downstream surface assumes a user object — better to land the new auth source before features touch it. | — |
| **PR 2 — Schema 0007 + extended exchange-items API** | Migration `0007_listing_taxonomy.sql`, schema.ts updates, `ExchangeItemCreate` superRefine, `exchange-items.ts` route extended for new fields + new query params. Behavior unchanged for old clients. | Backend foundation. Future PRs assume the type field exists. | `FEATURE_LISTING_TYPES` |
| **PR 3 — Schema 0008 + bookings API** | Migration `0008_bookings.sql`, `bookings.ts` route, `pricing.ts` helpers (CAD-aware), integration tests including EXCLUDE overlap test. Cron jobs `bookings-activate` + `bookings-complete` shipped but no-op without flag. | Booking endpoints live before any UI calls them. | `FEATURE_BOOKINGS` |
| **PR 4 — Schema 0009 + Stripe Connect Canada API** | Migration `0009_stripe_connect.sql`, `payouts.ts` route, `webhooks-stripe.ts` route, Stripe SDK setup with Canadian merchant config (CAD default, GST/HST via Stripe Tax), `STRIPE_*` envs in `.env.example`, webhook signature verification + idempotency tests. | Payment rails before payment UIs. | `FEATURE_STRIPE` |
| **PR 5 — Marketplace UI primitives** | All new `packages/ui` components (`<Heart>`, `<RatingStar>`, `<SearchPill>`, `<CategoryStrip>`, `<ListingTypeChips>`, `<TypeBadge>`, `<BecomeBand>`, `<LiveCard>`, `<HoodTile>`, `<MobileTabBar>`, `<MobileSearchPill>`, `<ActionPanel>` skeleton + 5 concrete renderers, `<DateRangePicker>`, `<DurationPicker>`, `<PriceBreakdown>`, `<StatusPill>`, `<StatusTimeline>`, `<TrustSignalsRow>`, `<TypeWizardCard>`). Components page at `docs/mockups/_components.html` for visual QA. | Lets every surface PR pick from pre-built pieces. | — |
| **PR 6 — Landing redesign** | Replace `apps/web/app/page.tsx` body with the marketplace landing. Type filter chips wired (filter is client-only until `GET /v1/exchange-items` query param is consumed). | Visible win, validates the system. | — |
| **PR 7 — Item detail with polymorphic action panel** | Rewrite `apps/web/app/items/[id]/page.tsx`. All 5 listing types render correctly. Booking/buy CTAs link to (not-yet-built) flow pages. | Reading half of the new product is live. | — |
| **PR 8 — Listing form type-first wizard** | Rewrite `apps/web/app/items/new/page.tsx`. Type selector step → type-specific form. POSTs to extended `/v1/exchange-items`. | Providers can now create rent/hire/sell/gift/trade listings. | — |
| **PR 9 — Booking flow (rent/hire) + Schema 0010 reviews** | Migration `0010_reviews.sql`, `apps/web/app/items/[id]/book/page.tsx`, `apps/web/app/bookings/page.tsx`, `[id]/page.tsx`, `[id]/review/page.tsx`. Stripe Payment Element wired (CAD default). Reviews backend endpoints. Reviews UI on booking detail. | First revenue PR. Behind `FEATURE_BOOKINGS` flag; team-rolled to founder + 10 invited users first. | `FEATURE_BOOKINGS` |
| **PR 10 — Buy now flow (sell) + Schema 0011 disputes** | Migration `0011_disputes.sql`, `items/[id]/buy/page.tsx`, `bookings/[id]/dispute/page.tsx`. Sell listings now transactable. Dispute filing UI live. | Sell is the second revenue type. Disputes ship together so first dispute path exists when issues arise. | `FEATURE_BOOKINGS` |
| **PR 11 — Provider payout setup + cron jobs go live** | `apps/web/app/payouts/setup/page.tsx` + `payouts/done/page.tsx`. Stripe Connect onboarding flow end-to-end. `bookings-activate` and `bookings-complete` cron jobs flip from no-op to active. `FEATURE_BOOKINGS` flag flipped to true for all users. | Full revenue path live. | (flag off) |
| **PR 12 — Profile redesign + Schema 0012 subscriptions + remaining surfaces** | Migration `0012_subscriptions.sql`, profile rewrite with trust signals + type-aware timeline, settings additions, Saved, Messages updates, unsubscribe, login polish. Stripe Billing for Verified ($15 CAD/mo) + Pro ($29 CAD/mo) wired. | Cleanup + Pro/Verified tiers ship. | `FEATURE_SUBSCRIPTIONS` |

**Drop legacy:** After PR 12 ships and runs in prod for 30 days with no `reserve` endpoint traffic, a `PR 13` lands migration `0013_drop_legacy` that removes `reserved`, `reserved_by`, `reserved_at`, and the freeform `exchange` column.

**Mobile native (Expo / React Native):** OUT OF SCOPE for this plan. Starts as a separate plan after PR 12 ships and we have first revenue signal. The API contracts in PRs 2–12 are mobile-ready by design (Auth.js JWKS-based RS256 JWT auth — OIDC-compatible, JSON-only, no SSR-only routes).

---

## 90-Day Launch Sequencing

PR sequencing above answers *what ships*. This section answers *what we do with what shipped*.

### Days 0–14 — Foundation in production (Toronto market: M5A 4M3)

- Ship PRs 1–5 to production. No user-visible change yet (feature flags off). Smoke-test backend in prod with synthetic data.
- **Stripe Connect Canada setup**: create Canadian platform account (requires Business Number from CRA — register first), complete platform onboarding, **enable Stripe Tax for Ontario** (GST/HST), enable Stripe Identity, configure webhooks, get publishable + secret keys, draft content policy with Canadian regulated-goods exclusions.
- **Auth.js production setup**: generate RS256 key pair (one-time, store private key in 1Password + as `AUTH_JWT_PRIVATE_KEY` env), register Google OAuth client + Apple Sign-In service ID (Apple requires the App Store Connect account that the future mobile app will use — register now), configure Resend domain for magic-link emails.
- **Walk M5A 4M3 in person.** Saturday morning at St. Lawrence Market. List 50 items yourself across all 5 types (kitchen gear, condo-friendly tools, ski rentals, services). Real photos taken on the walk; real prices in CAD.
- **Map the supply pockets.** M5A 4M3 spans the Distillery, St. Lawrence, Corktown, and West Don Lands — different demographics per pocket. Distillery: tourist-leaning retail; less neighbor supply. St. Lawrence + Corktown: townhouses + low-rise condos, real supply. West Don Lands: newer high-density condos, weaker supply but strong demand. Lean supply outreach into St. Lawrence + Corktown first.
- Order a printer batch: **300 letter-size posters** for coffee shop bulletin boards + library notice boards (no door-hangers — they don't work on condo entrances).

### Days 15–30 — Seed supply, then ship UI

- Ship PRs 6–8 (landing redesign + item detail + listing wizard). The platform now looks like a marketplace and providers can create the full range of listing types.
- **Poster the neighborhood:** St. Lawrence Market bulletin board, Tandem Coffee, Boxcar Social (Distillery), Dark Horse Espresso, Balzac's, the St. Lawrence library branch, the Toronto Public Library Reference Library on Yonge, the Distillery Sunday Market booth. Poster headline: "Your neighbour has the kitchen mixer / ski rental / handyman you need this weekend. esharevice.com."
- **Reddit pass:** post to r/toronto, r/askTO, r/StLawrence. Frame as "I built a thing for the neighbourhood, looking for first 50 testers" — not "launch announcement." Real founder voice, no marketing copy. Engage with every comment.
- **Bunz alumni outreach:** Bunz (the Toronto trade app, peak 2016–2019, now dormant) left a community-shaped hole. Search Twitter/X + LinkedIn for ex-Bunz users in Toronto. DM 100 of them with: "You used Bunz back in the day. I'm building a Toronto-first take that handles rentals + paid services in addition to trade. Free Pro tier forever if you list 3 things in the next 7 days." Expect ~15% reply rate.
- **Kijiji + Facebook Marketplace re-listing offer:** identify the top 50 Toronto-active providers on each platform. Cold-DM: "Saw your [item] on Kijiji. Want a free cross-listing on esharevice.com? Same listing, payments handled by Stripe (no Venmo dance), built for downtown Toronto."
- **No door-knocking condo towers** — concierge gates you. Instead: hand cards at the Saturday Distillery Sunday Market + the St. Lawrence Market — high-foot-traffic spots with the right demographic.
- **Cold-DM 50 Toronto handymen, movers, cleaners, tutors** on Kijiji "Services" + Bunz alumni. Same Pro-tier-free pitch.

### Days 31–60 — Turn on payments

- Ship PR 9 (booking flow + reviews) behind flag. Roll to founder + first 10 invited paying users for soak.
- Ship PR 10 (sell flow + disputes).
- Ship PR 11 (payout onboarding). Flag flips ON for all users. **First real revenue.**
- **First 30 paid transactions** target by day 60. Founder personally onboards every provider who clicks "Accept" the first time (15-min Zoom: walk them through Stripe Connect, answer questions). This is sales work, not engineering work.
- SEO landing pages stand up: 40 categories × **5 surrounding Toronto FSAs (M5A, M5B, M5C, M5E, M4M)** = 200 pages. Each page has 10–30 real listings, prices in CAD. Indexed within 4–6 weeks.
- Local SEO: Google Business Profile (Toronto), Yelp Canada, BlogTO directory submission, 50 NAP-consistent Canadian citations.

### Days 61–90 — Compound the loop

- Ship PR 12 (profile + subscriptions). Verified ($15 CAD/mo) and Pro ($29 CAD/mo) tiers go live. First 100 Pro users get the first 12 months free in exchange for being case studies.
- **100 completed paid transactions** target by day 90. At ~$45 CAD avg × 11% blended take = ~$500 CAD of platform revenue. This is a *demonstration*, not a business. But it proves the loop closes — and that's the only thing investors at this stage care about.
- One weekly operator blog post (real founder voice, not AI-generated).
- Activation funnel analysis: signup → first listing OR first booking request → first completed transaction. The biggest drop-off step IS the priority for the next sprint.
- Stop active postering / market-day card distribution when the platform has > 30 completed transactions/week. Switch to content + paid local Google ads (geo-targeted to downtown Toronto FSAs) only after the organic loop is compounding.

### What we don't do in the first 90 days

- No second metro.
- No press / launch announcement.
- No feature shipping beyond fixes for things observed in user sessions.
- No fundraising conversations beyond office hours.
- No mobile native app (the API is mobile-ready; the app waits for revenue signal).

---

## Risks and Mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| **Stripe Tax misconfigured at launch** | We charge but don't collect sales tax → CRA liability | Enable Stripe Tax for Canada from PR 4. Test in Stripe's test mode with multiple Canadian province addresses (ON, QC, BC, AB) before flipping to live. HST (Ontario 13%) is the default at launch. |
| **First provider has a bad first booking** (damage, no-show, dispute) | Word-of-mouth in a single Toronto FSA is fragile — Bunz's collapse showed how fast Toronto trust evaporates | Founder personally mediates the first 10 disputes. Stripe Connect dispute UI for renters is wired even before the admin tools exist. |
| **EXCLUDE constraint hits an unexpected case** in production (e.g., timezone weirdness — Toronto is `America/Toronto`, DST-active) | Could cause legitimate bookings to fail | Integration test in PR 3 covers tz edge cases including spring-forward + fall-back. Backend logs every EXCLUDE rejection with the conflicting booking ID — first month, founder reviews logs daily. |
| **Stripe webhook drops a `payment_intent.succeeded`** | Booking stays stuck in `requested` | Cron job `bookings-reconcile` (ship in PR 11) cross-checks every `requested > 6h` booking against Stripe via API and updates state. |
| **Auth.js migration leaves orphaned Authentik sessions** | Users could end up double-authenticated or unable to log in | The 7-day overlap window allows both verifiers; after flip, run a one-time logout-everyone sweep against the old Authentik session store before tearing down the containers. Migration test covers session-cookie collision. |
| **M5A supply mix doesn't match the suburban thesis** | Downtown condos = less garage = different listing inventory than the "pressure washer / lawnmower" playbook assumes | Lean into condo-friendly categories first: kitchen, party gear, ski/sports equipment, services (handymen, dog walkers, tutors), apartment-friendly free hand-me-downs. Cabbagetown + Riverdale + Leslieville (M4X, M4M, M4K — short transit ride) carry the rowhouse-with-side-yard supply if M5A alone is thin. |
| **Concierge gates blocking condo door-knocking** | The original launch playbook assumed door-to-door physical access | Drop door-hanging in M5A. Replace with: coffee-shop + library postering, St. Lawrence Market hand-card distribution, Distillery Sunday Market booth, Reddit (r/toronto, r/askTO), Bunz-alumni Twitter DMs, Kijiji-Toronto cross-listing offers. |
| **Feature flag flip happens mid-active-booking** | Active bookings might 404 if their flow paths get hidden | Flags only gate route visibility, not route response. Every paid-flow route returns its normal response regardless of flag. UI gates discovery. |
| **R2 image pipeline fails for listings created during the wizard flow** | Listing without photos is useless | Server enforces "at least 1 image uploaded successfully" before listing is created. Wizard saves draft locally (localStorage) on every step so user doesn't lose work. |
| **Provider's Stripe Connect account goes `restricted`** mid-month | Existing bookings get stuck | Webhook handler immediately pauses new bookings to that provider + emails them with the dashboard link to resolve. |
| **Date picker calendar shows stale availability** because bookings are made simultaneously | Frustrating UX | Picker refetches on focus + every 30s while open. EXCLUDE constraint is the final guard; UI handles the rare "just got booked" error with a clean redirect back to the listing. |
| **Content policy violation** sneaks through (e.g., firearms) | Stripe could terminate the platform account | Listing creation enforces a category-based + keyword-based allowlist. Founder reviews flagged listings within 24h. |

---

## Resolved Decisions

All open items from the prior draft are now locked. Captured here as the source-of-truth answer:

| # | Item | Resolved |
|---|---|---|
| 1 | Exact orange hex | **`#F59E0B`** (amber-500, from `apps/web/app/icon.svg`) |
| 2 | Exact blue hex | **`#0EA5E9`** (sky-500, from `apps/web/app/icon.svg`) |
| 3 | Logo lock-up | **Orange (amber-500) circle in front, on the left. Blue (sky-500) circle behind, on the right. Flat overlap — no `mix-blend-mode`** (matches the shipped SVG). |
| 4 | Take rate split | **10% on rent + sell, 12% on hire** (services have higher support cost). |
| 5 | Deposit defaults | **Optional, provider-set.** Provider can require any non-negative integer in cents-CAD. v1.5 may add a "Recommended" hint based on item price. |
| 6 | First launch market | **Toronto, ON — postal code M5A 4M3** (Corktown / St. Lawrence / Distillery / West Don Lands). |
| 7 | Stripe Tax | **Enabled from day one.** Stripe Tax Canada configured for Ontario HST. |
| 8 | Pro tier free-for-life for first 100 | **Yes** — locks in supply. Pro perks: unlimited listings, calendar sync, deposit collection, recurring availability, "Pro" badge. |
| 9 | Sell flow shipping | **Provider chooses pickup-only OR ships.** Shipping rates calculated via Stripe Shipping (Canada Post + UPS rates). Pickup-only is the default to keep v1 simple. |
| 10 | Mobile native plan | **Deferred** until after first revenue signal (day 60+ at minimum). API contracts in PRs 2–11 are mobile-ready by design; the React Native + Expo build is a separate plan. |
| 11 | Auth system | **Swap Authentik → Auth.js / NextAuth** with RS256 asymmetric JWT + JWKS endpoint published by the Next.js app. Google + Apple + Email magic-link providers in v1. Email + password deferred to v1.5 if signup data shows demand. |

### Still open (small)

- **Apple Sign-In requires an Apple Developer Program enrollment** (CAD $129/year). Confirm enrollment before PR 1 ships; if deferred, ship with Google + magic-link only and add Apple in a fast-follow PR.
- **Canadian Business Number registration** for Stripe Connect Canada. Founder action — ~30 min on the CRA Business Registration Online site. Must be done before PR 4 (Stripe API) ships to production.
- **Resend domain verification for the new auth flow:** the existing `esharevice.com` Resend domain is already verified for Authentik notifications. Magic-link emails reuse it; no new domain setup needed.

---

## Companion Documents

This plan is the implementation source of truth. For context, refer to:

- [YCombinator/2026-05-16_yc-partner-memo.md](../YCombinator/2026-05-16_yc-partner-memo.md) — YC-partner-style diligence memo on the original product
- [YCombinator/2026-05-16_positioning-and-monetization-strategy.md](../YCombinator/2026-05-16_positioning-and-monetization-strategy.md) — strategic pivot rationale
- [YCombinator/2026-05-16_pivot-to-profitable-consumer-marketplace.md](../YCombinator/2026-05-16_pivot-to-profitable-consumer-marketplace.md) — founder-facing pivot answer to YC's 5 questions
- [YCombinator/2026-05-16_deep-dive-pivot-execution.md](../YCombinator/2026-05-16_deep-dive-pivot-execution.md) — full SQL for migrations 0006–0011, full Stripe Connect implementation code, launch playbook deep-dive, rebrand candidates (shelved)
- [docs/mockups/2026-05-16_landing-marketplace.html](../docs/mockups/2026-05-16_landing-marketplace.html) — approved visual reference

---

## Progress

PR-by-PR shipping status. Each PR links to its task log for the implementation detail; this table is the master tracker.

| PR | Scope | Status | Task log | GitHub |
|---|---|---|---|---|
| **PR 1a** | Visual foundation (sky/amber tokens, button taxonomy, variant + accent-token sweep), migration 0006 `users.password_hash`, Auth.js env scaffolding (docs + RS256 keypair + .env.local sourced) | **Shipped 2026-05-17** | [2026-05-17_pr1a-visual-foundation.md](2026-05-17_pr1a-visual-foundation.md) | [#1](https://github.com/myndgrid/esharevice/pull/1) |
| **PR 1b** | Auth.js wire-up: install `next-auth@beta`, `apps/web/auth.ts`, JWKS endpoint at `/.well-known/jwks.json`, branded `/login`, replace `apps/web/middleware.ts`, dual-issuer JWKS verifier in API, `/v1/me/provision`, Authentik teardown after 7-day overlap, `lighthouse-auth.cjs` rewrite, `docs/features/2026-05-17_authjs-migration.md` runbook | Pending | — | — |
| **PR 2** | Schema 0007 listing taxonomy + extended `/v1/exchange-items` API (type-discriminated body, new query params, deprecate `reserve`) | **Shipped 2026-05-17** | [2026-05-17_pr2-listing-taxonomy.md](2026-05-17_pr2-listing-taxonomy.md) | [#2](https://github.com/myndgrid/esharevice/pull/2) |
| **PR 3** | Schema 0008 bookings (with `EXCLUDE USING gist` no-overlap constraint) + bookings API + pricing helpers + activate/complete cron jobs (no-op until flag flip) | **Shipped 2026-05-17** | [2026-05-17_pr3-bookings.md](2026-05-17_pr3-bookings.md) | — |
| **PR 4** | Schema 0009 Stripe Connect + `payouts.ts` + webhook receiver + Stripe SDK (CAD default, GST/HST via Stripe Tax) | **Shipped 2026-05-17** | [2026-05-17_pr4-stripe-connect.md](2026-05-17_pr4-stripe-connect.md) | (GitHub PR follow) |
| **PR 5** | Marketplace UI primitives: `<Heart>`, `<RatingStar>`, `<SearchPill>`, `<CategoryStrip>`, `<ListingTypeChips>`, `<TypeBadge>`, `<BecomeBand>`, `<LiveCard>`, `<HoodTile>`, `<MobileTabBar>`, `<MobileSearchPill>`, `<ActionPanel>` + 5 renderers, `<DateRangePicker>`, `<DurationPicker>`, `<PriceBreakdown>`, `<StatusPill>`, `<StatusTimeline>`, `<TrustSignalsRow>`, `<TypeWizardCard>` + components page at `docs/mockups/_components.html` | Pending | — | — |
| **PR 6** | Landing redesign — `apps/web/app/page.tsx` body becomes marketplace landing with type filter chips | Pending | — | — |
| **PR 7** | Item detail with polymorphic action panel — all 5 listing types render | Pending | — | — |
| **PR 8** | Listing form type-first wizard — `apps/web/app/items/new/page.tsx` rewrite | Pending | — | — |
| **PR 9** | Booking flow (rent/hire) + Schema 0010 reviews + Stripe Payment Element + reviews UI on booking detail | Pending | — | — |
| **PR 10** | Buy now flow (sell) + Schema 0011 disputes + dispute filing UI | Pending | — | — |
| **PR 11** | Provider payout setup + cron jobs go live + `FEATURE_BOOKINGS` flag flips for all users — full revenue path live | Pending | — | — |
| **PR 12** | Profile redesign + Schema 0012 subscriptions + remaining surfaces (Saved, Messages, settings additions, unsubscribe, login polish) + Stripe Billing for Verified/Pro tiers | Pending | — | — |
| **PR 13** | Drop legacy `reserved`, `reserved_by`, `reserved_at`, `exchange` columns after 30-day overlap | Pending | — | — |

---

## Outcome (To Be Filled)

After execution, capture:
- Lighthouse scores before/after for each surface
- Dark/light mode screenshots of every surface
- List of any tokens or components that didn't survive contact with real data
- Mobile thumb-reach audit
- First 100 transactions: type breakdown, average value, take rate realized, dispute rate, NPS from first 50 users
- Stripe Connect onboarding completion rate (provider funnel: clicked "Continue with Stripe" → completed verification)
- Feature-flag flip dates + any incidents that required a rollback
