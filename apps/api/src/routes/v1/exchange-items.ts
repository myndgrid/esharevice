import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import {
  getDb,
  categories,
  exchangeItems,
  type Category as CategoryRow,
  type ExchangeItemRow,
} from "@esharevice/db";
import {
  CategoryRef,
  ExchangeItem,
  ExchangeItemCreate,
  ExchangeItemListQuery,
  ExchangeItemUpdate,
  cursorPage,
} from "@esharevice/shared";
import { attachAuth, requireAuth } from "../../middleware/auth.js";
import { idempotency } from "../../middleware/idempotency.js";
import { decodeCursor, encodeCursor } from "../../lib/cursor.js";
import { imgUrlFromKey } from "../../lib/image-url.js";
import { env, r2Configured } from "../../env.js";
import { ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES, processAndUpload } from "../../lib/sharp-pipeline.js";
import {
  sendItemArchivedEmailToSaver,
  sendItemReservedEmailToSaver,
  sendReservedEmail,
} from "../../lib/email.js";
import { getSaversToNotify } from "../../lib/saves-recipients.js";
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
const ListQuerySchema = ExchangeItemListQuery.openapi("ExchangeItemListQuery");
const ListResponseSchema = cursorPage(ExchangeItem).openapi("ExchangeItemPage");
const IdParamSchema = z.object({ id: z.string().uuid() }).openapi("IdParam");

const problemContent = { "application/problem+json": { schema: ProblemSchema } };

/**
 * Compose the wire shape from the DB row + optional joined category.
 *
 * Three taxonomy-related rules baked in:
 *   • `exchange` and `wants` are dual fields. The DB stores in `exchange`;
 *     for trade rows we mirror it to `wants` for new clients.
 *   • Paid-type fields (price/condition/etc.) are NULL on the wire for
 *     gift/trade. SQL CHECK enforces the invariant; we just pass through.
 *   • `rating` / `neighbourhood` / `distance_km` / `neighbour_favourite`
 *     are stubs until PR 9 (reviews) and PR 5/6 (geo). PR 2 returns
 *     null/false so the response shape is forward-compatible.
 */
function toApiItem(
  row: ExchangeItemRow,
  category: CategoryRow | null,
): z.infer<typeof ItemSchema> {
  const isTrade = row.listing_type === "trade";
  const exchangeValue = row.exchange ?? null;
  return ExchangeItem.parse({
    id: row.id,
    user_id: row.user_id,
    provider: row.provider,
    service: row.service,
    date: row.date,
    exchange: exchangeValue,
    wants: isTrade ? exchangeValue : null,
    description: row.description,
    rate_type: row.rate_type ?? null,
    img_url: imgUrlFromKey(row.img_key),
    img_hash: row.img_hash ?? null,
    reserved: row.reserved,
    reserved_by: row.reserved_by ?? null,
    reserved_at: row.reserved_at ? row.reserved_at.toISOString() : null,
    listing_type: row.listing_type,
    price_cents: row.price_cents ?? null,
    price_unit: row.price_unit ?? null,
    deposit_cents: row.deposit_cents ?? null,
    condition: row.condition ?? null,
    available_from: row.available_from ? row.available_from.toISOString() : null,
    available_to: row.available_to ? row.available_to.toISOString() : null,
    location_lat: row.location_lat !== null ? Number(row.location_lat) : null,
    location_lng: row.location_lng !== null ? Number(row.location_lng) : null,
    location_precision: row.location_precision ?? null,
    category_id: row.category_id ?? null,
    category: category
      ? CategoryRef.parse({ id: category.id, slug: category.slug, name: category.name })
      : null,
    rating: null,
    neighbourhood: null,
    distance_km: null,
    neighbour_favourite: false,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  });
}

/**
 * Hydrate category data for a page of rows in one round-trip. Returns a
 * Map keyed by category id so the caller can look up each row's category
 * in O(1) without an N+1 fetch.
 */
