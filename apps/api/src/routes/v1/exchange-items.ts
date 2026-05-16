import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, exchangeItems, users, type ExchangeItemRow } from "@esharevice/db";
import {
  CursorQuery,
  ExchangeItem,
  ExchangeItemCreate,
  ExchangeItemUpdate,
  cursorPage,
} from "@esharevice/shared";
import { attachAuth, requireAuth } from "../../middleware/auth.js";
import { idempotency } from "../../middleware/idempotency.js";
import { decodeCursor, encodeCursor } from "../../lib/cursor.js";
import { imgUrlFromKey } from "../../lib/image-url.js";
import { env, r2Configured } from "../../env.js";
import { ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES, processAndUpload } from "../../lib/sharp-pipeline.js";
import { sendReservedEmail } from "../../lib/email.js";
import type { AppEnv } from "../../app.js";

const route = new OpenAPIHono<AppEnv>();

const ProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number(),
    detail: z.string().optional(),
    instance: z.string().optional(),
  })
  .openapi("Problem");

const ItemSchema = ExchangeItem.openapi("ExchangeItem");
const ItemCreateSchema = ExchangeItemCreate.openapi("ExchangeItemCreate");
const ItemUpdateSchema = ExchangeItemUpdate.openapi("ExchangeItemUpdate");
const ListQuerySchema = CursorQuery.extend({
  q: z
    .string()
    .optional()
    .openapi({ description: "Full-text search across provider, service, description" }),
}).openapi("ExchangeItemListQuery");
const ListResponseSchema = cursorPage(ExchangeItem).openapi("ExchangeItemPage");
const IdParamSchema = z.object({ id: z.string().uuid() }).openapi("IdParam");

const problemContent = { "application/problem+json": { schema: ProblemSchema } };

function toApiItem(row: ExchangeItemRow): z.infer<typeof ItemSchema> {
  return ExchangeItem.parse({
    id: row.id,
    user_id: row.user_id,
    provider: row.provider,
    service: row.service,
    date: row.date,
    exchange: row.exchange,
    description: row.description,
    rate_type: row.rate_type ?? null,
    img_url: imgUrlFromKey(row.img_key),
    img_hash: row.img_hash ?? null,
    reserved: row.reserved,
    reserved_by: row.reserved_by ?? null,
    reserved_at: row.reserved_at ? row.reserved_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  });
}

