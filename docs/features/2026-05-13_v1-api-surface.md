# Feature: /v1 API surface

**Created:** 2026-05-13 00:30 UTC
**Last Updated:** 2026-05-13 01:00 UTC
**Status:** Stable (foundational routes shipped — feature routes accrete on top)

The first slice of the public API. Auth, error shape, pagination, and FTS are all decided here; later feature routes inherit these primitives.

---

## Overview

`apps/api` is a Hono 4 + TypeScript service mounted under `https://api.esharevice.com`. Every public route lives under `/v1/` and is defined with `@hono/zod-openapi`'s `createRoute()` so it's typed at compile-time AND auto-documented at runtime (`/v1/openapi.json` + `/v1/docs`).

The API is intentionally a **product**, not an internal implementation detail. Three client surfaces consume it: the Next.js web app, future mobile native apps, and third-party integrators. That's why `/v1` versioning, OpenAPI generation, cursor pagination, and RFC 7807 errors are all in place from day one.

---

## Routes / API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | — | Unversioned health, for load balancers |
| GET | `/v1/health` | — | Same endpoint, also exposed under `/v1` |
| GET | `/v1/openapi.json` | — | OpenAPI 3.0 spec — the source of truth for the API contract |
| GET | `/v1/docs` | — | Swagger UI, served from the spec above |
| GET | `/v1/me` | Bearer | Authenticated user's `UserPublic` row |
| GET | `/v1/exchange-items` | optional | List of items, cursor-paginated; `?q=` runs Postgres FTS |
| GET | `/v1/exchange-items/{id}` | optional | Single item by UUID; 404 if missing |
| POST | `/v1/exchange-items` | Bearer | Create an item owned by the authenticated user |
| PUT | `/v1/exchange-items/{id}/reserve` | Bearer | Reserve an item; 409 on own-item or already-reserved-by-another |

