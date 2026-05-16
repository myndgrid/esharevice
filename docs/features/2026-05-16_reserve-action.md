# Feature: Reserve action

**Created:** 2026-05-16 03:35 UTC
**Last Updated:** 2026-05-16 03:35 UTC
**Status:** Stable. Live at `https://esharevice.com/items/[id]` for any authenticated non-owner.

A logged-in user who isn't the item's owner can reserve it from the detail page. Reserving is single-winner under concurrent traffic: even if two browsers POST the same `PUT /reserve` at the same instant, only one of them gets a 200; the other gets `409 Already reserved`.

## Routes / API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| (server action) | `reserveAction(itemId)` in `apps/web/app/items/[id]/reserve-action.ts` | session cookie | Calls `api.reserveExchangeItem`; on 401 redirects to login with `return_to`; on success `revalidatePath` + redirect to the detail page |
| PUT | `/v1/exchange-items/{id}/reserve` | Bearer + Idempotency | The underlying API endpoint — unchanged contract, now race-safe at the SQL level |

## Modules / Classes Involved

| File | Role |
|---|---|
| [apps/web/app/items/[id]/page.tsx](../../apps/web/app/items/[id]/page.tsx) | Detail page; fetches `/v1/me` alongside the item (parallel via `Promise.all`); branches on ownership + reservation state |
| [apps/web/app/items/[id]/reserve-action.ts](../../apps/web/app/items/[id]/reserve-action.ts) | Server action wrapper; generates a fresh `randomUUID()` idempotency key per invocation |
| [apps/web/app/items/[id]/reserve-button.tsx](../../apps/web/app/items/[id]/reserve-button.tsx) | Client component using `useActionState` for pending + error state; wrapped in `<form className="contents">` so submit triggers the action |
| [apps/api/src/routes/v1/exchange-items.ts](../../apps/api/src/routes/v1/exchange-items.ts) | Race-safe `PUT /reserve` — the UPDATE now has `WHERE id = $1 AND reserved = false` |
| [apps/web/lib/api.ts](../../apps/web/lib/api.ts) | `reserveExchangeItem(id, idempotencyKey?)` — already in place from week 4 |

## Frontend Views / Functions Involved

The detail page renders one of these depending on viewer + item state:

| State | UI |
|---|---|
| Not signed in | `<Link>` to `/api/auth/login?return_to=/items/{id}` with `prefetch={false}` |
| Signed in, owner | "You posted this item." — no action |
| Signed in, non-owner, item free | `<ReserveButton itemId={item.id}/>` |
| Signed in, non-owner, reserved by viewer | "You reserved this." |
| Signed in, non-owner, reserved by someone else | "Already reserved." |

Ownership is detected by comparing `me.id` (UUID from `/v1/me`) to `item.user_id` (UUID).

## Persistence (files or tables touched)

- `exchange_items.reserved = true`, `reserved_by = $sub_uuid`, `reserved_at = now()`, `updated_at = now()` — single SQL UPDATE gated on `WHERE id = $id AND reserved = false`.
- No new tables or columns.

## Edge Cases & Gotchas

- **Reserve race-safety.** Two simultaneous POSTs from different users for the same item used to race: pre-read both saw `reserved = false`, both UPDATEs ran, the second one won and overwrote `reserved_by`. The fix is the predicate on the UPDATE itself — Postgres serialises the two UPDATEs by row lock, and the second one's WHERE clause no longer matches, so it returns zero rows. The handler turns that into a `409 Already reserved`.
- **Idempotency-Key.** A fresh `randomUUID()` is generated server-side per call to the action. A user clicking "Reserve" twice in 200 ms sends two requests, each with a different key, so each one truly attempts the operation. The API's race-safe UPDATE plus the pre-read make this safe (worst case: the second click sees the 409 banner faster than a successful reserve). We chose this over a per-button-mount key because the action is naturally idempotent at the SQL layer; an extra cache layer would only delay user feedback.
- **State-changing operation over POST + form.** The reserve link is a `<form method="post">`, never an `<a href>` or `<Link>`. Same rule that bit us with logout in week 5 — Next 15's `<Link>` prefetches GET responses, and any `Set-Cookie` or state-mutating side effect would fire on prefetch. Form + POST is the canonical answer.
- **401 mid-flight.** If the session expires between page render and click, the action catches the 401 from `api.reserveExchangeItem` and redirects to `/api/auth/login?return_to=/items/{id}`. After login the user lands on the same detail page and can click Reserve again.
- **`revalidatePath` after success.** Next 15 server-side caches the detail page's response for a few seconds; without `revalidatePath` the user would land on the detail page and still see "Reserve" until the cache TTL expired. Explicit invalidation makes the new badge appear immediately.
- **Cannot reserve your own item.** The handler checks `row.user_id === u.id` AFTER the pre-read but BEFORE the UPDATE. Returns 409 with a specific message so the UI can distinguish "lost a race" from "you're the owner". The detail page surfaces the owner case earlier (it hides the Reserve button), so this branch is a defense-in-depth — direct API hits still get the right answer.

## Environment Variables Required

None new. Same OIDC + DB env from prior weeks.

## Changelog

| Date | Change |
|---|---|
| 2026-05-16 03:35 UTC | Initial documentation; flow live on `https://esharevice.com/items/[id]` |
