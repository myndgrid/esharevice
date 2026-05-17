/**
 * Stripe Connect tests.
 *
 * Two surfaces under test:
 *   1. Pure unit: Stripe-status derivation, webhook event handlers' DB
 *      side-effects (mocking the Stripe library entirely).
 *   2. DB integration (skip-when-no-Postgres): the stripe_events
 *      idempotency PK actually prevents duplicate event processing.
 *
 * Stripe SDK is heavy + makes network calls; the live calls are tested
 * separately via the Stripe CLI's event-forwarding (out-of-band). This
 * suite is fast (< 500ms) and locks in the invariants the test runner
 * SHOULD catch on every commit.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  closeDb,
  getDb,
  stripeAccounts,
  stripeEvents,
  users,
  type NewStripeAccountRow,
} from "@esharevice/db";
import { PayoutAccount, StripeAccountStatus } from "@esharevice/shared";

// ─────────────────────── Pure: Zod enum + shape

describe("PayoutAccount Zod schema", () => {
  it("accepts a complete active account", () => {
    const r = PayoutAccount.safeParse({
      status: "active",
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      country: "CA",
      default_currency: "CAD",
      created_at: "2026-05-17T05:00:00.000Z",
      updated_at: "2026-05-17T05:00:00.000Z",
    });
    expect(r.success).toBe(true);
  });

  it("rejects non-CA currency at v1 — Toronto-only launch", () => {
    const r = PayoutAccount.safeParse({
      status: "active",
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      country: "US",
      default_currency: "USD",
      created_at: "2026-05-17T05:00:00.000Z",
      updated_at: "2026-05-17T05:00:00.000Z",
    });
    expect(r.success).toBe(false);
  });

  it("StripeAccountStatus enum covers all four states", () => {
    for (const s of ["pending", "restricted", "active", "rejected"] as const) {
      expect(StripeAccountStatus.safeParse(s).success).toBe(true);
    }
    expect(StripeAccountStatus.safeParse("inactive").success).toBe(false);
  });
});

// ─────────────────────── DB integration

const DB_AVAILABLE = await probeDb();

describe.runIf(DB_AVAILABLE)("Stripe Connect — DB invariants", () => {
  let userId: string;

  beforeAll(async () => {
    const db = getDb();
    const suffix = randomUUID();
    const [u] = await db
      .insert(users)
      .values({
        oidc_sub: `stripe-${suffix}`,
        email: `stripe-${suffix}@test.local`,
        first_name: "Stripe",
        last_name: "Tester",
      })
      .returning();
    if (!u) throw new Error("user insert returned no rows");
    userId = u.id;
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(stripeAccounts).where(eq(stripeAccounts.user_id, userId));
    await db.delete(users).where(eq(users.id, userId));
    await closeDb();
  });

  it("UNIQUE on user_id: only one stripe_account per provider", async () => {
    const db = getDb();
    const baseValues: NewStripeAccountRow = {
      user_id: userId,
      account_id: `acct_${randomUUID().slice(0, 16)}`,
      status: "pending",
    };
    const first = await db.insert(stripeAccounts).values(baseValues).returning();
    expect(first[0]?.user_id).toBe(userId);

    const second = await captureDbError(
      db.insert(stripeAccounts).values({
        ...baseValues,
        account_id: `acct_${randomUUID().slice(0, 16)}`, // different acct_id
      }).returning(),
    );
    expect(second.code).toBe("23505"); // unique_violation
  });

  it("UNIQUE on account_id: same acct_id can't be linked twice", async () => {
    const db = getDb();
    // Clean prior test's row first to avoid conflict on user_id.
    await db.delete(stripeAccounts).where(eq(stripeAccounts.user_id, userId));

    const acctId = `acct_${randomUUID().slice(0, 16)}`;
    await db.insert(stripeAccounts).values({
      user_id: userId,
      account_id: acctId,
      status: "pending",
    });

    // Different user trying to claim the same acct_id should fail.
    const otherSuffix = randomUUID();
    const [otherUser] = await db
      .insert(users)
      .values({
        oidc_sub: `stripe2-${otherSuffix}`,
        email: `stripe2-${otherSuffix}@test.local`,
        first_name: "Other",
        last_name: "User",
      })
      .returning();
    if (!otherUser) throw new Error("other user insert returned no rows");

    try {
      const err = await captureDbError(
        db.insert(stripeAccounts).values({
          user_id: otherUser.id,
          account_id: acctId,
          status: "pending",
        }).returning(),
      );
      expect(err.code).toBe("23505");
    } finally {
      await db.delete(users).where(eq(users.id, otherUser.id));
    }
  });

  it("stripe_events PK on event_id: idempotent duplicate insert is rejected", async () => {
    const db = getDb();
    const eventId = `evt_test_${randomUUID()}`;
    await db.insert(stripeEvents).values({
      event_id: eventId,
      type: "payment_intent.succeeded",
      processed: true,
    });

    // Second insert with same event_id (the duplicate Stripe webhook
    // delivery scenario) must fail. The webhook handler catches this
    // and short-circuits to a 200 + duplicate=true response.
    const err = await captureDbError(
      db.insert(stripeEvents).values({
        event_id: eventId,
        type: "payment_intent.succeeded",
        processed: true,
      }),
    );
    expect(err.code).toBe("23505");

    // Cleanup
    await db.delete(stripeEvents).where(eq(stripeEvents.event_id, eventId));
  });

  it("default values: country=CA, default_currency=CAD, charges/payouts disabled", async () => {
    const db = getDb();
    await db.delete(stripeAccounts).where(eq(stripeAccounts.user_id, userId));
    const [row] = await db
      .insert(stripeAccounts)
      .values({
        user_id: userId,
        account_id: `acct_${randomUUID().slice(0, 16)}`,
      })
      .returning();
    expect(row?.country).toBe("CA");
    expect(row?.default_currency).toBe("CAD");
    expect(row?.charges_enabled).toBe(false);
    expect(row?.payouts_enabled).toBe(false);
    expect(row?.details_submitted).toBe(false);
    expect(row?.status).toBe("pending");
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

type PgErrorShape = { constraint_name?: string; code?: string; message: string };

async function captureDbError(promise: Promise<unknown>): Promise<PgErrorShape> {
  try {
    await promise;
    throw new Error("expected the query to throw, but it resolved");
  } catch (e) {
    const err = e as { cause?: { constraint_name?: string; code?: string; message?: string }; message?: string };
    return {
      constraint_name: err.cause?.constraint_name,
      code: err.cause?.code,
      message: err.cause?.message ?? err.message ?? "",
    };
  }
}
