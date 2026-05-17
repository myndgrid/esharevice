/**
 * bookings-activate — promote confirmed bookings whose start_at has passed
 * to status='active'. Runs every 5 minutes per the plan.
 *
 * PR 3 ships the SQL + tests; the scheduler hook lands in PR 11 alongside
 * Stripe Connect because activation in production is the moment funds
 * transition from "authorized" to "captured" via Stripe. Until then this
 * function is callable but performs no DB write when FEATURE_BOOKINGS is
 * off — that's the safe default for an unconfigured prod.
 *
 * Idempotency: the WHERE clause guards on status='confirmed' so a re-run
 * is a no-op. Two concurrent invocations both look for the same rows; the
 * losing race sees `active_at IS NOT NULL` and the UPDATE no-ops.
 */
import { and, eq, lte, sql } from "drizzle-orm";
import { bookings, getDb } from "@esharevice/db";
import { env } from "../env.js";

export type ActivateResult = {
  ranAt: Date;
  activated: number;
  skippedDueToFlag: boolean;
};

export async function activateDueBookings(now: Date = new Date()): Promise<ActivateResult> {
  if (!env.FEATURE_BOOKINGS) {
    return { ranAt: now, activated: 0, skippedDueToFlag: true };
  }
  const db = getDb();
  const updated = await db
    .update(bookings)
    .set({ status: "active", active_at: now, updated_at: now })
    .where(
      and(
        eq(bookings.status, "confirmed"),
        // Use raw SQL on the timestamp comparison so the existing
        // bookings_status_idx partial index covers the scan and the
        // start_at filter just narrows from there.
        lte(bookings.start_at, sql`${now.toISOString()}::timestamptz`),
      ),
    )
    .returning({ id: bookings.id });
  return { ranAt: now, activated: updated.length, skippedDueToFlag: false };
}
