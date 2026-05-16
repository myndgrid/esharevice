# Feature: Saved items (bookmarks)

**Created:** 2026-05-16 04:10 UTC
**Last Updated:** 2026-05-16 04:10 UTC
**Status:** Stable. Live at `https://esharevice.com/items/[id]` (bookmark button) + `https://esharevice.com/saved` (listing).

A signed-in user can bookmark exchange items they want to remember. Bookmarks are private (each user sees only their own). Save state is idempotent at every layer — double-clicks, network retries, and refresh actions never produce duplicates.

## Routes / API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/exchange-items/{id}/save` | Bearer | Returns `{ saved: boolean }`; 404 if the item doesn't exist |
| PUT | `/v1/exchange-items/{id}/save` | Bearer + Idempotency | Save the item; idempotent via `INSERT … ON CONFLICT DO NOTHING` |
| DELETE | `/v1/exchange-items/{id}/save` | Bearer + Idempotency | Unsave; returns `{ saved: false }` whether the row existed or not |
| GET | `/v1/saves` | Bearer | Cursor-paginated list of items the viewer has saved, most-recent first |
| (server action) | `toggleSaveAction(itemId, currentlySaved)` | session | Web side; picks PUT or DELETE based on the click's intent; per-invocation `randomUUID` idempotency key |

## Modules / Classes Involved

| File | Role |
|---|---|
| [packages/db/src/schema.ts](../../packages/db/src/schema.ts) | `exchange_item_saves` table — composite PK on `(user_id, item_id)`, both FKs cascade |
| [packages/db/drizzle/0001_0001_exchange_item_saves.sql](../../packages/db/drizzle/0001_0001_exchange_item_saves.sql) | Migration applied to local + prod on 2026-05-16 |
| [packages/shared/src/schemas/saved.ts](../../packages/shared/src/schemas/saved.ts) | `SaveState` Zod schema |
| [apps/api/src/routes/v1/saves.ts](../../apps/api/src/routes/v1/saves.ts) | The four API routes; `idempotency()` middleware on the writes |
| [apps/web/lib/api.ts](../../apps/web/lib/api.ts) | `isItemSaved` / `saveItem` / `unsaveItem` / `listSavedItems` |
| [apps/web/app/items/[id]/save-action.ts](../../apps/web/app/items/[id]/save-action.ts) | Server action that toggles based on the click's `currentlySaved` flag |
| [apps/web/app/items/[id]/save-button.tsx](../../apps/web/app/items/[id]/save-button.tsx) | Client component with optimistic UI via `useState` + `useTransition` |
| [apps/web/app/items/[id]/page.tsx](../../apps/web/app/items/[id]/page.tsx) | Fetches `api.isItemSaved` alongside the item + `/v1/me`, passes initial state to `<SaveButton>` |
| [apps/web/app/saved/page.tsx](../../apps/web/app/saved/page.tsx) | Saved listing — was a stub, now populated from `api.listSavedItems({ limit: 50 })` |

## Persistence (tables touched)

- **New:** `exchange_item_saves(user_id uuid, item_id uuid, created_at timestamptz)`
  - Composite primary key on `(user_id, item_id)` — doubles as the existence-lookup index and prevents double-saves at the SQL layer.
  - Listing index `(user_id, created_at DESC)` supports the `/v1/saves` query without an extra sort step.
  - Both FKs `ON DELETE CASCADE` so user deletion / item deletion cleans up associated rows.

## Edge Cases & Gotchas

- **Idempotent at every layer.** SQL: `INSERT … ON CONFLICT DO NOTHING` for save, `DELETE WHERE …` for unsave (matching zero rows is success). API: idempotency middleware caches 2xx for 24 h. Web: server action generates a fresh `randomUUID` per invocation so retried clicks don't lock the user to a stale cached response. End result: a flaky network + furious double-tap never produces a duplicate row, a 409, or a mismatched UI.
- **Optimistic UI rollback.** The button flips visually on click via `useState`; if the server action returns `{ ok: false }` we revert. The "currently saved" intent is captured at click time (not re-read from the server), so the click's intent survives a race against a concurrent unsave from another tab.
- **404 on save attempt for a missing item.** The PUT handler does an existence check before the INSERT so we can return a clear 404 instead of a FK violation error from the DB. Matches the pattern from the reserve handler.
- **Saved page revalidation.** `toggleSaveAction` calls `revalidatePath("/saved")` so a save from the detail page invalidates the listing — the next visit shows the new bookmark without a cache TTL wait. Same for `revalidatePath("/items/[id]")` so the button reflects the saved state on the same page.
- **Cursor pagination on the listing.** Tuple comparison on `(save.created_at, item.id)` — the cursor encodes a `(ts, id)` opaque to clients, mirroring the existing `/v1/exchange-items` pattern so client pagination code is shared.
- **Bookmark button shown only to authenticated viewers.** Anonymous viewers see no button (consistent with reserve). They'd click "Sign in to reserve" first.

## Environment Variables Required

None new.

## Changelog

| Date | Change |
|---|---|
| 2026-05-16 04:10 UTC | Initial documentation; live on `https://esharevice.com` |