async function hydrateCategories(rows: ExchangeItemRow[]): Promise<Map<string, CategoryRow>> {
  const db = getDb();
  const ids = Array.from(
    new Set(rows.map((r) => r.category_id).filter((v): v is string => v !== null)),
  );
  if (ids.length === 0) return new Map();
  // inArray() expands to `IN ($1, $2, …)` with proper parameter binding —
  // avoids the `ANY(array::uuid[])` record-cast pitfall captured in the bug
  // registry on the parent project's CLAUDE.md.
  const { inArray } = await import("drizzle-orm");
  const cats = await db.select().from(categories).where(inArray(categories.id, ids));
  return new Map(cats.map((c) => [c.id, c]));
}

/**
 * Bbox parser. Input is `minLng,minLat,maxLng,maxLat` (validated upstream
 * by Zod regex). Returns numbers in the standard geographic order.
 */
function parseBbox(s: string): { minLng: number; minLat: number; maxLng: number; maxLat: number } {
  const [minLng, minLat, maxLng, maxLat] = s.split(",").map(Number);
  if (
    minLng === undefined ||
    minLat === undefined ||
    maxLng === undefined ||
    maxLat === undefined
  ) {
    // Defensive — the Zod regex prevents this in practice.
    throw new HTTPException(400, { message: "Invalid bbox" });
  }
  return { minLng, minLat, maxLng, maxLat };
}

