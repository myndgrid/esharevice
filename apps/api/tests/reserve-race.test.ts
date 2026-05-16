/**
 * Integration test for the reserve-race invariant.
 *
 * The `PUT /v1/exchange-items/:id/reserve` handler turns its UPDATE into:
 *   UPDATE exchange_items
 *      SET reserved=true, reserved_by=$user, reserved_at=now(), updated_at=now()
 *    WHERE id=$item AND reserved=false
 *
 * Postgres's READ COMMITTED isolation + row-level lock guarantees that two
 * concurrent UPDATEs against the same row both checking `reserved=false` can
 * never BOTH match — the second transaction's WHERE clause is re-evaluated
 * after the first commits, sees `reserved=true`, and returns zero rows.
 *
 * The handler maps "zero rows returned" to `409 Already reserved`. Without
 * the WHERE predicate, both writers would silently both succeed and the
 * second would overwrite `reserved_by`, corrupting state.
 *
 * This test exercises the SQL invariant directly (no HTTP) so it's fast +
 * deterministic. It skips gracefully when DATABASE_URL isn't pointed at a
 * reachable real Postgres (e.g. CI where no datastores are up yet).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { closeDb, exchangeItems, getDb, users } from "@esharevice/db";

const DB_AVAILABLE = await probeDb();

describe.runIf(DB_AVAILABLE)("reserve race safety (integration, needs local Postgres)", () => {
  let ownerId: string;
  let reserver1Id: string;
  let reserver2Id: string;
  let itemId: string;

  beforeAll(async () => {
    const db = getDb();
    // Random subs/emails so reruns don't collide on the unique indexes.
    const suffix = randomUUID();
    const [owner] = await db
      .insert(users)
      .values({
        oidc_sub: `test-owner-${suffix}`,
        email: `owner-${suffix}@test.local`,
        first_name: "Test",
        last_name: "Owner",
      })
      .returning();
    const [r1] = await db
      .insert(users)
      .values({
        oidc_sub: `test-r1-${suffix}`,
        email: `r1-${suffix}@test.local`,
        first_name: "Reserver",
        last_name: "One",
      })
      .returning();
    const [r2] = await db
      .insert(users)
      .values({
        oidc_sub: `test-r2-${suffix}`,
        email: `r2-${suffix}@test.local`,
        first_name: "Reserver",
        last_name: "Two",
      })
      .returning();
    if (!owner || !r1 || !r2) throw new Error("user inserts returned no rows");
    ownerId = owner.id;
    reserver1Id = r1.id;
    reserver2Id = r2.id;

    const [item] = await db
      .insert(exchangeItems)
      .values({
        user_id: ownerId,
        provider: `Race test ${suffix.slice(0, 8)}`,
        service: "Carpentry hour",
        date: "2026-06-01",
        exchange: "A jar of jam",
        description: "Fixture for the reserve-race vitest case.",
      })
      .returning();
    if (!item) throw new Error("item insert returned no rows");
    itemId = item.id;
  });

  afterAll(async () => {
    const db = getDb();
    // Cascading FKs: items reference users(id) with onDelete cascade for the
    // owner; the reservers have no item rows of their own. Order: items first
    // (the reserve update set reserved_by → set null on delete), then users.
    await db.delete(exchangeItems).where(eq(exchangeItems.id, itemId));
    await db.delete(users).where(eq(users.id, ownerId));
    await db.delete(users).where(eq(users.id, reserver1Id));
    await db.delete(users).where(eq(users.id, reserver2Id));
    await closeDb();
  });

  it("only one of two concurrent reserves observes a row update", async () => {
    const db = getDb();
    const attempt = (reserverId: string) =>
      db
        .update(exchangeItems)
        .set({
          reserved: true,
          reserved_by: reserverId,
          reserved_at: new Date(),
          updated_at: new Date(),
        })
        .where(and(eq(exchangeItems.id, itemId), eq(exchangeItems.reserved, false)))
        .returning();

    const [a, b] = await Promise.all([attempt(reserver1Id), attempt(reserver2Id)]);

    // Exactly one of the two UPDATEs returned a row — the other re-evaluated
    // its WHERE after the first committed and got zero rows.
    expect(a.length + b.length).toBe(1);

    // The winning row should have `reserved_by` set to one of the two test
    // reservers (NOT the owner) and reserved=true.
    const winner = a.length === 1 ? a[0]! : b[0]!;
    expect(winner.reserved).toBe(true);
    expect([reserver1Id, reserver2Id]).toContain(winner.reserved_by);
    expect(winner.reserved_by).not.toBe(ownerId);
  });
});

async function probeDb(): Promise<boolean> {
  // Don't even try if the URL is the obvious unit-test placeholder.
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
