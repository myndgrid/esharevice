import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import {
  conversations,
  exchangeItems,
  getDb,
  messages,
  users,
  type ConversationRow,
  type MessageRow,
} from "@esharevice/db";
import {
  Conversation,
  CursorQuery,
  Message,
  MessageCreate,
  cursorPage,
} from "@esharevice/shared";
import { requireAuth } from "../../middleware/auth.js";
import { idempotency } from "../../middleware/idempotency.js";
import { decodeCursor, encodeCursor } from "../../lib/cursor.js";
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
const ItemIdParamSchema = z.object({ id: z.string().uuid() }).openapi("ItemIdParam");
const ConversationSchema = Conversation.openapi("Conversation");
const ConversationListSchema = cursorPage(Conversation).openapi("ConversationPage");
const MessageSchema = Message.openapi("Message");
const MessageCreateSchema = MessageCreate.openapi("MessageCreate");
const MessageListSchema = cursorPage(Message).openapi("MessagePage");

/** Build the Conversation API response shape from a joined row. */
function toApiConversation(
  conv: ConversationRow,
  itemService: string,
  ownerId: string,
  otherPartyName: string,
  lastMessageBody: string | null,
): z.infer<typeof ConversationSchema> {
  // Truncate the preview to keep the list payload small.
  const preview = lastMessageBody
    ? lastMessageBody.length > 120
      ? lastMessageBody.slice(0, 117) + "…"
      : lastMessageBody
    : null;
  return Conversation.parse({
    id: conv.id,
    item_id: conv.item_id,
    item_service: itemService,
    initiator_id: conv.initiator_id,
    owner_id: ownerId,
    other_party_name: otherPartyName,
    last_message_preview: preview,
    last_message_at: conv.last_message_at.toISOString(),
    created_at: conv.created_at.toISOString(),
  });
}

function toApiMessage(row: MessageRow): z.infer<typeof MessageSchema> {
  return Message.parse({
    id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    body: row.body,
    created_at: row.created_at.toISOString(),
  });
}

// ─────────────────────── POST /v1/exchange-items/{id}/conversations
//
// "Start (or get) a conversation with the owner of this item."
// Idempotent: UNIQUE (item_id, initiator_id) means re-POSTing returns
// the same conversation row. The initiator must NOT be the owner.
route.openapi(
  createRoute({
    method: "post",
    path: "/exchange-items/{id}/conversations",
    tags: ["messages"],
    summary: "Start (or get) a conversation about this listing.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth, idempotency()] as const,
    request: { params: ItemIdParamSchema },
    responses: {
      200: { description: "Conversation existed; returning it.", content: { "application/json": { schema: ConversationSchema } } },
      201: { description: "Conversation created.", content: { "application/json": { schema: ConversationSchema } } },
      401: { description: "Unauthenticated", content: problemContent },
      403: { description: "Owner can't start a thread with themselves", content: problemContent },
      404: { description: "Item not found", content: problemContent },
    },
  }),
  async (c) => {
    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });
    const { id: itemId } = c.req.valid("param");
    const db = getDb();

    const items = await db
      .select({ id: exchangeItems.id, user_id: exchangeItems.user_id, service: exchangeItems.service })
      .from(exchangeItems)
      .where(and(eq(exchangeItems.id, itemId), isNull(exchangeItems.archived_at)))
      .limit(1);
    const item = items[0];
    if (!item) throw new HTTPException(404, { message: "Not Found" });
    if (item.user_id === u.id) {
      throw new HTTPException(403, { message: "Owner can't start a thread with themselves" });
    }

    // Find-or-insert pattern. ON CONFLICT (item_id, initiator_id)
    // DO UPDATE SET ... RETURNING * gives us a row in either case;
    // the touched `last_message_at` is set to itself to keep the
    // RETURNING. We then check `created_at == last_message_at &&
    // no messages exist` heuristically... actually simpler: just look
    // at xmax to detect insert vs update — but that's PG plumbing.
    // Easiest: try INSERT … ON CONFLICT DO NOTHING + RETURNING,
    // then SELECT if nothing came back.
    const inserted = await db
      .insert(conversations)
      .values({ item_id: itemId, initiator_id: u.id })
      .onConflictDoNothing()
      .returning();
    let conv: ConversationRow;
    if (inserted[0]) {
      conv = inserted[0];
    } else {
      const existing = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.item_id, itemId), eq(conversations.initiator_id, u.id)))
        .limit(1);
      if (!existing[0]) throw new HTTPException(500, { message: "conversation lookup failed" });
      conv = existing[0];
    }

    // Owner display name for the "other party" — the initiator is the
    // viewer here, so the other side is always the owner.
    const ownerRows = await db
      .select({ first_name: users.first_name, last_name: users.last_name })
      .from(users)
      .where(eq(users.id, item.user_id))
      .limit(1);
    const owner = ownerRows[0];
    const otherPartyName =
      `${owner?.first_name ?? ""} ${owner?.last_name ?? ""}`.trim() || "Owner";

    const status = inserted[0] ? 201 : 200;
    return c.json(
      toApiConversation(conv, item.service, item.user_id, otherPartyName, null),
      status,
    );
  },
);