// ─────────────────────── GET /v1/exchange-items
route.openapi(
  createRoute({
    method: "get",
    path: "/exchange-items",
    tags: ["exchange-items"],
    summary: "List exchange items (cursor-paginated, FTS-searchable, taxonomy-filterable).",
    middleware: [attachAuth] as const,
    request: { query: ListQuerySchema },
    responses: {
      200: { description: "OK", content: { "application/json": { schema: ListResponseSchema } } },
    },
  }),
  async (c) => {
    const {
      cursor: cursorRaw,
      limit,
      q,
      listing_type,
      category_slug,
      min_price_cents,
      max_price_cents,
      bbox,
    } = c.req.valid("query");
    const cursor = decodeCursor(cursorRaw);
    const db = getDb();

    // Soft-delete filter — every read of exchange_items excludes archived
    // rows. The 0002 migration's partial index covers the (created_at desc,
    // id desc) tuple ONLY for active rows, so this WHERE clause is fast.
    const conditions = [isNull(exchangeItems.archived_at)];
    if (cursor) {
      // Tuple comparison: (created_at, id) < (cursor.ts, cursor.id). Postgres native.
      // Pass the date as ISO string — interpolating raw `Date` into `sql` template
      // bypasses Drizzle's column-typed binding and hits postgres-js byteLength.
      conditions.push(
        sql`(${exchangeItems.created_at}, ${exchangeItems.id}) < (${new Date(cursor.ts).toISOString()}, ${cursor.id}::uuid)`,
      );
    }
    if (q && q.trim()) {
      conditions.push(sql`${exchangeItems.search} @@ websearch_to_tsquery('english', ${q.trim()})`);
    }
    if (listing_type) {
      conditions.push(eq(exchangeItems.listing_type, listing_type));
    }
    if (category_slug) {
      // Sub-select rather than join — the SELECT * + projection stays unchanged
      // and the planner can use the unique index on categories.slug efficiently.
      conditions.push(
        sql`${exchangeItems.category_id} = (SELECT ${categories.id} FROM ${categories} WHERE ${categories.slug} = ${category_slug} LIMIT 1)`,
      );
    }
    if (min_price_cents !== undefined) {
      conditions.push(gte(exchangeItems.price_cents, min_price_cents));
    }
    if (max_price_cents !== undefined) {
      conditions.push(lte(exchangeItems.price_cents, max_price_cents));
    }
    if (bbox) {
      const { minLng, minLat, maxLng, maxLat } = parseBbox(bbox);
      conditions.push(gte(exchangeItems.location_lng, sql`${minLng}::numeric`));
      conditions.push(lte(exchangeItems.location_lng, sql`${maxLng}::numeric`));
      conditions.push(gte(exchangeItems.location_lat, sql`${minLat}::numeric`));
      conditions.push(lte(exchangeItems.location_lat, sql`${maxLat}::numeric`));
    }

    const rows = await db
      .select()
      .from(exchangeItems)
      .where(and(...conditions))
      .orderBy(desc(exchangeItems.created_at), desc(exchangeItems.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const categoryMap = await hydrateCategories(page);
    const last = page[page.length - 1];
    const next_cursor =
      hasMore && last ? encodeCursor({ ts: last.created_at.toISOString(), id: last.id }) : null;

    const items = page.map((r) =>
      toApiItem(r, r.category_id ? categoryMap.get(r.category_id) ?? null : null),
    );
    return c.json({ items, next_cursor }, 200);
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
    const map = await hydrateCategories([row]);
    const cat = row.category_id ? map.get(row.category_id) ?? null : null;
    return c.json(toApiItem(row, cat), 200);
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

    // `category_id` references categories(id); reject upfront with a 400
    // rather than letting the FK violation bubble up as a 500.
    if (body.category_id) {
      const cat = await db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, body.category_id))
        .limit(1);
      if (!cat[0]) {
        throw new HTTPException(400, { message: "Unknown category_id" });
      }
    }

    // `wants` and `exchange` are aliases on the wire — store in `exchange`.
    // For trade listings the superRefine already guaranteed at least one is
    // present and non-empty.
    const wantsValue = body.wants ?? body.exchange ?? null;

    const inserted = await db
      .insert(exchangeItems)
      .values({
        user_id: u.id,
        provider: body.provider,
        service: body.service,
        date: body.date,
        // SQL column is nullable post-0007; non-trade types store null.
        exchange: body.listing_type === "trade" ? wantsValue ?? "" : wantsValue,
        description: body.description,
        rate_type: body.rate_type ?? null,
        listing_type: body.listing_type,
        price_cents: body.price_cents ?? null,
        price_unit: body.price_unit ?? null,
        deposit_cents: body.deposit_cents ?? null,
        condition: body.condition ?? null,
        available_from: body.available_from ? new Date(body.available_from) : null,
        available_to: body.available_to ? new Date(body.available_to) : null,
        location_lat: body.location_lat?.toString() ?? null,
        location_lng: body.location_lng?.toString() ?? null,
        location_precision: body.location_precision ?? null,
        category_id: body.category_id ?? null,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new HTTPException(500, { message: "insert returned no rows" });
    const map = await hydrateCategories([row]);
    const cat = row.category_id ? map.get(row.category_id) ?? null : null;
    return c.json(toApiItem(row, cat), 201);
  },
);

// ─────────────────────── PUT /v1/exchange-items/:id
//
// Edit an existing exchange item. Owner-only. Body is the partial
// ExchangeItemUpdate schema — every field optional, listing_type omitted
// (immutable post-create). Strict mode rejects unknown keys including
// listing_type so a client trying to mutate it gets a clear 400.
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

    // If editor passes a new category_id, validate it exists.
    if (body.category_id !== undefined && body.category_id !== null) {
      const cat = await db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, body.category_id))
        .limit(1);
      if (!cat[0]) {
        throw new HTTPException(400, { message: "Unknown category_id" });
      }
    }

    // Build a sparse update — only write keys that are actually present.
    // Drizzle ignores keys with undefined values in its `set` builder, but
    // being explicit keeps the SQL minimal and avoids accidentally clearing
    // fields a client didn't intend to touch. `wants` is an alias for
    // `exchange` (trade only); both update the same column.
    const patch: Partial<typeof exchangeItems.$inferInsert> = { updated_at: new Date() };
    if (body.provider !== undefined) patch.provider = body.provider;
    if (body.service !== undefined) patch.service = body.service;
    if (body.date !== undefined) patch.date = body.date;
    if (body.wants !== undefined) patch.exchange = body.wants;
    else if (body.exchange !== undefined) patch.exchange = body.exchange;
    if (body.description !== undefined) patch.description = body.description;
    if (body.rate_type !== undefined) patch.rate_type = body.rate_type;
    if (body.price_cents !== undefined) patch.price_cents = body.price_cents;
    if (body.price_unit !== undefined) patch.price_unit = body.price_unit;
    if (body.deposit_cents !== undefined) patch.deposit_cents = body.deposit_cents;
    if (body.condition !== undefined) patch.condition = body.condition;
    if (body.available_from !== undefined)
      patch.available_from = new Date(body.available_from);
    if (body.available_to !== undefined) patch.available_to = new Date(body.available_to);
    if (body.location_lat !== undefined) patch.location_lat = body.location_lat.toString();
    if (body.location_lng !== undefined) patch.location_lng = body.location_lng.toString();
    if (body.location_precision !== undefined) patch.location_precision = body.location_precision;
    if (body.category_id !== undefined) patch.category_id = body.category_id;

    const updated = await db
      .update(exchangeItems)
      .set(patch)
      .where(eq(exchangeItems.id, id))
      .returning();
    const u2 = updated[0];
    if (!u2) throw new HTTPException(500, { message: "update returned no rows" });
    const map = await hydrateCategories([u2]);
    const cat = u2.category_id ? map.get(u2.category_id) ?? null : null;
    return c.json(toApiItem(u2, cat), 200);
  },
);

