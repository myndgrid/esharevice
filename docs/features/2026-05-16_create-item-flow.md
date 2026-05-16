# Feature: Create-item + item-detail web flow

**Created:** 2026-05-16 03:30 UTC
**Last Updated:** 2026-05-16 03:30 UTC
**Status:** Stable. The flow is live at https://esharevice.com/items/new + https://esharevice.com/items/[id]. It's the first slice that exercises the week-4 R2 upload pipeline + idempotency middleware end-to-end through a real browser.

## Overview

A logged-in user can post a new exchange item with a photo. The web app drives two API calls from a single submit:

1. `POST /v1/exchange-items` — creates the row with the structured fields.
2. `POST /v1/exchange-items/{id}/image` — uploads the photo as multipart; the server resizes it to three .webp variants on R2 and stores `img_key` on the row.

Both calls share a client-generated `Idempotency-Key` (the image upload's key is suffixed `-image`). A double-submit or network retry replays the cached response from Redis instead of recreating the row or re-running the sharp pipeline.

If the image upload fails after the row was successfully created, the row stays. The user is redirected to the detail page with an `?image_error=<reason>` banner so the partial state is visible and recoverable — a future "edit listing" flow can attach the photo later.

## Routes / API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/items/new` | Server component; `requireAuth("/items/new")` 307s to `/api/auth/login` if absent |
| GET | `/items/[id]` | Server component; 404 on missing item; 200 with the 1600w variant embedded |
| (server action) | `createItemAction` | Validates with `ExchangeItemCreate` (shared Zod); orchestrates the two API calls; redirects on success; returns `{ ok: false, fieldErrors, formError }` on failure |

## Modules / Classes Involved

| Layer | File | Role |
|---|---|---|
| Page (form) | `apps/web/app/items/new/page.tsx` | Server component, auth gate, renders the form card |
| Client form | `apps/web/app/items/new/create-item-form.tsx` | `useActionState`-driven form, generates the per-mount `idempotency_key`, client-side type + size guards on the image picker |
| Server action | `apps/web/app/items/new/actions.ts` | Zod validation → API create → API image upload → redirect; image-failure path keeps the row + flashes a banner |
| Page (detail) | `apps/web/app/items/[id]/page.tsx` | Server component, fetches `/v1/exchange-items/{id}`, renders the 1600w variant, surfaces the `?image_error` flash |
| API client | `apps/web/lib/api.ts` | `createExchangeItem`, `uploadExchangeItemImage`, `reserveExchangeItem` — each accepts an optional `idempotencyKey` that's forwarded as the `Idempotency-Key` header |
| Home page card | `apps/web/app/page.tsx` | Cards now link to `/items/[id]` and show the 800w variant inline |
| Header | `apps/web/components/header.tsx` | "+ New" button appears next to the avatar when authenticated |

## Frontend Views / Functions Involved

- The `<CreateItemForm>` is a client component using `useActionState` (Next 15 idiom) so the server action gets its own pending + error state without per-form plumbing.
- Image preview uses `URL.createObjectURL()` and revokes the URL on load to avoid the blob hanging in memory.
- Form fields use plain `<input>` / `<textarea>` styled by Tailwind utilities consuming the design tokens — no headless library yet (Radix lands as we add Dialog / Tabs).

## Persistence (files or tables touched)

- `exchange_items` row inserted with the 6 structured fields (provider/service/date/exchange/description/rate_type).
- After image upload: same row's `img_key` + `img_hash` set to the sha256 of the original upload, `updated_at` bumped.
- R2 bucket `esharevice-images` gains three keys per fresh image: `<hash>/1600.webp`, `<hash>/800.webp`, `<hash>/400.webp`.

## URL convention for variants

`item.img_url` from the API points at the **800w** variant — that's what the home-page cards show. The detail page string-replaces `/800.webp` → `/1600.webp` to get the full-resolution variant. The pattern is fixed (`<base>/<hash>/<width>.webp`) and documented in [docs/features/2026-05-13_v1-api-surface.md](2026-05-13_v1-api-surface.md). A future schema change may expose explicit variant URLs as an object, but the convention works for now without a breaking API change.

## Edge Cases & Gotchas

- **Idempotency key per form mount, not per submit.** A user clicking "Post item" twice in a second reuses the same key — both clicks hit the API, the second one gets the cached response with `idempotency-replay: true`. A fresh navigation to `/items/new` generates a new UUID, so an honest second-listing-of-something is treated as a new operation.
- **Image-failure recovery.** The server action redirects to the detail page with `?image_error=<reason>` on upload failure. The row is preserved so the user can re-attempt the upload from an edit flow (not yet built). This avoids the "lost work" anti-pattern of rolling back the row on a transient R2 issue.
- **EXIF orientation.** Server-side sharp pipeline calls `.rotate()` before resize so iPhone portraits render upright in all three variants.
- **Up-scaling.** sharp's `withoutEnlargement: true` clamps small inputs to their original width — a 320×240 upload stays at 320 across all variants instead of producing pixelated blow-ups.
- **MIME spoofing.** Both client (picker validation) and server (multipart allowlist + sharp's `failOn: "error"`) reject anything outside `image/jpeg|png|webp`.
- **<Link> prefetching.** The "+ New" link in the header is a normal `<Link>` (idempotent GET → no Set-Cookie side-effects → prefetch is safe). The Sign-in link still has `prefetch={false}` from the week-5 logout-prefetch fix.

## Environment Variables Required

No new env vars beyond what week 4 added:
- API side: `R2_*`, `CDN_BASE_URL` (wired live 2026-05-16).
- Web side: `NEXT_PUBLIC_API_URL`, plus the existing OIDC + session-cookie secrets.

## Changelog

| Date | Change |
|---|---|
| 2026-05-16 03:30 UTC | Initial documentation; flow live on https://esharevice.com |
