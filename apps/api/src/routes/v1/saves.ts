import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  getDb,
  exchangeItems,
  exchangeItemSaves,
  type ExchangeItemRow,
} from "@esharevice/db";
import { CursorQuery, ExchangeItem, SaveState, cursorPage } from "@esharevice/shared";
import { requireAuth } from "../../middleware/auth.js";
import { idempotency } from "../../middleware/idempotency.js";
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
const problemContent = { "application/problem+json": { schema: ProblemSchema } };

const IdParamSchema = z.object({ id: z.string().uuid() }).openapi("IdParam");
const SaveStateSchema = SaveState.openapi("SaveState");
const ListResponseSchema = cursorPage(ExchangeItem).openapi("SavedItemPage");

function toApiItem(row: ExchangeItemRow): z.infer<typeof ExchangeItem> {
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

// ─────────────────────── GET /v1/exchange-items/{id}/save
//
// Tells the viewer whether they've saved this item. Always 200 — the body's
// `saved` boolean carries the answer. We could 404 on "not saved" but a
// boolean is friendlier for client code (no error-vs-not-error branching).
route.openapi(
  createRoute({
    method: "get",
    path: "/exchange-items/{id}/save",
    tags: ["saves"],
    summary: "Whether the authenticated user has saved this item.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth] as const,
    request: { params: IdParamSchema },
    responses: {
      200: { description: "OK", content: { "application/json": { schema: SaveStateSchema } } },
      401: { description: "Unauthenticated", content: problemContent },
      404: { description: "Item not found", content: problemContent },
    },
  }),
  async (c) => {
    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });
    const { id } = c.req.valid("param");
    const db = getDb();

    // Confirm the item exists AND is not archived — a 404 here is clearer
    // than silently returning saved=false for an item that was never real or
    // has been removed by its owner.
    const items = await db
      .select({ id: exchangeItems.id })
      .from(exchangeItems)
      .where(and(eq(exchangeItems.id, id), isNull(exchangeItems.archived_at)))
      .limit(1);
    if (items.length === 0) throw new HTTPException(404, { message: "Not Found" });

    const rows = await db
      .select({ user_id: exchangeItemSaves.user_id })
      .from(exchangeItemSaves)
      .where(and(eq(exchangeItemSaves.user_id, u.id), eq(exchangeItemSaves.item_id, id)))
      .limit(1);
    return c.json({ saved: rows.length > 0 }, 200);
  },
);

// ─────────────────────── PUT /v1/exchange-items/{id}/save
//
// Idempotent "save this item" via INSERT ... ON CONFLICT DO NOTHING. A
// double-tap from a flaky network produces the same end state (item is
// saved) and the same response, no row duplication.
route.openapi(
  createRoute({
    method: "put",
    path: "/exchange-items/{id}/save",
    tags: ["saves"],
    summary: "Save (bookmark) this item for the authenticated user.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth, idempotency()] as const,
    request: { params: IdParamSchema },
    responses: {
      200: { description: "Saved", content: { "application/json": { schema: SaveStateSchema } } },
      401: { description: "Unauthenticated", content: problemContent },
      404: { description: "Item not found", content: problemContent },
    },
  }),
  async (c) => {
    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });
    const { id } = c.req.valid("param");
    const db = getDb();

    // Existence + active check — give a useful 404 instead of letting the
    // FK insert fail with a wall-of-SQL error, and refuse saves on items
    // the owner has archived.
    const items = await db
      .select({ id: exchangeItems.id })
      .from(exchangeItems)
      .where(and(eq(exchangeItems.id, id), isNull(exchangeItems.archived_at)))
      .limit(1);
    if (items.length === 0) throw new HTTPException(404, { message: "Not Found" });

    await db
      .insert(exchangeItemSaves)
      .values({ user_id: u.id, item_id: id })
      .onConflictDoNothing();
    return c.json({ saved: true }, 200);
  },
);

// ─────────────────────── DELETE /v1/exchange-items/{id}/save
//
// Idempotent unsave. Returns 200 with `{saved:false}` whether the row
// existed or not — same end state means same response.
route.openapi(
  createRoute({
    method: "delete",
    path: "/exchange-items/{id}/save",
    tags: ["saves"],
    summary: "Remove this item from the authenticated user's saves.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth, idempotency()] as const,
    request: { params: IdParamSchema },
    responses: {
      200: { description: "Unsaved", content: { "application/json": { schema: SaveStateSchema } } },
      401: { description: "Unauthenticated", content: problemContent },
    },
  }),
  async (c) => {
    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });
    const { id } = c.req.valid("param");
    const db = getDb();
    await db
      .delete(exchangeItemSaves)
      .where(and(eq(exchangeItemSaves.user_id, u.id), eq(exchangeItemSaves.item_id, id)));
    return c.json({ saved: false }, 200);
  },
);

// ─────────────────────── GET /v1/saves
//
// List all items the authenticated user has saved, most-recent first.
// Cursor pagination on (save.created_at, item.id) — matches the existing
// exchange-items pattern so client pagination code is shared.
route.openapi(
  createRoute({
    method: "get",
    path: "/saves",
    tags: ["saves"],
    summary: "List items the authenticated user has saved.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth] as const,
    request: { query: CursorQuery },
    responses: {
      200: { description: "OK", content: { "application/json": { schema: ListResponseSchema } } },
      401: { description: "Unauthenticated", content: problemContent },
    },
  }),
  async (c) => {
    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });
    const { cursor: cursorRaw, limit } = c.req.valid("query");
    const cursor = decodeCursor(cursorRaw);
    const db = getDb();

    // Always hide archived items from the listing — a save row may still
    // exist (we don't cascade delete the saves on archive), but the user
    // shouldn't see the dead listing in their /saved page.
    const conditions = [
      eq(exchangeItemSaves.user_id, u.id),
      isNull(exchangeItems.archived_at),
    ];
    if (cursor) {
      // Tuple comparison on (saves.created_at, items.id) for stable cursor.
      conditions.push(
        sql`(${exchangeItemSaves.created_at}, ${exchangeItems.id}) < (${new Date(cursor.ts)}, ${cursor.id}::uuid)`,
      );
    }

    const rows = await db
      .select({
        save_created_at: exchangeItemSaves.created_at,
        item: exchangeItems,
      })
      .from(exchangeItemSaves)
      .innerJoin(exchangeItems, eq(exchangeItemSaves.item_id, exchangeItems.id))
      .where(and(...conditions))
      .orderBy(desc(exchangeItemSaves.created_at), desc(exchangeItems.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const next_cursor =
      hasMore && last
        ? encodeCursor({ ts: last.save_created_at.toISOString(), id: last.item.id })
        : null;

    return c.json({ items: page.map((r) => toApiItem(r.item)), next_cursor }, 200);
  },
);

export default route;
