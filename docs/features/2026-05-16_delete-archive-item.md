# Feature: Delete (soft-archive) exchange item

**Created:** 2026-05-16 06:00 UTC
**Last Updated:** 2026-05-16 06:00 UTC
**Status:** Live at `https://esharevice.com/items/[id]/edit` for the owner. Closes the listing-lifecycle loop end-to-end: **create → view → edit → reserve → save → delete**.

A user who posted an exchange item can now remove it. Implemented as a soft delete: a new `archived_at` column on `exchange_items` is set to `now()` instead of dropping the row. The listing instantly disappears from every API read; existing saves + reservation history stay intact for audit + referential integrity.

## Routes / API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| DELETE | `/v1/exchange-items/{id}` | Bearer + owner + Idempotency | Set `archived_at = now()`. Returns `204 No Content`. Idempotent — repeat calls on an already-archived row also return 204. Non-owners get 403 (we don't 404 a real id to non-owners — would leak existence). |
| GET | `/v1/exchange-items` | optional | Now filtered `WHERE archived_at IS NULL`; uses the `exchange_items_active_idx` partial index for stable cursor performance even as the archived tail grows. |
| GET / PUT / POST | `/v1/exchange-items/{id}{,/reserve,/image,/save}` | various | All gated on `archived_at IS NULL`; archived listings 404 the same way "missing item" does. |
| GET | `/v1/saves` | Bearer | Join condition filters archived items out of the listing even when the user's save row still exists. |

## Modules / Files Involved

| File | Role |
|---|---|
| [packages/db/src/schema.ts](../../packages/db/src/schema.ts) | `exchange_items.archived_at` column added |
| [packages/db/drizzle/0002_0001_exchange_items_archived_at.sql](../../packages/db/drizzle/0002_0001_exchange_items_archived_at.sql) | Migration: column + `exchange_items_active_idx` partial index (covers `(created_at DESC, id DESC) WHERE archived_at IS NULL`) |
| [apps/api/src/routes/v1/exchange-items.ts](../../apps/api/src/routes/v1/exchange-items.ts) | DELETE handler + `isNull(archived_at)` filter on every read/write |
| [apps/api/src/routes/v1/saves.ts](../../apps/api/src/routes/v1/saves.ts) | `isNull(archived_at)` on get-save-state + put-save + listing join |
| [apps/web/lib/api.ts](../../apps/web/lib/api.ts) | `api.deleteExchangeItem(id, idempotencyKey?)` |
| [apps/web/app/items/[id]/edit/delete-action.ts](../../apps/web/app/items/[id]/edit/delete-action.ts) | Server action; randomUUID per invocation; 404 from API treated as success (same end state); `revalidatePath` on /, /saved, /items/[id]; redirect to / on success |
| [apps/web/app/items/[id]/edit/delete-button.tsx](../../apps/web/app/items/[id]/edit/delete-button.tsx) | Client component with inline two-step confirmation (no browser `confirm()` dialog — accessible + on-brand) |
| [apps/web/app/items/[id]/edit/page.tsx](../../apps/web/app/items/[id]/edit/page.tsx) | "Danger zone" Card section below the edit form |

## Persistence (tables touched)

- **Updated:** `exchange_items.archived_at` (new column, nullable, defaults NULL).
- **Index added:** `exchange_items_active_idx` partial — `(created_at DESC, id DESC) WHERE archived_at IS NULL`.
- **No data deletion.** The row stays; FK referrers (`exchange_item_saves.item_id`, `exchange_items.reserved_by`) stay valid.

## Edge Cases & Gotchas

- **Soft delete keeps referential integrity.** Saves and reservation history aren't cascaded. The listing is invisible to readers, but a future "your past reservations" page could still query archived rows directly. The API never exposes archived rows via the standard reads.
- **Idempotency at every layer.** A re-DELETE on an already-archived row returns 204 with the SQL no-op (archived_at stays at the original archive time). The middleware's idempotency-key replay is also active so a flaky-network retry sees the cached 204. Both layers point at the same end state.
- **Owner-only at two layers.** Page-level check (the edit page only renders the DeleteButton if `me.id === item.user_id`) + API-level 403. Defense in depth.
- **No "leak existence via 404 vs 403" foot-gun.** Same posture as edit: a non-owner hitting DELETE on a real id gets 403, not 404. We don't want to confirm whether an id exists in someone else's account.
- **Pre-read includes archived rows.** The DELETE handler reads without the `archived_at IS NULL` filter so it can recognise an already-archived row and treat it as a no-op rather than 404'ing. Reads from other endpoints DO filter, so archived rows stay invisible everywhere else.
- **Cache invalidation.** `revalidatePath("/")`, `revalidatePath("/saved")`, `revalidatePath("/items/[id]")` so every cached server-rendered view drops the listing on the next render. Without the explicit invalidation, users would see stale data until the per-page revalidate window expired.
- **Inline confirmation over browser `confirm()`.** Using the native dialog would break keyboard focus + screen-reader expectations + design-token consistency. The inline two-step is fully keyboard accessible (Tab between Confirm/Cancel) and uses our `danger` variant for the destructive action.
- **No "restore archived" UI.** Out of scope for this slice. The column + partial index design supports an admin-level "Restore listing" later by setting `archived_at = NULL`. Until then, deletion is one-way from the user's perspective.

## Environment Variables Required

None new.

## Changelog

| Date | Change |
|---|---|
| 2026-05-16 06:00 UTC | Initial documentation; live on `https://esharevice.com` |
