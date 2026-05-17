/**
 * bookings-complete — promote returned bookings whose 24-hour release
 * window has elapsed to status='completed'. Runs every 5 minutes per the
 * plan. In production this is the moment funds transfer from the platform's
 * Stripe balance to the provider's connected account.
 *
 * PR 3 ships the state transition; the Stripe transfer call lands in PR 4
 * (where stripe.transfers.create() runs inside this function). PR 11 hooks
 * the scheduler. Until then it's callable but performs no DB write when
 * FEATURE_BOOKINGS is off.
 *
 * The 24h window is the dispute filing grace period. A booking can land in
 * status='disputed' (PR 10) before this cron picks it up — that's why the
 * WHERE clause guards on status='returned' specifically.
 */
import { and, eq, lte, sql } from "drizzle-orm";
import { bookings, getDb } from "@esharevice/db";
import { env } from "../env.js";

const RELEASE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type CompleteResult = {
  ranAt: Date;
  completed: number;
  skippedDueToFlag: boolean;
};

export async function completeDueBookings(now: Date = new Date()): Promise<CompleteResult> {
  if (!env.FEATURE_BOOKINGS) {
    return { ranAt: now, completed: 0, skippedDueToFlag: true };
  }
  const cutoff = new Date(now.getTime() - RELEASE_WINDOW_MS);
  const db = getDb();
  const updated = await db
    .update(bookings)
    .set({ status: "completed", completed_at: now, updated_at: now })
    .where(
      and(
        eq(bookings.status, "returned"),
        lte(bookings.returned_at, sql`${cutoff.toISOString()}::timestamptz`),
      ),
    )
    .returning({ id: bookings.id });
  return { ranAt: now, completed: updated.length, skippedDueToFlag: false };
}
