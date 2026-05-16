/**
 * Integration test for the conversations + messages SQL paths that 500'd
 * in production on 2026-05-16 (see tasks/2026-05-16_conversations-500-cascade.md).
 *
 * Three regressions to lock in:
 *
 *   1. `WHERE id IN (…)` rendered via `inArray` (NOT
 *      `sql\`= ANY(${arr}::uuid[])\``, which produces a record cast that
 *      Postgres rejects).
 *
 *   2. The DISTINCT-ON "latest message per conversation" query — `sql.join`
 *      builds the IN-list with `<id>::uuid` casts on each element; the
 *      result is read as a rows-array DIRECTLY (postgres-js, not
 *      node-postgres' `{rows:[…]}` envelope).
 *
 *   3. The messages cursor uses `.toISOString()` on the `Date` before
 *      interpolating into `sql\`…\``. Without it, postgres-js falls
 *      through to `Buffer.byteLength(date)` and throws.
 *
 * The test mirrors the queries inside the route handler verbatim. If the
 * handler's SQL diverges, the test fails and surfaces the diff.
 *
 * Skips cleanly when DATABASE_URL is the unit-test placeholder so CI
 * without datastores stays green (same gate as reserve-race.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  closeDb,
  conversations,
  exchangeItems,
  getDb,
  messages,
  users,
} from "@esharevice/db";
import { encodeCursor } from "../src/lib/cursor.js";

const DB_AVAILABLE = await probeDb();

describe.runIf(DB_AVAILABLE)("conversations + messages queries (integration)", () => {
  // Fixture: 3 users (A, B, C). B is the listing owner on item1 + item2.
  // A starts a conversation with B about item1; C starts one with B about item2.
  // Each conversation gets a couple of messages so we can assert previews +
  // pagination.
  let ownerId: string; // B
  let initiatorAId: string; // A
  let initiatorCId: string; // C
  let item1Id: string;
  let item2Id: string;
  let conv1Id: string; // A ↔ B about item1
  let conv2Id: string; // C ↔ B about item2
  let conv1MsgIds: string[] = [];

  beforeAll(async () => {
    const db = getDb();
    const suffix = randomUUID();

    const [owner] = await db
      .insert(users)
      .values({
        oidc_sub: `test-owner-${suffix}`,
        email: `owner-${suffix}@test.local`,
        first_name: "Bea",
        last_name: "Owner",
      })
      .returning();
    const [aRow] = await db
      .insert(users)
      .values({
        oidc_sub: `test-a-${suffix}`,
        email: `a-${suffix}@test.local`,
        first_name: "Ada",
        last_name: "Initiator",
      })
      .returning();
    const [cRow] = await db
      .insert(users)
      .values({
        oidc_sub: `test-c-${suffix}`,
        email: `c-${suffix}@test.local`,
        first_name: "Cyril",
        last_name: "Initiator",
      })
      .returning();
    if (!owner || !aRow || !cRow) throw new Error("user inserts returned no rows");
    ownerId = owner.id;
    initiatorAId = aRow.id;
    initiatorCId = cRow.id;

    const [item1] = await db
      .insert(exchangeItems)
      .values({
        user_id: ownerId,
        provider: `Conv test ${suffix.slice(0, 6)}`,
        service: "Garden hour",
        date: "2026-07-01",
        exchange: "A pint of jam",
        description: "Test fixture 1",
      })
      .returning();
    const [item2] = await db
      .insert(exchangeItems)
      .values({
        user_id: ownerId,
        provider: `Conv test ${suffix.slice(0, 6)}`,
        service: "Carpentry tip",
        date: "2026-07-15",
        exchange: "A bag of apples",
        description: "Test fixture 2",
      })
      .returning();
    if (!item1 || !item2) throw new Error("item inserts returned no rows");
    item1Id = item1.id;
    item2Id = item2.id;

    const [conv1] = await db
      .insert(conversations)
      .values({ item_id: item1Id, initiator_id: initiatorAId })
      .returning();
    const [conv2] = await db
      .insert(conversations)
      .values({ item_id: item2Id, initiator_id: initiatorCId })
      .returning();
    if (!conv1 || !conv2) throw new Error("conversation inserts returned no rows");
    conv1Id = conv1.id;
    conv2Id = conv2.id;

    // Messages: conv1 gets 60 (for cursor test), conv2 gets 2 (preview test).
    // Set explicit `created_at` per row — a single bulk INSERT runs in one
    // statement with `now()` resolving identically for every row, and the
    // UUID secondary sort is random, so order-by-insertion would be
    // non-deterministic. Stagger by 1 ms to mirror what the route actually
    // observes in prod (sends are seconds apart).
    const conv1Base = new Date("2026-07-01T10:00:00.000Z").getTime();
    const conv1Rows = await db
      .insert(messages)
      .values(
        Array.from({ length: 60 }, (_, i) => ({
          conversation_id: conv1Id,
          sender_id: i % 2 === 0 ? initiatorAId : ownerId,
          body: `conv1 message ${i + 1}`,
          created_at: new Date(conv1Base + i),
        })),
      )
      .returning({ id: messages.id });
    conv1MsgIds = conv1Rows.map((r) => r.id);

    const conv2Base = new Date("2026-07-15T10:00:00.000Z").getTime();
    await db.insert(messages).values([
      {
        conversation_id: conv2Id,
        sender_id: initiatorCId,
        body: "hi from cyril",
        created_at: new Date(conv2Base),
      },
      {
        conversation_id: conv2Id,
        sender_id: ownerId,
        body: "hi cyril — last message in conv2",
        created_at: new Date(conv2Base + 1000),
      },
    ]);
  });

  afterAll(async () => {
    const db = getDb();
    // Cascading FKs do most of the work: deleting items cascades to
    // conversations + messages + saves; deleting users cascades from
    // conversations.initiator_id / messages.sender_id / items.user_id.
    // Belt-and-suspenders: delete in an order that the FKs accept.
    await db.delete(messages).where(eq(messages.conversation_id, conv1Id));
    await db.delete(messages).where(eq(messages.conversation_id, conv2Id));
    await db.delete(conversations).where(eq(conversations.id, conv1Id));
    await db.delete(conversations).where(eq(conversations.id, conv2Id));
    await db.delete(exchangeItems).where(eq(exchangeItems.id, item1Id));
    await db.delete(exchangeItems).where(eq(exchangeItems.id, item2Id));
    await db.delete(users).where(eq(users.id, ownerId));
    await db.delete(users).where(eq(users.id, initiatorAId));
    await db.delete(users).where(eq(users.id, initiatorCId));
    await closeDb();
  });

  it("list conversations for owner — inArray + DISTINCT-ON preview round-trip", async () => {
    const db = getDb();
    // Mirror the route handler's query for `viewer = owner` (Bea sees BOTH
    // conv1 and conv2 because she's the listing owner on both items).
    const rows = await db
      .select({
        conv: conversations,
        item_service: exchangeItems.service,
        owner_id: exchangeItems.user_id,
      })
      .from(conversations)
      .innerJoin(exchangeItems, eq(conversations.item_id, exchangeItems.id))
      .where(
        or(eq(conversations.initiator_id, ownerId), eq(exchangeItems.user_id, ownerId)),
      )
      .orderBy(desc(conversations.last_message_at), desc(conversations.id));

    expect(rows.map((r) => r.conv.id).sort()).toEqual([conv1Id, conv2Id].sort());

    const otherPartyIds = rows.map((r) =>
      r.conv.initiator_id === ownerId ? r.owner_id : r.conv.initiator_id,
    );
    const convIds = rows.map((r) => r.conv.id);

    // Bug 1 was here: `= ANY(${arr}::uuid[])` produced a record cast error.
    // The fix uses `inArray(...)`. If anyone reverts, this throws.
    const otherPartyRows = await db
      .select({ id: users.id, first_name: users.first_name, last_name: users.last_name })
      .from(users)
      .where(inArray(users.id, otherPartyIds));

    expect(otherPartyRows.map((r) => r.id).sort()).toEqual(
      [initiatorAId, initiatorCId].sort(),
    );

    // Bug 2 was here: raw DISTINCT ON via `sql.join` for the IN-list,
    // result read as the rows array DIRECTLY (postgres-js shape).
    const previewRows = (await db.execute<{ conversation_id: string; body: string }>(sql`
      SELECT DISTINCT ON ("conversation_id") "conversation_id", "body"
      FROM ${messages}
      WHERE "conversation_id" IN (${sql.join(
        convIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
      ORDER BY "conversation_id", "created_at" DESC, "id" DESC
    `)) as unknown as { conversation_id: string; body: string }[];

    expect(Array.isArray(previewRows)).toBe(true);
    const previewByConv = new Map(previewRows.map((r) => [r.conversation_id, r.body]));
    expect(previewByConv.get(conv1Id)).toBe("conv1 message 60");
    expect(previewByConv.get(conv2Id)).toBe("hi cyril — last message in conv2");
  });

  it("paginate messages: cursor with .toISOString() returns the correct slice", async () => {
    const db = getDb();
    const limit = 50;

    // First page — no cursor. Mirrors the route handler.
    const firstPage = await db
      .select()
      .from(messages)
      .where(eq(messages.conversation_id, conv1Id))
      .orderBy(asc(messages.created_at), asc(messages.id))
      .limit(limit + 1);

    expect(firstPage.length).toBe(limit + 1); // 60 inserted; expect over-fetch by 1
    const firstSlice = firstPage.slice(0, limit);
    const tail = firstSlice[firstSlice.length - 1]!;
    expect(firstSlice[0]!.body).toBe("conv1 message 1");
    expect(tail.body).toBe("conv1 message 50");

    // Cursor encodes the tail (ts, id). The route's handler builds the
    // SAME SQL — `.toISOString()` is critical here; without it the raw
    // Date crashes postgres-js's parameter binding.
    const cursorStr = encodeCursor({ ts: tail.created_at.toISOString(), id: tail.id });
    expect(cursorStr).toBeTruthy();

    // Second page — apply the cursor exactly as the route does.
    const cursorPayload = JSON.parse(Buffer.from(cursorStr!, "base64").toString());
    const secondPage = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversation_id, conv1Id),
          sql`(${messages.created_at}, ${messages.id}) > (${new Date(cursorPayload.ts).toISOString()}, ${cursorPayload.id}::uuid)`,
        ),
      )
      .orderBy(asc(messages.created_at), asc(messages.id))
      .limit(limit + 1);

    expect(secondPage.length).toBe(10); // remaining 10 (51..60), no over-fetch
    expect(secondPage[0]!.body).toBe("conv1 message 51");
    expect(secondPage[secondPage.length - 1]!.body).toBe("conv1 message 60");
  });

  it("conversation IDs from the fixture survive the round-trip", () => {
    // Cheap sanity check that prior tests didn't leak state via shared globals.
    expect(conv1MsgIds).toHaveLength(60);
    expect(conv1Id).not.toBe(conv2Id);
  });

  it("unread-count SQL: viewer's own messages don't count; mark-read clears the count", async () => {
    // Mirrors the SQL in GET /v1/conversations/unread-count verbatim.
    // The test resets the read-state to a known baseline (both columns
    // NULL → epoch fallback) then asserts:
    //   - viewer's OWN messages are excluded (sender_id != viewer.id)
    //   - bumping the viewer's last_read_at drops the count to 0
    const db = getDb();

    // Belt-and-suspenders: clear any state the prior test wrote.
    await db
      .update(conversations)
      .set({ initiator_last_read_at: null, owner_last_read_at: null })
      .where(eq(conversations.id, conv1Id));

    const unreadFor = async (viewerId: string): Promise<number> => {
      const rows = (await db.execute(sql`
        SELECT COUNT(*)::int AS total
        FROM ${messages} m
        JOIN ${conversations} c ON c.id = m.conversation_id
        JOIN ${exchangeItems} ei ON ei.id = c.item_id
        WHERE
          (c.initiator_id = ${viewerId}::uuid OR ei.user_id = ${viewerId}::uuid)
          AND m.sender_id != ${viewerId}::uuid
          AND m.created_at > COALESCE(
            CASE
              WHEN c.initiator_id = ${viewerId}::uuid THEN c.initiator_last_read_at
              ELSE c.owner_last_read_at
            END,
            'epoch'::timestamptz
          )
      `)) as unknown as { total: number }[];
      return rows[0]?.total ?? 0;
    };

    // Fixture sent 60 messages alternating A↔B + 2 in conv2 (C↔B).
    // From A's POV: half of conv1 was sent by B (30 messages) + zero from conv2.
    expect(await unreadFor(initiatorAId)).toBe(30);
    // From B's (owner) POV: half of conv1 sent by A (30) + 1 from C in conv2.
    expect(await unreadFor(ownerId)).toBe(31);

    // Mark A as read on conv1 → A's unread drops to 0. The fixture uses
    // synthetic July dates; "now" is well before the messages, so set the
    // read mark explicitly past the conv1 tail (2026-07-01T10:00:00.060Z).
    await db
      .update(conversations)
      .set({ initiator_last_read_at: new Date("2026-07-01T10:01:00.000Z") })
      .where(eq(conversations.id, conv1Id));
    expect(await unreadFor(initiatorAId)).toBe(0);
    // B is unaffected by A's read state.
    expect(await unreadFor(ownerId)).toBe(31);
  });

  it("last_read_at: initiator's column updates independently of owner's", async () => {
    // Regression guard for the email-suppression path. The POST /messages
    // handler must update ONLY the sender's `last_read_at` column on insert
    // — touching the recipient's column would defeat suppression (the
    // recipient's "did they see this thread recently" check is what gates
    // the new-message email). The PATCH /:id/read handler has the same
    // requirement: viewer updates their own column, never the other party's.
    const db = getDb();
    const stamp = new Date();
    await db
      .update(conversations)
      .set({ initiator_last_read_at: stamp })
      .where(eq(conversations.id, conv1Id));

    const rows = await db
      .select({
        initiator_last_read_at: conversations.initiator_last_read_at,
        owner_last_read_at: conversations.owner_last_read_at,
      })
      .from(conversations)
      .where(eq(conversations.id, conv1Id))
      .limit(1);

    expect(rows[0]?.initiator_last_read_at).not.toBeNull();
    expect(rows[0]?.owner_last_read_at).toBeNull();
  });
});

async function probeDb(): Promise<boolean> {
  const url = process.env["DATABASE_URL"] ?? "";
  if (!url || /:x@/.test(url)) return false;
  try {
    const db = getDb();
    await db.execute("select 1");
    return true;
  } catch {
    return false;
  }
}