// ─────────────────────── GET /v1/exchange-items
route.openapi(
  createRoute({
    method: "get",
    path: "/exchange-items",
    tags: ["exchange-items"],
    summary: "List exchange items (cursor-paginated, FTS-searchable).",
    middleware: [attachAuth] as const,
    request: { query: ListQuerySchema },
    responses: {
      200: { description: "OK", content: { "application/json": { schema: ListResponseSchema } } },
    },
  }),
  async (c) => {
    const { cursor: cursorRaw, limit, q } = c.req.valid("query");
    const cursor = decodeCursor(cursorRaw);
    const db = getDb();

    // Soft-delete filter — every read of exchange_items excludes archived
    // rows. The 0002 migration's partial index covers the (created_at desc,
    // id desc) tuple ONLY for active rows, so this WHERE clause is fast.
    const conditions = [isNull(exchangeItems.archived_at)];
    if (cursor) {
      // Tuple comparison: (created_at, id) < (cursor.ts, cursor.id). Postgres native.
      conditions.push(
        sql`(${exchangeItems.created_at}, ${exchangeItems.id}) < (${new Date(cursor.ts)}, ${cursor.id}::uuid)`,
      );
    }
    if (q && q.trim()) {
      conditions.push(sql`${exchangeItems.search} @@ websearch_to_tsquery('english', ${q.trim()})`);
    }

    const rows = await db
      .select()
      .from(exchangeItems)
      .where(and(...conditions))
      .orderBy(desc(exchangeItems.created_at), desc(exchangeItems.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const next_cursor =
      hasMore && last ? encodeCursor({ ts: last.created_at.toISOString(), id: last.id }) : null;

    return c.json({ items: page.map(toApiItem), next_cursor }, 200);
  },
);

// ─────────────────────── GET /v1/exchange-items/:id
route.openapi(
  createRoute({
    method: "get",
    path: "/exchange-items/{id}",
    tags: ["exchange-items"],
    summary: "Fetch a single exchange item.",
    middleware: [attachAuth] as const,
    request: { params: IdParamSchema },
    responses: {
      200: { description: "OK", content: { "application/json": { schema: ItemSchema } } },
      404: { description: "Not Found", content: problemContent },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const db = getDb();
    const rows = await db
      .select()
      .from(exchangeItems)
      .where(and(eq(exchangeItems.id, id), isNull(exchangeItems.archived_at)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new HTTPException(404, { message: "Not Found" });
    return c.json(toApiItem(row), 200);
  },
);

// ─────────────────────── POST /v1/exchange-items
route.openapi(
  createRoute({
    method: "post",
    path: "/exchange-items",
    tags: ["exchange-items"],
    summary: "Create an exchange item owned by the authenticated user.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth, idempotency()] as const,
    request: {
      body: { content: { "application/json": { schema: ItemCreateSchema } } },
    },
    responses: {
      201: { description: "Created", content: { "application/json": { schema: ItemSchema } } },
      400: { description: "Validation failed", content: problemContent },
      401: { description: "Unauthenticated", content: problemContent },
    },
  }),
  async (c) => {
    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });
    const body = c.req.valid("json");
    const db = getDb();
    const inserted = await db
      .insert(exchangeItems)
      .values({
        user_id: u.id,
        provider: body.provider,
        service: body.service,
        date: body.date,
        exchange: body.exchange,
        description: body.description,
        rate_type: body.rate_type ?? null,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new HTTPException(500, { message: "insert returned no rows" });
    return c.json(toApiItem(row), 201);
  },
);

// ─────────────────────── PUT /v1/exchange-items/:id
//
// Edit an existing exchange item. Owner-only. Body is the partial
// ExchangeItemUpdate schema — every field optional. Only the keys
// actually present in the request are written. Returns 200 with the
// full updated row.
route.openapi(
  createRoute({
    method: "put",
    path: "/exchange-items/{id}",
    tags: ["exchange-items"],
    summary: "Edit an exchange item the authenticated user owns.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth, idempotency()] as const,
    request: {
      params: IdParamSchema,
      body: { content: { "application/json": { schema: ItemUpdateSchema } } },
    },
    responses: {
      200: { description: "Updated", content: { "application/json": { schema: ItemSchema } } },
      400: { description: "Validation failed", content: problemContent },
      401: { description: "Unauthenticated", content: problemContent },
      403: { description: "Not the item owner", content: problemContent },
      404: { description: "Item not found", content: problemContent },
    },
  }),
  async (c) => {
    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const db = getDb();
    const existing = await db
      .select()
      .from(exchangeItems)
      .where(and(eq(exchangeItems.id, id), isNull(exchangeItems.archived_at)))
      .limit(1);
    const row = existing[0];
    if (!row) throw new HTTPException(404, { message: "Not Found" });
    if (row.user_id !== u.id) {
      throw new HTTPException(403, { message: "Only the item owner can edit this listing" });
    }

    // Build a sparse update — only write keys that are actually present.
    // Drizzle ignores keys with undefined values in its `set` builder, but
    // being explicit keeps the SQL minimal and avoids accidentally clearing
    // fields a client didn't intend to touch.
    const patch: Partial<typeof exchangeItems.$inferInsert> = { updated_at: new Date() };
    if (body.provider !== undefined) patch.provider = body.provider;
    if (body.service !== undefined) patch.service = body.service;
    if (body.date !== undefined) patch.date = body.date;
    if (body.exchange !== undefined) patch.exchange = body.exchange;
    if (body.description !== undefined) patch.description = body.description;
    if (body.rate_type !== undefined) patch.rate_type = body.rate_type;

    const updated = await db
      .update(exchangeItems)
      .set(patch)
      .where(eq(exchangeItems.id, id))
      .returning();
    const u2 = updated[0];
    if (!u2) throw new HTTPException(500, { message: "update returned no rows" });
    return c.json(toApiItem(u2), 200);
  },
);

// ─────────────────────── PUT /v1/exchange-items/:id/reserve
route.openapi(
  createRoute({
    method: "put",
    path: "/exchange-items/{id}/reserve",
    tags: ["exchange-items"],
    summary: "Reserve an exchange item for the authenticated user.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth, idempotency()] as const,
    request: { params: IdParamSchema },
    responses: {
      200: { description: "Reserved", content: { "application/json": { schema: ItemSchema } } },
      401: { description: "Unauthenticated", content: problemContent },
      404: { description: "Not Found", content: problemContent },
      409: { description: "Cannot reserve", content: problemContent },
    },
  }),
  async (c) => {
    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });
    const { id } = c.req.valid("param");
    const db = getDb();
    const existing = await db
      .select()
      .from(exchangeItems)
      .where(and(eq(exchangeItems.id, id), isNull(exchangeItems.archived_at)))
      .limit(1);
    const row = existing[0];
    if (!row) throw new HTTPException(404, { message: "Not Found" });
    if (row.user_id === u.id) {
      throw new HTTPException(409, { message: "Cannot reserve your own item" });
    }
    if (row.reserved && row.reserved_by !== u.id) {
      throw new HTTPException(409, { message: "Already reserved" });
    }

    // Race-safe reservation: the UPDATE is gated on `reserved = false`, so two
    // simultaneous reserve calls for the same item from different users can
    // never both succeed — the second one returns zero rows and falls through
    // to a 409. The pre-read above is still useful for the "Cannot reserve
    // your own item" branch where the right answer is a 409, not "lost race".
    const updated = await db
      .update(exchangeItems)
      .set({
        reserved: true,
        reserved_by: u.id,
        reserved_at: new Date(),
        updated_at: new Date(),
      })
      .where(
        and(
          eq(exchangeItems.id, id),
          eq(exchangeItems.reserved, false),
          isNull(exchangeItems.archived_at),
        ),
      )
      .returning();
    const u2 = updated[0];
    if (!u2) {
      // Someone else won the race in the gap between our read and write.
      throw new HTTPException(409, { message: "Already reserved" });
    }

    // Fire-and-forget the owner notification. We deliberately don't await
    // so a slow Resend round-trip can't delay the user's response. Errors
    // are swallowed inside sendReservedEmail (logged + Sentry-captured)
    // because a reservation that succeeded at the SQL layer must be
    // observed as a 200 by the reserver regardless of email-side state.
    void (async () => {
      try {
        const ownerRows = await db
          .select({
            email: users.email,
            first_name: users.first_name,
            last_name: users.last_name,
          })
          .from(users)
          .where(eq(users.id, row.user_id))
          .limit(1);
        const owner = ownerRows[0];
        if (!owner) return;
        const reserverName =
          `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || "Someone";
        const ownerName =
          `${owner.first_name ?? ""} ${owner.last_name ?? ""}`.trim() || "there";
        const base = env.WEB_PUBLIC_URL ?? env.OIDC_ISSUER.replace(/\/application\/o\/[^/]+\/?$/, "");
        await sendReservedEmail({
          to: owner.email,
          ownerName,
          reserverName,
          itemService: row.service,
          itemUrl: `${base.replace(/\/$/, "")}/items/${row.id}`,
        });
      } catch (err) {
        // sendReservedEmail already swallows, but defensive belt-and-suspenders
        // for the email-side helper code itself.
         
        console.warn("[reserve] notification setup failed:", err);
      }
    })();

    return c.json(toApiItem(u2), 200);
  },
);

// ─────────────────────── POST /v1/exchange-items/:id/image
//
// Multipart upload of a single image. sharp resizes to three .webp variants
// (1600/800/400), each uploaded to R2 keyed by sha256(original-bytes)/<width>.webp.
// The row's img_key + img_hash are updated to point at the new content.
//
// Defensive choices:
// - Length cap is enforced BEFORE the body is buffered (Content-Length header)
//   AND again after (buffer.byteLength) — header is advisory, only the post-read
//   check is authoritative.
// - MIME allowlist (jpeg/png/webp) rejected at the multipart-parse layer.
// - Idempotency is provided by the content-hashed keys naturally; the
//   Idempotency-Key middleware is layered on top so a retried request
//   replays the cached row instead of re-running sharp.
// - 503 if R2 isn't configured (env-gated) so the rest of the API stays usable
//   during the bootstrap window before the dashboard step is done.
const ImageUploadResponseSchema = ItemSchema.openapi("ExchangeItemAfterUpload");
route.openapi(
  createRoute({
    method: "post",
    path: "/exchange-items/{id}/image",
    tags: ["exchange-items"],
    summary: "Upload + process an image for an exchange item.",
    description:
      "Multipart/form-data with a single `image` field. Server resizes to " +
      "1600w / 800w / 400w .webp variants on Cloudflare R2; the row's `img_url` " +
      "points at the 800w variant by default. Clients may swap `/800.webp` → " +
      "`/1600.webp` (or `/400.webp`) to opt into other widths — the pattern is stable.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth, idempotency()] as const,
    // No `request.body` schema — declaring it makes @hono/zod-openapi run its
    // built-in validator against the body, which CONSUMES the multipart stream
    // (the request body is a one-shot ReadableStream in Node/undici). The
    // handler then can't re-read it and 400s with "Body has already been read".
    // The OpenAPI spec still describes the body via the `description` field.
    request: { params: IdParamSchema },
    responses: {
      200: { description: "Uploaded", content: { "application/json": { schema: ImageUploadResponseSchema } } },
      400: { description: "Invalid upload", content: problemContent },
      401: { description: "Unauthenticated", content: problemContent },
      403: { description: "Not the item owner", content: problemContent },
      404: { description: "Not Found", content: problemContent },
      413: { description: "Upload too large", content: problemContent },
      415: { description: "Unsupported media type", content: problemContent },
      503: { description: "Storage not configured", content: problemContent },
    },
  }),
  async (c) => {
    if (!r2Configured()) {
      throw new HTTPException(503, { message: "Image storage is not configured yet" });
    }

    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });
    const { id } = c.req.valid("param");

    // Cheap pre-check: refuse before buffering anything if the header lies small.
    const advertised = Number(c.req.header("content-length"));
    if (Number.isFinite(advertised) && advertised > MAX_UPLOAD_BYTES) {
      throw new HTTPException(413, { message: "Upload exceeds 10 MB limit" });
    }

    const db = getDb();
    const rows = await db
      .select()
      .from(exchangeItems)
      .where(and(eq(exchangeItems.id, id), isNull(exchangeItems.archived_at)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new HTTPException(404, { message: "Not Found" });
    if (row.user_id !== u.id) {
      throw new HTTPException(403, { message: "Only the item owner can upload an image" });
    }

    // Hono's purpose-built multipart parser. Reads the body once, caches the
    // parsed parts on the context so middleware ordering is no longer fragile.
    let body: Record<string, string | File>;
    try {
      body = (await c.req.parseBody()) as Record<string, string | File>;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const ct = c.req.header("content-type") ?? "(none)";
      throw new HTTPException(400, {
        message: `Invalid multipart body: ${detail} [content-type=${ct}]`,
      });
    }

    const file = body.image;
    if (!(file instanceof File)) {
      throw new HTTPException(400, { message: "Missing `image` field" });
    }
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      throw new HTTPException(415, {
        message: `Unsupported media type ${file.type || "(none)"} — allowed: ${[...ALLOWED_MIME_TYPES].join(", ")}`,
      });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.byteLength > MAX_UPLOAD_BYTES) {
      throw new HTTPException(413, { message: "Upload exceeds 10 MB limit" });
    }
    if (buf.byteLength === 0) {
      throw new HTTPException(400, { message: "Empty upload" });
    }

    let processed;
    try {
      processed = await processAndUpload(buf);
    } catch (err) {
      // sharp throws on malformed input even if the MIME claimed something valid.
      throw new HTTPException(400, {
        message: `Could not process image: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    const updated = await db
      .update(exchangeItems)
      .set({
        img_key: processed.hash,
        img_hash: processed.hash,
        updated_at: new Date(),
      })
      .where(eq(exchangeItems.id, id))
      .returning();
    const u2 = updated[0];
    if (!u2) throw new HTTPException(500, { message: "update returned no rows" });
    return c.json(toApiItem(u2), 200);
  },
);

// ─────────────────────── DELETE /v1/exchange-items/:id
//
// Soft delete — sets `archived_at = now()`. The row stays in the table to
// preserve FK references (saves, reserved_by) and audit trail, but is
// invisible to every read in the API. Idempotent: calling DELETE on an
// already-archived row returns 204 (the desired end state is reached).
//
// Owner-only. Non-owners get 403. We deliberately do NOT 404 a non-owner
// who hits a real id — that would leak the existence of items they don't
// own. Same posture as the edit endpoint.
route.openapi(
  createRoute({
    method: "delete",
    path: "/exchange-items/{id}",
    tags: ["exchange-items"],
    summary: "Archive (soft-delete) an exchange item the authenticated user owns.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth, idempotency()] as const,
    request: { params: IdParamSchema },
    responses: {
      204: { description: "Archived (no content)" },
      401: { description: "Unauthenticated", content: problemContent },
      403: { description: "Not the item owner", content: problemContent },
      404: { description: "Item not found", content: problemContent },
    },
  }),
  async (c) => {
    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });
    const { id } = c.req.valid("param");
    const db = getDb();

    // Read INCLUDING archived rows so a re-DELETE on an already-archived
    // listing is treated as a no-op rather than 404. The owner check then
    // works the same way regardless of state.
    const existing = await db
      .select()
      .from(exchangeItems)
      .where(eq(exchangeItems.id, id))
      .limit(1);
    const row = existing[0];
    if (!row) throw new HTTPException(404, { message: "Not Found" });
    if (row.user_id !== u.id) {
      throw new HTTPException(403, { message: "Only the item owner can delete this listing" });
    }
    // Already archived? Nothing to do — same end state.
    if (row.archived_at) return new Response(null, { status: 204 });

    await db
      .update(exchangeItems)
      .set({ archived_at: new Date(), updated_at: new Date() })
      .where(eq(exchangeItems.id, id));
    return new Response(null, { status: 204 });
  },
);

export default route;