// ─────────────────────── PUT /v1/exchange-items/:id/reserve
//
// DEPRECATED in PR 3 when /v1/items/:id/bookings lands. Kept alive for a
// 30-day overlap so existing clients keep working while web UI migrates.
route.openapi(
  createRoute({
    method: "put",
    path: "/exchange-items/{id}/reserve",
    tags: ["exchange-items"],
    summary: "Reserve an exchange item (DEPRECATED — use POST /v1/items/:id/bookings).",
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
      throw new HTTPException(409, { message: "Already reserved" });
    }

    void (async () => {
      try {
        const reserverName =
          `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || "Someone";
        const base = env.WEB_PUBLIC_URL ?? env.OIDC_ISSUER.replace(/\/application\/o\/[^/]+\/?$/, "");
        const itemUrl = `${base.replace(/\/$/, "")}/items/${row.id}`;
        await sendReservedEmail({
          recipientId: row.user_id,
          reserverName,
          itemService: row.service,
          itemUrl,
        });
        const savers = await getSaversToNotify(row.id, [u.id, row.user_id]);
        for (const s of savers) {
          await sendItemReservedEmailToSaver({
            recipientId: s.user_id,
            itemService: row.service,
            itemUrl,
          });
        }
      } catch (err) {
        console.warn("[reserve] notification setup failed:", err);
      }
    })();

    const map = await hydrateCategories([u2]);
    const cat = u2.category_id ? map.get(u2.category_id) ?? null : null;
    return c.json(toApiItem(u2, cat), 200);
  },
);

// ─────────────────────── POST /v1/exchange-items/:id/image
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
    const map = await hydrateCategories([u2]);
    const cat = u2.category_id ? map.get(u2.category_id) ?? null : null;
    return c.json(toApiItem(u2, cat), 200);
  },
);

// ─────────────────────── DELETE /v1/exchange-items/:id
//
// Soft delete — sets `archived_at = now()`. Owner-only. Returns 204 even
// on already-archived rows (idempotent end-state). See pre-PR-2 comments
// for the full rationale.
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
    if (row.archived_at) return new Response(null, { status: 204 });

    await db
      .update(exchangeItems)
      .set({ archived_at: new Date(), updated_at: new Date() })
      .where(eq(exchangeItems.id, id));

    void (async () => {
      try {
        const savers = await getSaversToNotify(row.id, [u.id]);
        for (const s of savers) {
          await sendItemArchivedEmailToSaver({
            recipientId: s.user_id,
            itemService: row.service,
          });
        }
      } catch (err) {
        console.warn("[delete] saver notification setup failed:", err);
      }
    })();

    return new Response(null, { status: 204 });
  },
);

// asc is imported above but unused for now; PR 3's bookings list uses it.
// Keep the import to prevent the IDE auto-stripping it next edit.
void asc;

export default route;
