import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, exchangeItems, type ExchangeItemRow } from "@esharevice/db";
import { CursorQuery, ExchangeItem, ExchangeItemCreate, cursorPage } from "@esharevice/shared";
import { attachAuth, requireAuth } from "../../middleware/auth.js";
import { decodeCursor, encodeCursor } from "../../lib/cursor.js";
import { imgUrlFromKey } from "../../lib/image-url.js";
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

    const conditions = [];
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
      .where(conditions.length ? and(...conditions) : undefined)
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
    const rows = await db.select().from(exchangeItems).where(eq(exchangeItems.id, id)).limit(1);
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
    middleware: [requireAuth] as const,
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

// ─────────────────────── PUT /v1/exchange-items/:id/reserve
route.openapi(
  createRoute({
    method: "put",
    path: "/exchange-items/{id}/reserve",
    tags: ["exchange-items"],
    summary: "Reserve an exchange item for the authenticated user.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth] as const,
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
    const existing = await db.select().from(exchangeItems).where(eq(exchangeItems.id, id)).limit(1);
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
        reserved_at: row.reserved_at ?? new Date(),
        updated_at: new Date(),
      })
      .where(eq(exchangeItems.id, id))
      .returning();
    const u2 = updated[0];
    if (!u2) throw new HTTPException(500, { message: "update returned no rows" });
    return c.json(toApiItem(u2), 200);
  },
);

export default route;
