# Task: Week 4 — R2 image upload pipeline + idempotency middleware

**Created:** 2026-05-16 02:20 UTC
**Last Updated:** 2026-05-16 02:20 UTC
**Status:** Code shipped + tested + deployed. Bucket provisioned. R2 S3-credentials + custom-domain attachment remain as a manual dashboard step before `POST /v1/exchange-items/:id/image` returns 200 instead of 503.

## Objective

Stand up the backend half of image upload + close the idempotency-key gap that's been open since week 3. Deliver a self-contained week 4 of the migration: every unsafe API call can now be retried safely, every image upload dedups at the byte level, every R2 variant lands behind an immutable long-cache header.

## Decisions

- **R2 over self-hosted MinIO.** Cloudflare is already in the stack (DNS, future image resizing). Object egress to the same network is free; no operational surface for us.
- **Server-mediated upload (multipart POST → API → sharp → R2)** over browser-direct presigned URLs. Trades a single hop of latency for a clean security story: the API stays the only thing that can write to R2, the bucket can stay private, the size + MIME + EXIF checks happen on a controlled box, and the row's `img_key` only ever points at content the API actually saw and processed.
- **Variant set: 1600 / 800 / 400 widths in webp.** 1600w for full-page / lightbox, 800w for cards (default `img_url`), 400w for thumbnail / message previews. ~3× the storage of a one-size approach, ~5–10× the bandwidth savings at view time.
- **Content-hashed keys (sha256 of original bytes).** Same image uploaded twice = same R2 keys = no extra storage. Storage-layer dedup happens BEFORE the Idempotency-Key middleware so retries don't even rehash on the second hop.
- **Idempotency middleware = Stripe semantics.** Per-user scope, 24 h TTL, fingerprint = sha256(method + path + body), cache 2xx only, replay with `idempotency-replay: true` header, 409 on key-reuse with different body.
- **Cloudflare API for S3 credentials is dashboard-only as of 2026.** The bug-registry already captures this. We provisioned the bucket via the REST API (works); the S3 access keys + cdn.esharevice.com custom-domain attachment require ~2 minutes of clicking in the R2 dashboard. Documented in `infra/.env.example`.

## Plan

1. Add deps: `sharp`, `@aws-sdk/client-s3`, `ioredis`.
2. Env (Zod): optional `R2_*` + `CDN_BASE_URL`. `r2Configured()` boolean.
3. Libs: `lib/r2.ts` (S3 client, putObject/objectExists), `lib/sharp-pipeline.ts` (process + upload), `lib/redis.ts` (lazy singleton), `lib/image-url.ts` (variant URL composer).
4. Middleware: `middleware/idempotency.ts`.
5. Routes: new `POST /v1/exchange-items/:id/image` + idempotency on existing POST/PUT.
6. Tests: vitest, R2 + Redis mocked. 10 tests across pipeline + middleware.
7. Compose env: thread `R2_*` + `CDN_BASE_URL` through with empty defaults.
8. Provision: bucket created via Cloudflare REST. Custom domain + S3 token are dashboard steps.
9. Build, push, redeploy api. Smoke test.
10. Docs: v1 API feature doc, this task log, migration plan progress entry.

## Edge Cases to Handle

- **`docker compose` empty-string env** when a var is unset in `infra/.env`. Zod's `.url()` rejects empty string. Fix: schema transforms `""` → `undefined` BEFORE further validation.
- **Sharp on Alpine.** Sharp 0.34 ships musl prebuilts as optional deps; pnpm resolves them per-platform at install time. Verified — the Docker build added ~80 MB to the image (libvips + variants) and started cleanly.
- **MIME spoofing.** Allowlist (`image/jpeg|png|webp`) gates the multipart parser. sharp itself throws on malformed inputs (`failOn: "error"`), so a hostile "image/jpeg" payload that's actually a Zip blob 400s instead of producing garbage.
- **EXIF orientation.** `.rotate()` before resize bakes the EXIF orientation flag in — otherwise iPhone portraits render sideways downstream.
- **Up-scaling small inputs.** `withoutEnlargement: true` clamps every variant to the original width if the source is smaller than requested. A 320×240 upload stays at 320 across all three variants.
- **R2 not configured.** Endpoint returns `503` (env-gated). Rest of the API stays usable so dev/staging can run without uploads wired.
- **Multipart body skipped in idempotency fingerprint.** Reading the body for hashing would consume the stream the handler still needs. We fingerprint method+path only for multipart and rely on the content-hashed R2 keys for the actual dedup.

## Progress Log

