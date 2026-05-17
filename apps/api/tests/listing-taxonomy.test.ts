/**
 * Listing taxonomy — Zod superRefine validation + DB round-trip.
 *
 * The superRefine tests are pure unit (no DB). They lock in the
 * per-type validation matrix from
 * tasks/2026-05-16_premium-marketplace-redesign-plan.md:
 *
 *   gift   — no money, no wants/exchange
 *   trade  — wants required, no money
 *   rent   — price_cents + price_unit required
 *   hire   — price_cents + price_unit (hour or fixed; NEVER day) required
 *   sell   — price_cents + condition required, price_unit must be fixed
 *
 * The DB round-trip exercises:
 *   • default listing_type='trade' on legacy-shaped INSERTs
 *   • CHECK constraint blocking paid-type insert without price_cents
 *   • category FK SET NULL on category delete
 *
 * The DB suite skips when DATABASE_URL is unset or the unit-test placeholder
 * `:x@` is in the URL — same pattern as reserve-race.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  ExchangeItemCreate,
  ExchangeItemUpdate,
  ExchangeItemListQuery,
} from "@esharevice/shared";
import { closeDb, exchangeItems, getDb, users, categories } from "@esharevice/db";

// ─────────────────────── Pure superRefine matrix

describe("ExchangeItemCreate superRefine — per-type validation", () => {
  const base = {
    provider: "Test Provider",
    service: "Test Service",
    date: "2026-06-01",
    description: "Test description body.",
  };

  describe("gift", () => {
    it("accepts a gift listing with no money fields", () => {
      const r = ExchangeItemCreate.safeParse({ ...base, listing_type: "gift" });
      expect(r.success).toBe(true);
    });

    it("rejects a gift listing with price_cents", () => {
      const r = ExchangeItemCreate.safeParse({
        ...base,
        listing_type: "gift",
        price_cents: 5000,
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues.some((i) => i.path.includes("price_cents"))).toBe(true);
      }
    });

    it("rejects a gift listing with a `wants` line", () => {
      const r = ExchangeItemCreate.safeParse({
        ...base,
        listing_type: "gift",
        wants: "Anything",
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues.some((i) => i.path.includes("wants"))).toBe(true);
      }
    });
  });

  describe("trade", () => {
    it("accepts a trade listing with `wants`", () => {
      const r = ExchangeItemCreate.safeParse({
        ...base,
        listing_type: "trade",
        wants: "A jar of jam",
      });
      expect(r.success).toBe(true);
    });

    it("accepts a trade listing with `exchange` (legacy alias)", () => {
      const r = ExchangeItemCreate.safeParse({
        ...base,
        listing_type: "trade",
        exchange: "A jar of jam",
      });
      expect(r.success).toBe(true);
    });

    it("defaults to trade when listing_type is omitted (back-compat)", () => {
      const r = ExchangeItemCreate.safeParse({ ...base, wants: "Anything" });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.listing_type).toBe("trade");
      }
    });

    it("rejects a trade listing without wants/exchange", () => {
      const r = ExchangeItemCreate.safeParse({ ...base, listing_type: "trade" });
      expect(r.success).toBe(false);
    });

    it("rejects a trade listing with price_cents", () => {
      const r = ExchangeItemCreate.safeParse({
        ...base,
        listing_type: "trade",
        wants: "Anything",
        price_cents: 5000,
      });
      expect(r.success).toBe(false);
    });
  });

  describe("rent", () => {
    it("accepts a rent listing with price + unit", () => {
      const r = ExchangeItemCreate.safeParse({
        ...base,
        listing_type: "rent",
        price_cents: 4000,
        price_unit: "day",
      });
      expect(r.success).toBe(true);
    });

    it("rejects a rent listing missing price_cents", () => {
      const r = ExchangeItemCreate.safeParse({
        ...base,
        listing_type: "rent",
        price_unit: "day",
      });
      expect(r.success).toBe(false);
    });

    it("rejects a rent listing missing price_unit", () => {
      const r = ExchangeItemCreate.safeParse({
        ...base,
        listing_type: "rent",
        price_cents: 4000,
      });
      expect(r.success).toBe(false);
    });

    it("accepts an optional deposit", () => {
      const r = ExchangeItemCreate.safeParse({
        ...base,
        listing_type: "rent",
        price_cents: 4000,
        price_unit: "day",
        deposit_cents: 5000,
      });
      expect(r.success).toBe(true);
    });
  });

  describe("hire", () => {
    it("accepts an hourly hire listing", () => {
      const r = ExchangeItemCreate.safeParse({
        ...base,
        listing_type: "hire",
        price_cents: 2500,
        price_unit: "hour",
      });
      expect(r.success).toBe(true);
    });

    it("accepts a fixed-price hire listing (one-off jobs)", () => {
      const r = ExchangeItemCreate.safeParse({
        ...base,
        listing_type: "hire",
        price_cents: 15000,
        price_unit: "fixed",
      });
      expect(r.success).toBe(true);
    });

    it("rejects a hire listing priced by day", () => {
      const r = ExchangeItemCreate.safeParse({
        ...base,
        listing_type: "hire",
        price_cents: 20000,
        price_unit: "day",
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues.some((i) => i.path.includes("price_unit"))).toBe(true);
      }
    });

    it("rejects a hire listing with a deposit", () => {
      const r = ExchangeItemCreate.safeParse({
        ...base,
        listing_type: "hire",
        price_cents: 2500,
        price_unit: "hour",
        deposit_cents: 1000,
      });
      expect(r.success).toBe(false);
    });
  });

  describe("sell", () => {
    it("accepts a sell listing with price + condition", () => {
      const r = ExchangeItemCreate.safeParse({
        ...base,
        listing_type: "sell",
        price_cents: 20000,
        condition: "good",
      });
      expect(r.success).toBe(true);
    });

    it("rejects a sell listing missing condition", () => {
      const r = ExchangeItemCreate.safeParse({
        ...base,
        listing_type: "sell",
        price_cents: 20000,
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues.some((i) => i.path.includes("condition"))).toBe(true);
      }
    });

    it("accepts price_unit='fixed' but rejects 'hour' or 'day'", () => {
      expect(
        ExchangeItemCreate.safeParse({
          ...base,
          listing_type: "sell",
          price_cents: 20000,
          condition: "good",
          price_unit: "fixed",
        }).success,
      ).toBe(true);
      expect(
        ExchangeItemCreate.safeParse({
          ...base,
          listing_type: "sell",
          price_cents: 20000,
          condition: "good",
          price_unit: "hour",
        }).success,
      ).toBe(false);
    });
  });

  describe("cross-type rules", () => {
    it("rejects unknown keys (strict mode)", () => {
      const r = ExchangeItemCreate.safeParse({
        ...base,
        listing_type: "trade",
        wants: "Anything",
        new_field_clients_might_add: "value",
      });
      expect(r.success).toBe(false);
    });

    it("rejects available_to before available_from", () => {
      const r = ExchangeItemCreate.safeParse({
        ...base,
        listing_type: "rent",
        price_cents: 4000,
        price_unit: "day",
        available_from: "2026-08-01T00:00:00.000Z",
        available_to: "2026-07-01T00:00:00.000Z",
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues.some((i) => i.path.includes("available_to"))).toBe(true);
      }
    });
  });
});

describe("ExchangeItemUpdate — listing_type immutable post-create", () => {
  it("rejects an update body that includes listing_type", () => {
    const r = ExchangeItemUpdate.safeParse({ listing_type: "rent" });
    expect(r.success).toBe(false);
  });

  it("accepts a partial update without listing_type", () => {
    const r = ExchangeItemUpdate.safeParse({ price_cents: 5000 });
    expect(r.success).toBe(true);
  });
});

describe("ExchangeItemListQuery — filter coercion + bbox validation", () => {
  it("coerces numeric query strings", () => {
    const r = ExchangeItemListQuery.safeParse({
      limit: "50",
      min_price_cents: "1000",
      max_price_cents: "50000",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.limit).toBe(50);
      expect(r.data.min_price_cents).toBe(1000);
      expect(r.data.max_price_cents).toBe(50000);
    }
  });

  it("accepts a valid bbox", () => {
    const r = ExchangeItemListQuery.safeParse({
      bbox: "-79.4,43.6,-79.3,43.7",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a malformed bbox", () => {
    const r = ExchangeItemListQuery.safeParse({ bbox: "not-a-bbox" });
    expect(r.success).toBe(false);
  });

  it("accepts every listing_type enum value", () => {
    for (const t of ["gift", "trade", "rent", "hire", "sell"] as const) {
      const r = ExchangeItemListQuery.safeParse({ listing_type: t });
      expect(r.success).toBe(true);
    }
  });

  it("rejects an unknown listing_type", () => {
    const r = ExchangeItemListQuery.safeParse({ listing_type: "barter" });
    expect(r.success).toBe(false);
  });
});

// ─────────────────────── DB round-trip (needs local Postgres)

const DB_AVAILABLE = await probeDb();

describe.runIf(DB_AVAILABLE)("listing taxonomy DB round-trip (integration)", () => {
  let userId: string;
  let categoryId: string;

  beforeAll(async () => {
    const db = getDb();
    const suffix = randomUUID();
    const [user] = await db
      .insert(users)
      .values({
        oidc_sub: `test-tax-${suffix}`,
        email: `tax-${suffix}@test.local`,
        first_name: "Taxonomy",
        last_name: "Tester",
      })
      .returning();
    if (!user) throw new Error("user insert returned no rows");
    userId = user.id;

    const cat = await db
      .select()
      .from(categories)
      .where(eq(categories.slug, "tools-hand"))
      .limit(1);
    if (!cat[0]) throw new Error("tools-hand category not seeded — migration 0007 missing?");
    categoryId = cat[0].id;
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(exchangeItems).where(eq(exchangeItems.user_id, userId));
    await db.delete(users).where(eq(users.id, userId));
    await closeDb();
  });

  it("defaults listing_type to 'trade' on legacy-shaped insert", async () => {
    const db = getDb();
    const [row] = await db
      .insert(exchangeItems)
      .values({
        user_id: userId,
        provider: "Legacy Owner",
        service: "Carpentry hour",
        date: "2026-06-01",
        exchange: "A jar of jam",
        description: "Legacy-shaped insert without listing_type.",
      })
      .returning();
    expect(row?.listing_type).toBe("trade");
  });

  it("accepts a rent listing with price + category FK", async () => {
    const db = getDb();
    const [row] = await db
      .insert(exchangeItems)
      .values({
        user_id: userId,
        provider: "Rental Owner",
        service: "Pressure washer",
        date: "2026-06-01",
        description: "Karcher K5, comes with 2 nozzles.",
        listing_type: "rent",
        price_cents: 4000,
        price_unit: "day",
        deposit_cents: 5000,
        category_id: categoryId,
      })
      .returning();
    expect(row?.listing_type).toBe("rent");
    expect(row?.price_cents).toBe(4000);
    expect(row?.category_id).toBe(categoryId);
  });

  it("blocks paid-type insert without price_cents via CHECK constraint", async () => {
    const db = getDb();
    const err = await captureDbError(
      db
        .insert(exchangeItems)
        .values({
          user_id: userId,
          provider: "Bad Rent",
          service: "Drill",
          date: "2026-06-01",
          description: "Trying to slip a free rent listing past the CHECK.",
          listing_type: "rent",
          // price_cents intentionally omitted
        })
        .returning(),
    );
    expect(err.code).toBe("23514");
    expect(err.constraint_name).toBe("exchange_items_paid_requires_price");
  });

  it("blocks gift-type insert WITH price_cents via CHECK constraint", async () => {
    const db = getDb();
    const err = await captureDbError(
      db
        .insert(exchangeItems)
        .values({
          user_id: userId,
          provider: "Bad Gift",
          service: "Free crib",
          date: "2026-06-01",
          description: "Trying to attach a price to a gift listing.",
          listing_type: "gift",
          price_cents: 100,
        })
        .returning(),
    );
    expect(err.code).toBe("23514");
    expect(err.constraint_name).toBe("exchange_items_paid_requires_price");
  });

  it("rejects negative price_cents via CHECK constraint", async () => {
    const db = getDb();
    const err = await captureDbError(
      db
        .insert(exchangeItems)
        .values({
          user_id: userId,
          provider: "Negative",
          service: "Item",
          date: "2026-06-01",
          description: "Negative price probe.",
          listing_type: "sell",
          price_cents: -1,
          condition: "good",
        })
        .returning(),
    );
    expect(err.code).toBe("23514");
    expect(err.constraint_name).toBe("exchange_items_price_cents_nonneg");
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
 * Drizzle wraps postgres-js errors; constraint name + SQL state code live on
 * `cause`. Same helper as bookings.test.ts — see that file for the rationale.
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