// ─────────────────────── GET /v1/conversations
//
// All conversations the viewer participates in (either as initiator OR
// as the owner of the underlying listing). Joined with `exchange_items`
// for the item service + owner id, with `users` for the other-party
// display name, and with the most-recent `messages` row for the preview.
route.openapi(
  createRoute({
    method: "get",
    path: "/conversations",
    tags: ["messages"],
    summary: "List conversations the authenticated user participates in.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth] as const,
    request: { query: CursorQuery },
    responses: {
      200: { description: "OK", content: { "application/json": { schema: ConversationListSchema } } },
      401: { description: "Unauthenticated", content: problemContent },
    },
  }),
  async (c) => {
    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });
    const { cursor: cursorRaw, limit } = c.req.valid("query");
    const cursor = decodeCursor(cursorRaw);
    const db = getDb();

    // Cursor on (conversations.last_message_at desc, conversations.id desc).
    const conditions = [
      or(
        eq(conversations.initiator_id, u.id),
        eq(exchangeItems.user_id, u.id),
      )!,
    ];
    if (cursor) {
      conditions.push(
        sql`(${conversations.last_message_at}, ${conversations.id}) < (${new Date(cursor.ts)}, ${cursor.id}::uuid)`,
      );
    }

    const rows = await db
      .select({
        conv: conversations,
        item_service: exchangeItems.service,
        owner_id: exchangeItems.user_id,
      })
      .from(conversations)
      .innerJoin(exchangeItems, eq(conversations.item_id, exchangeItems.id))
      .where(and(...conditions))
      .orderBy(desc(conversations.last_message_at), desc(conversations.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    // Pre-load the "other party" name + most-recent message body for each
    // conversation. Two batched IN-list queries instead of N+1.
    const convIds = page.map((r) => r.conv.id);
    const otherPartyIds = page.map((r) =>
      r.conv.initiator_id === u.id ? r.owner_id : r.conv.initiator_id,
    );

    const otherPartyRows =
      otherPartyIds.length > 0
        ? await db
            .select({ id: users.id, first_name: users.first_name, last_name: users.last_name })
            .from(users)
            .where(sql`${users.id} = ANY(${otherPartyIds}::uuid[])`)
        : [];
    const otherPartyById = new Map(otherPartyRows.map((r) => [r.id, r]));

    // Latest message per conversation (DISTINCT ON pattern in Postgres).
    const previewRows =
      convIds.length > 0
        ? await db.execute<{ conversation_id: string; body: string }>(sql`
            SELECT DISTINCT ON ("conversation_id") "conversation_id", "body"
            FROM ${messages}
            WHERE "conversation_id" = ANY(${convIds}::uuid[])
            ORDER BY "conversation_id", "created_at" DESC, "id" DESC
          `)
        : { rows: [] };
    const previewByConv = new Map(
      (previewRows as { rows: { conversation_id: string; body: string }[] }).rows.map((r) => [
        r.conversation_id,
        r.body,
      ]),
    );

    const items = page.map((r) => {
      const otherId = r.conv.initiator_id === u.id ? r.owner_id : r.conv.initiator_id;
      const other = otherPartyById.get(otherId);
      const otherName =
        `${other?.first_name ?? ""} ${other?.last_name ?? ""}`.trim() ||
        (r.conv.initiator_id === u.id ? "Owner" : "Member");
      return toApiConversation(
        r.conv,
        r.item_service,
        r.owner_id,
        otherName,
        previewByConv.get(r.conv.id) ?? null,
      );
    });

    const next_cursor =
      hasMore && last
        ? encodeCursor({ ts: last.conv.last_message_at.toISOString(), id: last.conv.id })
        : null;
    return c.json({ items, next_cursor }, 200);
  },
);

// ─────────────────────── GET /v1/conversations/{id}
//
// Single conversation — verifies the viewer is one of the two
// participants. Used by the thread view to populate header metadata
// alongside the messages fetch.
route.openapi(
  createRoute({
    method: "get",
    path: "/conversations/{id}",
    tags: ["messages"],
    summary: "Fetch a conversation's metadata.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth] as const,
    request: { params: IdParamSchema },
    responses: {
      200: { description: "OK", content: { "application/json": { schema: ConversationSchema } } },
      401: { description: "Unauthenticated", content: problemContent },
      403: { description: "Not a participant", content: problemContent },
      404: { description: "Not Found", content: problemContent },
    },
  }),
  async (c) => {
    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });
    const { id } = c.req.valid("param");
    const db = getDb();

    const rows = await db
      .select({
        conv: conversations,
        item_service: exchangeItems.service,
        owner_id: exchangeItems.user_id,
      })
      .from(conversations)
      .innerJoin(exchangeItems, eq(conversations.item_id, exchangeItems.id))
      .where(eq(conversations.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new HTTPException(404, { message: "Not Found" });
    if (row.conv.initiator_id !== u.id && row.owner_id !== u.id) {
      throw new HTTPException(403, { message: "Not a participant in this conversation" });
    }

    const otherId = row.conv.initiator_id === u.id ? row.owner_id : row.conv.initiator_id;
    const otherRows = await db
      .select({ first_name: users.first_name, last_name: users.last_name })
      .from(users)
      .where(eq(users.id, otherId))
      .limit(1);
    const other = otherRows[0];
    const otherName =
      `${other?.first_name ?? ""} ${other?.last_name ?? ""}`.trim() ||
      (row.conv.initiator_id === u.id ? "Owner" : "Member");

    return c.json(
      toApiConversation(row.conv, row.item_service, row.owner_id, otherName, null),
      200,
    );
  },
);