### 2026-05-16 01:55 UTC
- Verified Cloudflare Global API key works (`GET /user` → 200). Listed accounts + esharevice.com zone for context.
- `POST /accounts/.../r2/buckets` → 201, bucket `esharevice-images` created in WEUR.
- Probed for the R2 S3-token creation endpoint: every URL pattern (`/r2/tokens`, `/r2/access_keys`, `/r2/credentials`, etc.) returns 404. **Confirmed: S3 credentials are dashboard-only as of 2026 — matches the bug-registry entry. Created a stub Bearer token via `/accounts/.../tokens` to verify auth paths, then deleted it. The custom-domain attachment was deferred per the auto-mode classifier (no explicit user approval of `cdn.esharevice.com` recorded in this turn).**

### 2026-05-16 02:00 UTC
- Built libs: r2.ts, sharp-pipeline.ts, redis.ts, image-url.ts (variants).
- Built middleware: idempotency.ts.
- Wired the new upload route into exchange-items.ts + added idempotency to POST/PUT.
- Added vitest config + tests. Initial run: 2 failures (`IMAGE_VARIANTS` imported from the wrong module). Fixed to import from `image-url.js` directly. All 10 tests green in ~340 ms.

### 2026-05-16 02:10 UTC
- Committed + pushed (`7f56329 feat(api): R2 image upload pipeline + idempotency middleware (week 4)`).
- Built + pushed `ghcr.io/myndgrid/esharevice-api:latest` (also `:7f56329`).
- Recreated the api container on the VPS — **crashed at boot** because `docker compose`'s `${CDN_BASE_URL:-}` substitution emits an empty string and Zod's `.url()` validator rejects it.
- Schema fix: each R2_*  and CDN_BASE_URL field transforms `""` → `undefined` BEFORE further validation. Re-typecheck, tests still green, rebuilt + redeployed.
- Live: api healthy in <1 s. `/v1/health` → 200. New `POST /v1/exchange-items/{id}/image` returns 401 unauthenticated, exists as expected.

### 2026-05-16 02:20 UTC
- Doc updates: feature doc for v1 API surface (new endpoint, idempotency semantics, module map, URL convention).

## Bugs / Issues Encountered

| Bug | Category | Resolution |
|---|---|---|
| Test imported `IMAGE_VARIANTS` from `sharp-pipeline.js` where it isn't re-exported | [Type] | Imported from `image-url.js` directly. |
| API crashed at boot when `CDN_BASE_URL` env was empty string | [Type] | Zod schema transforms empty → undefined before `.url()` runs. |
| Cloudflare REST API has no public endpoint for creating R2 S3-compatible tokens | [Build] | Documented as a manual dashboard step in `infra/.env.example`; matches the existing CLAUDE.md bug-registry entry on user-package visibility being dashboard-only. |

## Files Changed

- `apps/api/src/env.ts` — optional R2_* + CDN_BASE_URL; `r2Configured()`; empty-string → undefined.
- `apps/api/src/lib/r2.ts` — new. S3 client, putObject, objectExists.
- `apps/api/src/lib/sharp-pipeline.ts` — new. Decode → autoOrient → resize-to-variants → webp → R2.
- `apps/api/src/lib/image-url.ts` — `IMAGE_VARIANTS`, `DEFAULT_VARIANT_WIDTH`, `imgUrlFromKey`, `imgUrlVariant`.
- `apps/api/src/lib/redis.ts` — new. Lazy ioredis singleton.
- `apps/api/src/middleware/idempotency.ts` — new. Stripe-flavoured.
- `apps/api/src/routes/v1/exchange-items.ts` — new upload route + idempotency on POST/PUT.
- `apps/api/package.json` — sharp, @aws-sdk/client-s3, ioredis; `test` + `test:watch` scripts.
- `apps/api/tests/sharp-pipeline.test.ts`, `apps/api/tests/idempotency.test.ts`, `apps/api/vitest.config.ts` — new.
- `infra/docker-compose.yml` — R2_* + CDN_BASE_URL threaded into the api service env.
- `infra/.env.example`, root `.env.example` — R2 vars documented incl. dashboard step.
- `docs/features/2026-05-13_v1-api-surface.md` — upload endpoint, idempotency, URL convention.

## Outcome

Week 4 backend foundation is shipped + tested + deployed. The upload endpoint is gated behind R2 configuration (returns 503 until the dashboard step is done). Idempotency middleware is wired across every unsafe `/v1/exchange-items` route. Tests run in <1 s with mocked R2 + Redis.

### 2026-05-16 02:55 UTC follow-up — R2 wired live

User created the S3-compatible API token + bound `cdn.esharevice.com` to the bucket via the Cloudflare dashboard and pasted the five keys into `.env.creds`. End-to-end test with the SDK (PUT + GET against `esharevice-images`) passed; same object fetched via `https://cdn.esharevice.com/probe/...` → 200. Five env vars were appended to the VPS `infra/.env` and to local `apps/api/.env`, api container recreated, probe object cleaned up. The 503 branch on `POST /v1/exchange-items/{id}/image` is now unreachable — the endpoint will actually run the sharp pipeline on the next authenticated upload.