`optional` auth means the route works without a token, but if a valid token is present the user is attached to the request context (useful for personalised responses later — e.g. hiding the user's own items from the list).

---

## Modules / Classes Involved

| Layer | File | Role |
|---|---|---|
| Entry | `apps/api/src/index.ts` | `OpenAPIHono<AppEnv>` instance, global middleware, route mounting, `serve()` |
| Context type | `apps/api/src/app.ts` | `AppEnv = { Variables: { user, auth } }` — generic across the workspace |
| Env validation | `apps/api/src/env.ts` | Zod-checked process env; fails at boot if `OIDC_*` are missing |
| Auth | `apps/api/src/middleware/auth.ts` | `requireAuth` (hard) + `attachAuth` (soft) — jose JWKS verifier |
| Errors | `apps/api/src/middleware/error.ts` | `onError` + `notFound` produce `application/problem+json` |
| User lookup | `apps/api/src/lib/users.ts` | `resolveUserFromSub` — lazy provisioning with onConflictDoUpdate race-handling |
| Cursor | `apps/api/src/lib/cursor.ts` | Base64-encoded `(ts, id)` tuple — opaque to clients |
| Image URL | `apps/api/src/lib/image-url.ts` | R2 key → public CDN URL (stub until week 4) |
| Routes | `apps/api/src/routes/v1/me.ts`, `apps/api/src/routes/v1/exchange-items.ts` | Per-route handlers, defined with `createRoute()` |
| Schemas | `packages/shared/src/schemas/*.ts` | `UserPublic`, `ExchangeItem`, `ExchangeItemCreate`, `CursorQuery`, `cursorPage`, `Problem` |
| DB | `packages/db/src/schema.ts` | `users`, `exchangeItems` Drizzle tables |

---

## Frontend Views / Functions Involved

Not yet — the Next.js `apps/web` currently renders only a stub home page. Real consumers of `/v1` land in weeks 5-7. Until then, the API is exercised via `curl`, Postman, and the Swagger UI.

---

## Persistence (files or tables touched)

| Table | Columns the API reads/writes |
|---|---|
| `users` | `id`, `oidc_sub`, `email`, `first_name`, `last_name`, `created_at`, `updated_at`. The API NEVER touches `password*` columns — there are none. |
| `exchange_items` | All columns. Reads use the `search` tsvector when `?q=` is provided (GIN-indexed). Reservations atomically set `reserved`, `reserved_by`, `reserved_at`, `updated_at`. |

Both tables are in the production Postgres database `esharevice` on the VPS. Migrations come from `packages/db/drizzle/`.

---

## Design decisions

### Why Hono, not Express

Attempted Express in weeks 1-2 — the combination of `@types/express` + pnpm-isolated-linking + TS `Bundler` resolution produces broken type inference that no combination of `typeRoots` / hoisting / overrides / `NodeNext` fixes. A 4-line minimal repro of `res.status(404)` fails to typecheck.

Hono's types are self-contained — no `///<reference>` directives leaking into consumer code. Workspace typechecked clean on the first attempt. Full `[Build]` entry in the bug registry.

### Why versioned at `/v1` from day one

The API has three client surfaces (web, mobile native, third-party). Once mobile or partner integrations are live, retrofitting versioning is extremely expensive. Versioning costs almost nothing now.

### Why RFC 7807 problem+json

A single, well-known error shape across every route. Clients deserialize `application/problem+json` into a typed `Problem` object and switch on `status` + `type` rather than parsing custom error envelopes. `Problem` is a shared Zod schema in `packages/shared/src/schemas/problem.ts` — same shape on both sides of the wire.

### Why cursor pagination, not offset

Offset pagination breaks under mobile infinite scroll: when items are added or removed between requests, the user sees duplicates or skipped items. Cursor encodes `(created_at, id)` of the last-returned item; subsequent pages use a tuple comparison `(created_at, id) < (cursor.ts, cursor.id::uuid)` ordered by `DESC, DESC`. Stable under concurrent writes.

The cursor is opaque (base64-encoded JSON) so the schema can evolve later without breaking client URLs.

### Why Postgres FTS over Meilisearch

A separate search service adds operational surface area (deployment, monitoring, indexing pipeline, sync drift). Postgres FTS is in the database we already have. `tsvector` GENERATED ALWAYS STORED + GIN index keeps the index always-in-sync with row writes. `websearch_to_tsquery` handles user-typed queries safely — phrase search, `OR`, `-`, all parsed without injection risk.

When FTS hits a wall (multi-language, fuzzy match, relevance tuning), Meilisearch is the migration target. Until then: one less service.

### Why lazy user provisioning, not signup endpoint

There IS no signup endpoint in the API. Authentik handles all account creation (its built-in password provider OR a social OAuth provider). On the API side, the first time we see a valid JWT for a previously-unknown `sub`, we INSERT a `users` row using the token's email + name claims. `onConflictDoUpdate` on `oidc_sub` makes this race-safe — two concurrent requests for the same new user both succeed.

This means `apps/api` has zero password code, zero email-verification code, zero forgot-password endpoints. All of that is Authentik's job.

### Why OIDC-standard claims only

The JWT contains `sub`, `iss`, `aud`, `exp`, `iat`, `email`, `email_verified` — and nothing else app-specific. If we ever swap Authentik for a different OIDC provider (Keycloak, Zitadel, Auth0), the API's verification doesn't change. App data like roles or permissions is fetched by `sub` from the DB on each request.

---

## Edge Cases & Gotchas

- **JWT clock skew.** jose's `jwtVerify` has a default 0-second tolerance for `exp` / `iat`. If we ever see "token used before issued" errors, increase via `clockTolerance` in `verifyOptions`. Not seen yet.
- **JWKS cache miss.** First request after `apps/api` boot makes a synchronous HTTP call to `OIDC_JWKS_URL`. Latency spike of ~100-300 ms on the cold path. Subsequent requests are cached in-memory by jose.
- **`onConflictDoUpdate` for race-safe user provisioning** can return zero rows when the row exists and the update is a no-op. The code re-reads in that case — see `apps/api/src/lib/users.ts`.
- **Reservation race.** Two simultaneous reserve requests for the same item by different users currently both succeed — the second one overwrites the first. Acceptable for v1; week 4 wraps the update in a `WHERE reserved = false` predicate + transaction.
- **Cursor versioning.** Cursors include no version marker. If the cursor shape changes in v2, we'll need a `v` field. For now, decoders treat malformed cursors as `null` (start from beginning).
- **CORS allowlist.** Reads from `WEB_ORIGIN` (comma-separated). Native mobile and third-party clients don't need CORS — they authenticate by token, no Origin header.
- **Rate limiting** is global per-IP (300 req/min). Per-route limits land alongside the upload endpoint in week 4 (image uploads need a much tighter limit).

---

## Environment Variables Required

The api fails at boot if any of these are missing or malformed (Zod-parsed):

```
NODE_ENV=development|test|production
API_PORT=8080
API_PUBLIC_URL=https://api.esharevice.com
WEB_ORIGIN=https://esharevice.com        # comma-separated for multiple
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
OIDC_ISSUER=https://auth.esharevice.com/application/o/e-sharevice-web/
OIDC_AUDIENCE=e-sharevice-web
OIDC_JWKS_URL=https://auth.esharevice.com/application/o/e-sharevice-web/jwks/
```

The OIDC values come from the Authentik admin UI after the blueprint applies; default values live in `infra/.env` on the production VPS.

---

## How to extend (adding a new /v1 route)

```ts
// apps/api/src/routes/v1/example.ts
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { requireAuth } from "../../middleware/auth.js";
import type { AppEnv } from "../../app.js";

const route = new OpenAPIHono<AppEnv>();

const Body = z.object({ name: z.string().min(1) }).openapi("ExampleBody");
const Response = z.object({ ok: z.boolean() }).openapi("ExampleResponse");

route.openapi(
  createRoute({
    method: "post",
    path: "/example",
    tags: ["example"],
    summary: "Create something.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth] as const,
    request: { body: { content: { "application/json": { schema: Body } } } },
    responses: {
      200: { description: "OK", content: { "application/json": { schema: Response } } },
    },
  }),
  async (c) => {
    const body = c.req.valid("json");     // typed by Zod
    const user = c.get("user");           // attached by requireAuth
    // ... do work
    return c.json({ ok: true }, 200);
  },
);

export default route;
```

Then mount it in `apps/api/src/index.ts`:

```ts
import example from "./routes/v1/example.js";
app.route("/v1", example);
```

OpenAPI spec + Swagger UI update automatically — no separate doc step.

---

## Changelog

| Date | Change |
|---|---|
| 2026-05-13 00:30 UTC | Initial /v1 surface shipped (Hono swap): health, me, exchange-items CRUD + reserve, OpenAPI + Swagger UI |
| 2026-05-12 19:50 UTC | Drizzle migration 0001 applied to live Postgres — `users` + `exchange_items` + FTS GIN index |
