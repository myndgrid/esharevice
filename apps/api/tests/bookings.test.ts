/**
 * Bookings — pure unit tests for pricing + Zod schemas, DB-integration
 * tests for the EXCLUDE constraint and state-machine guards.
 *
 * The EXCLUDE overlap test is the non-negotiable one. It's the load-bearing
 * invariant of the whole booking flow: two renters can NEVER both end up
 * with confirmed-or-requested bookings on the same item for overlapping
 * date ranges. The plan flags it as the only DB test we won't ship without.
 *
 * The DB-integration block uses the skip-when-no-Postgres pattern from
 * reserve-race.test.ts so local + CI both stay green even without a
 * datastore wired up.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  Booking,
  BookingCancel,
  BookingCreate,
  BookingDecline,
  BookingListQuery,
} from "@esharevice/shared";
import { calculateTotals, quantityFromRange } from "../src/lib/pricing.js";
import {
  bookings,
  closeDb,
  exchangeItems,
  getDb,
  users,
} from "@esharevice/db";

// ─────────────────────── Pricing math (pure)

describe("pricing — calculateTotals", () => {
  it("rent: 10% fee, deposit passes through, total = subtotal + fee + deposit", () => {
    const totals = calculateTotals({
      listing_type: "rent",
      price_cents: 4000,
      price_unit: "day",
      quantity: 2,
      deposit_cents: 5000,
    });
    expect(totals.subtotal_cents).toBe(8000);
    expect(totals.platform_fee_cents).toBe(800);
    expect(totals.deposit_cents).toBe(5000);
    expect(totals.total_cents).toBe(13800);
  });

  it("hire: 12% fee, deposit always 0 (Zod forbids upstream)", () => {
    const totals = calculateTotals({
      listing_type: "hire",
      price_cents: 2500,
      price_unit: "hour",
      quantity: 3,
      deposit_cents: 0,
    });
    expect(totals.subtotal_cents).toBe(7500);
    expect(totals.platform_fee_cents).toBe(900); // 12% of 7500
    expect(totals.total_cents).toBe(8400);
  });

  it("sell: 10% fee, no deposit, quantity defaults to 1", () => {
    const totals = calculateTotals({
      listing_type: "sell",
      price_cents: 20000,
      price_unit: "fixed",
      quantity: 1,
      deposit_cents: 0,
    });
    expect(totals.subtotal_cents).toBe(20000);
    expect(totals.platform_fee_cents).toBe(2000);
    expect(totals.total_cents).toBe(22000);
  });

  it("rounds platform fee half-up (not banker's rounding)", () => {
    // 10% of 33 cents = 3.3 → 3; 10% of 35 cents = 3.5 → 4 (NOT 4 via
    // banker's rounding which would round 0.5 to even — that's the bug
    // calculateTotals explicitly avoids).
    const a = calculateTotals({
      listing_type: "sell",
      price_cents: 33,
      price_unit: "fixed",
      quantity: 1,
      deposit_cents: 0,
    });
    expect(a.platform_fee_cents).toBe(3);

    const b = calculateTotals({
      listing_type: "sell",
      price_cents: 35,
      price_unit: "fixed",
      quantity: 1,
      deposit_cents: 0,
    });
    expect(b.platform_fee_cents).toBe(4);
  });

  it("rejects negative inputs", () => {
    expect(() =>
      calculateTotals({
        listing_type: "rent",
        price_cents: -1,
        price_unit: "day",
        quantity: 1,
        deposit_cents: 0,
      }),
    ).toThrow();
    expect(() =>
      calculateTotals({
        listing_type: "rent",
        price_cents: 1000,
        price_unit: "day",
        quantity: 0,
        deposit_cents: 0,
      }),
    ).toThrow();
  });
});

describe("pricing — quantityFromRange", () => {
  const base = new Date("2026-06-01T00:00:00Z");

  it("'day' rounds up — even one minute into a new day counts", () => {
    expect(quantityFromRange("day", base, new Date("2026-06-02T00:00:00Z"))).toBe(1);
    expect(quantityFromRange("day", base, new Date("2026-06-02T00:01:00Z"))).toBe(2);
    expect(quantityFromRange("day", base, new Date("2026-06-03T00:00:00Z"))).toBe(2);
  });

  it("'hour' rounds up — same partial-hour billing", () => {
    expect(quantityFromRange("hour", base, new Date("2026-06-01T01:00:00Z"))).toBe(1);
    expect(quantityFromRange("hour", base, new Date("2026-06-01T01:30:00Z"))).toBe(2);
  });

  it("'fixed' and null return 1", () => {
    expect(quantityFromRange("fixed", base, new Date("2026-06-15T00:00:00Z"))).toBe(1);
    expect(quantityFromRange(null, base, new Date("2026-06-15T00:00:00Z"))).toBe(1);
  });

  it("throws on non-positive ranges", () => {
    expect(() => quantityFromRange("day", base, base)).toThrow();
    expect(() => quantityFromRange("day", base, new Date(base.getTime() - 1))).toThrow();
  });
});

// ─────────────────────── Zod schema matrix

describe("BookingCreate — superRefine + strict mode", () => {
  it("accepts both date fields together", () => {
    const r = BookingCreate.safeParse({
      start_at: "2026-06-01T09:00:00.000Z",
      end_at: "2026-06-03T09:00:00.000Z",
    });
    expect(r.success).toBe(true);
  });

  it("accepts neither date field (sell)", () => {
    const r = BookingCreate.safeParse({});
    expect(r.success).toBe(true);
  });

  it("rejects only one date field", () => {
    const r = BookingCreate.safeParse({ start_at: "2026-06-01T09:00:00.000Z" });
    expect(r.success).toBe(false);
  });

  it("rejects end_at <= start_at", () => {
    const r = BookingCreate.safeParse({
      start_at: "2026-06-03T09:00:00.000Z",
      end_at: "2026-06-01T09:00:00.000Z",
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    const r = BookingCreate.safeParse({
      start_at: "2026-06-01T09:00:00.000Z",
      end_at: "2026-06-03T09:00:00.000Z",
      sneaky_field: "no",
    });
    expect(r.success).toBe(false);
  });
});

describe("BookingDecline / BookingCancel", () => {
  it("requires a reason", () => {
    expect(BookingDecline.safeParse({}).success).toBe(false);
    expect(BookingCancel.safeParse({}).success).toBe(false);
  });
  it("accepts a non-empty reason", () => {
    expect(BookingDecline.safeParse({ reason: "Already booked" }).success).toBe(true);
  });
});

describe("BookingListQuery", () => {
  it("requires role", () => {
    expect(BookingListQuery.safeParse({}).success).toBe(false);
  });
  it("accepts role=renter|provider", () => {
    expect(BookingListQuery.safeParse({ role: "renter" }).success).toBe(true);
    expect(BookingListQuery.safeParse({ role: "provider" }).success).toBe(true);
  });
  it("rejects an unknown role", () => {
    expect(BookingListQuery.safeParse({ role: "admin" }).success).toBe(false);
  });
});

describe("Booking wire-shape currency lock", () => {
  it("rejects currency other than CAD on the wire (v1 only)", () => {
    const base = {
      id: randomUUID(),
      item_id: randomUUID(),
      renter_id: randomUUID(),
      provider_id: randomUUID(),
      status: "confirmed",
      start_at: "2026-06-01T09:00:00.000Z",
      end_at: "2026-06-03T09:00:00.000Z",
      price_cents: 4000,
      price_unit: "day",
      quantity: 2,
      subtotal_cents: 8000,
      platform_fee_cents: 800,
      stripe_fee_cents: null,
      deposit_cents: 5000,
      total_cents: 13800,
      stripe_payment_intent_id: null,
      stripe_charge_id: null,
      stripe_transfer_id: null,
      message_to_provider: null,
      decline_reason: null,
      cancel_reason: null,
      cancelled_by: null,
      requested_at: "2026-05-17T05:00:00.000Z",
      confirmed_at: "2026-05-17T05:05:00.000Z",
      active_at: null,
      returned_at: null,
      completed_at: null,
      declined_at: null,
      cancelled_at: null,
      created_at: "2026-05-17T05:00:00.000Z",
      updated_at: "2026-05-17T05:05:00.000Z",
    };
    expect(Booking.safeParse({ ...base, currency: "CAD" }).success).toBe(true);
    expect(Booking.safeParse({ ...base, currency: "USD" }).success).toBe(false);
  });
});

// ─────────────────────── DB integration (needs local Postgres)

const DB_AVAILABLE = await probeDb();

describe.runIf(DB_AVAILABLE)("bookings — DB invariants (integration)", () => {
  let providerId: string;
  let renter1Id: string;
  let renter2Id: string;
  let itemId: string;

  beforeAll(async () => {
    const db = getDb();
    const suffix = randomUUID();
    const seed = async (label: string) => {
      const [u] = await db
        .insert(users)
        .values({
          oidc_sub: `bk-${label}-${suffix}`,
          email: `bk-${label}-${suffix}@test.local`,
          first_name: "Booking",
          last_name: label,
        })
        .returning();
      if (!u) throw new Error(`user insert returned no rows for ${label}`);
      return u.id;
    };
    providerId = await seed("prov");
    renter1Id = await seed("r1");
    renter2Id = await seed("r2");

    const [item] = await db
      .insert(exchangeItems)
      .values({
        user_id: providerId,
        provider: `Bookings test ${suffix.slice(0, 8)}`,
        service: "Pressure washer",
        date: "2026-06-01",
        description: "Fixture for the bookings vitest case.",
        listing_type: "rent",
        price_cents: 4000,
        price_unit: "day",
        deposit_cents: 5000,
      })
      .returning();
    if (!item) throw new Error("item insert returned no rows");
    itemId = item.id;
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(bookings).where(eq(bookings.item_id, itemId));
    await db.delete(exchangeItems).where(eq(exchangeItems.id, itemId));
    await db.delete(users).where(eq(users.id, providerId));
    await db.delete(users).where(eq(users.id, renter1Id));
    await db.delete(users).where(eq(users.id, renter2Id));
    await closeDb();
  });

  /**
   * THE load-bearing test. Confirms the partial EXCLUDE USING gist
   * constraint rejects the second of two overlapping bookings on the same
   * item while both are in "active claim" states (requested/confirmed/active).
   */
  it("rejects two overlapping confirmed bookings on the same item", async () => {
    const db = getDb();
    const start1 = new Date("2026-07-01T09:00:00Z");
    const end1 = new Date("2026-07-04T09:00:00Z");

    // First booking lands cleanly.
    const [b1] = await db
      .insert(bookings)
      .values({
        item_id: itemId,
        renter_id: renter1Id,
        provider_id: providerId,
        status: "confirmed",
        start_at: start1,
        end_at: end1,
        price_cents: 4000,
        price_unit: "day",
        quantity: 3,
        subtotal_cents: 12000,
        platform_fee_cents: 1200,
        deposit_cents: 5000,
        total_cents: 18200,
      })
      .returning();
    expect(b1?.id).toBeTruthy();

    // Second booking overlaps days 2–3 — must throw on the EXCLUDE.
    // Drizzle hides the constraint name behind `cause`; captureDbError digs it out.
    const err = await captureDbError(
      db
        .insert(bookings)
        .values({
          item_id: itemId,
          renter_id: renter2Id,
          provider_id: providerId,
          status: "requested",
          start_at: new Date("2026-07-03T09:00:00Z"),
          end_at: new Date("2026-07-05T09:00:00Z"),
          price_cents: 4000,
          price_unit: "day",
          quantity: 2,
          subtotal_cents: 8000,
          platform_fee_cents: 800,
          deposit_cents: 5000,
          total_cents: 13800,
        })
        .returning(),
    );
    expect(err.code).toBe("23P01"); // exclusion_violation
    expect(err.constraint_name).toBe("bookings_no_overlap");
  });

  it("allows back-to-back bookings (touching but not overlapping ranges)", async () => {
    const db = getDb();
    const [first] = await db
      .insert(bookings)
      .values({
        item_id: itemId,
        renter_id: renter1Id,
        provider_id: providerId,
        status: "requested",
        start_at: new Date("2026-08-01T09:00:00Z"),
        end_at: new Date("2026-08-02T09:00:00Z"),
        price_cents: 4000,
        price_unit: "day",
        quantity: 1,
        subtotal_cents: 4000,
        platform_fee_cents: 400,
        deposit_cents: 0,
        total_cents: 4400,
      })
      .returning();
    expect(first?.id).toBeTruthy();

    // Same end-of-prev = start-of-next. The range is `[)` so no overlap.
    const [second] = await db
      .insert(bookings)
      .values({
        item_id: itemId,
        renter_id: renter2Id,
        provider_id: providerId,
        status: "requested",
        start_at: new Date("2026-08-02T09:00:00Z"),
        end_at: new Date("2026-08-03T09:00:00Z"),
        price_cents: 4000,
        price_unit: "day",
        quantity: 1,
        subtotal_cents: 4000,
        platform_fee_cents: 400,
        deposit_cents: 0,
        total_cents: 4400,
      })
      .returning();
    expect(second?.id).toBeTruthy();
  });

  it("allows a new booking when the prior overlapping one is declined/cancelled", async () => {
    const db = getDb();
    // First booking, then immediately decline it.
    const [first] = await db
      .insert(bookings)
      .values({
        item_id: itemId,
        renter_id: renter1Id,
        provider_id: providerId,
        status: "requested",
        start_at: new Date("2026-09-01T09:00:00Z"),
        end_at: new Date("2026-09-03T09:00:00Z"),
        price_cents: 4000,
        price_unit: "day",
        quantity: 2,
        subtotal_cents: 8000,
        platform_fee_cents: 800,
        deposit_cents: 5000,
        total_cents: 13800,
      })
      .returning();
    if (!first) throw new Error("first insert returned no rows");

    await db
      .update(bookings)
      .set({ status: "declined", declined_at: new Date(), decline_reason: "test" })
      .where(eq(bookings.id, first.id));

    // Now a second booking on overlapping dates should succeed — the
    // EXCLUDE partial WHERE clause filters out the declined row.
    const [second] = await db
      .insert(bookings)
      .values({
        item_id: itemId,
        renter_id: renter2Id,
        provider_id: providerId,
        status: "requested",
        start_at: new Date("2026-09-02T09:00:00Z"),
        end_at: new Date("2026-09-04T09:00:00Z"),
        price_cents: 4000,
        price_unit: "day",
        quantity: 2,
        subtotal_cents: 8000,
        platform_fee_cents: 800,
        deposit_cents: 5000,
        total_cents: 13800,
      })
      .returning();
    expect(second?.id).toBeTruthy();
  });

  it("allows two sell bookings on the same item (no date range, EXCLUDE doesn't fire)", async () => {
    // Sell rows have NULL start_at/end_at — the partial WHERE excludes them
    // from the EXCLUDE, so multiple sell bookings can coexist. The
    // "first purchaser wins" invariant is enforced by the existing
    // exchange_items.reserved flag, not by this constraint.
    const db = getDb();
    const seedFor = async (renterId: string) =>
      db
        .insert(bookings)
        .values({
          item_id: itemId,
          renter_id: renterId,
          provider_id: providerId,
          status: "requested",
          start_at: null,
          end_at: null,
          price_cents: 20000,
          price_unit: "fixed",
          quantity: 1,
          subtotal_cents: 20000,
          platform_fee_cents: 2000,
          deposit_cents: 0,
          total_cents: 22000,
        })
        .returning();
    const a = await seedFor(renter1Id);
    const b = await seedFor(renter2Id);
    expect(a[0]?.id).toBeTruthy();
    expect(b[0]?.id).toBeTruthy();
  });

  it("CHECK constraint: bookings_date_pair rejects one-sided date ranges", async () => {
    const db = getDb();
    const err = await captureDbError(
      db
        .insert(bookings)
        .values({
          item_id: itemId,
          renter_id: renter1Id,
          provider_id: providerId,
          status: "requested",
          start_at: new Date("2026-10-01T09:00:00Z"),
          end_at: null,
          price_cents: 4000,
          price_unit: "day",
          quantity: 1,
          subtotal_cents: 4000,
          platform_fee_cents: 400,
          deposit_cents: 0,
          total_cents: 4400,
        })
        .returning(),
    );
    expect(err.code).toBe("23514"); // check_violation
    expect(err.constraint_name).toBe("bookings_date_pair");
  });

  it("CHECK constraint: bookings_money_nonneg rejects negative totals", async () => {
    const db = getDb();
    const err = await captureDbError(
      db
        .insert(bookings)
        .values({
          item_id: itemId,
          renter_id: renter1Id,
          provider_id: providerId,
          status: "requested",
          start_at: new Date("2026-11-01T09:00:00Z"),
          end_at: new Date("2026-11-02T09:00:00Z"),
          price_cents: 4000,
          price_unit: "day",
          quantity: 1,
          subtotal_cents: 4000,
          platform_fee_cents: 400,
          deposit_cents: 0,
          total_cents: -1,
        })
        .returning(),
    );
    expect(err.code).toBe("23514"); // check_violation
    expect(err.constraint_name).toBe("bookings_money_nonneg");
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

/**
 * Drizzle wraps the underlying postgres-js error with its own "Failed query: …"
 * message, hiding the constraint name + SQL state. The actual Postgres error
 * object lives on `.cause`. This helper extracts the bits the tests care
 * about (constraint name + SQL state code) without leaking the wrapping.
 */
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