// ─────────────────────── GET /v1/conversations/{id}/messages
//
// Message list, oldest-first. Cursor pagination on (created_at, id).
// Caller-friendly default of `limit=50` is fine for the chat view; for
// older history the client cursors backwards.
route.openapi(
  createRoute({
    method: "get",
    path: "/conversations/{id}/messages",
    tags: ["messages"],
    summary: "List messages in a conversation, oldest-first.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth] as const,
    request: {
      params: IdParamSchema,
      query: CursorQuery,
    },
    responses: {
      200: { description: "OK", content: { "application/json": { schema: MessageListSchema } } },
      401: { description: "Unauthenticated", content: problemContent },
      403: { description: "Not a participant", content: problemContent },
      404: { description: "Conversation not found", content: problemContent },
    },
  }),
  async (c) => {
    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });
    const { id } = c.req.valid("param");
    const { cursor: cursorRaw, limit } = c.req.valid("query");
    const cursor = decodeCursor(cursorRaw);
    const db = getDb();

    // Participant check via inner join with the conversation + item.
    const convRows = await db
      .select({ initiator_id: conversations.initiator_id, owner_id: exchangeItems.user_id })
      .from(conversations)
      .innerJoin(exchangeItems, eq(conversations.item_id, exchangeItems.id))
      .where(eq(conversations.id, id))
      .limit(1);
    const conv = convRows[0];
    if (!conv) throw new HTTPException(404, { message: "Not Found" });
    if (conv.initiator_id !== u.id && conv.owner_id !== u.id) {
      throw new HTTPException(403, { message: "Not a participant in this conversation" });
    }

    const conditions = [eq(messages.conversation_id, id)];
    if (cursor) {
      // Tuple comparison — for ASC ordering we want messages AFTER the cursor.
      conditions.push(
        sql`(${messages.created_at}, ${messages.id}) > (${new Date(cursor.ts)}, ${cursor.id}::uuid)`,
      );
    }
    const rows = await db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(asc(messages.created_at), asc(messages.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const next_cursor =
      hasMore && last ? encodeCursor({ ts: last.created_at.toISOString(), id: last.id }) : null;
    return c.json({ items: page.map(toApiMessage), next_cursor }, 200);
  },
);

// ─────────────────────── POST /v1/conversations/{id}/messages
//
// Append a message to the thread. Bumps `conversations.last_message_at`
// so the listing's order reflects activity.
route.openapi(
  createRoute({
    method: "post",
    path: "/conversations/{id}/messages",
    tags: ["messages"],
    summary: "Send a message in a conversation.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth, idempotency()] as const,
    request: {
      params: IdParamSchema,
      body: { content: { "application/json": { schema: MessageCreateSchema } } },
    },
    responses: {
      201: { description: "Created", content: { "application/json": { schema: MessageSchema } } },
      400: { description: "Validation failed", content: problemContent },
      401: { description: "Unauthenticated", content: problemContent },
      403: { description: "Not a participant", content: problemContent },
      404: { description: "Conversation not found", content: problemContent },
    },
  }),
  async (c) => {
    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const db = getDb();

    const convRows = await db
      .select({ initiator_id: conversations.initiator_id, owner_id: exchangeItems.user_id })
      .from(conversations)
      .innerJoin(exchangeItems, eq(conversations.item_id, exchangeItems.id))
      .where(eq(conversations.id, id))
      .limit(1);
    const conv = convRows[0];
    if (!conv) throw new HTTPException(404, { message: "Not Found" });
    if (conv.initiator_id !== u.id && conv.owner_id !== u.id) {
      throw new HTTPException(403, { message: "Not a participant in this conversation" });
    }

    const now = new Date();
    const inserted = await db
      .insert(messages)
      .values({
        conversation_id: id,
        sender_id: u.id,
        body: body.body,
      })
      .returning();
    const msg = inserted[0];
    if (!msg) throw new HTTPException(500, { message: "insert returned no rows" });

    // Bump the conversation's last_message_at so list ordering reflects activity.
    await db
      .update(conversations)
      .set({ last_message_at: now })
      .where(eq(conversations.id, id));

    return c.json(toApiMessage(msg), 201);
  },
);

export default route;
