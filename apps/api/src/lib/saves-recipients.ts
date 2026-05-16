import { and, eq, notInArray } from "drizzle-orm";
import { exchangeItemSaves, getDb, users } from "@esharevice/db";

export type SaverRecipient = {
  user_id: string;
};

/**
 * All users who have bookmarked `itemId` (minus an exclusion list — the
 * reserver and the owner already get dedicated notifications and shouldn't
 * be double-emailed). Returns just the user_ids; the email helpers do
 * their own lookup so the per-user preference + unsubscribe-token plumbing
 * lives in one place.
 *
 * The composite PK on `exchange_item_saves(user_id, item_id)` makes this
 * lookup an index range scan; no pagination because the saves count is
 * bounded by user-base size and stays well under triple digits in practice.
 * If it grows, add a cursor + dispatch to a background queue.
 */
export async function getSaversToNotify(
  itemId: string,
  excludeUserIds: string[],
): Promise<SaverRecipient[]> {
  const db = getDb();
  const conditions = [eq(exchangeItemSaves.item_id, itemId)];
  if (excludeUserIds.length > 0) {
    conditions.push(notInArray(exchangeItemSaves.user_id, excludeUserIds));
  }
  return db
    .select({ user_id: users.id })
    .from(exchangeItemSaves)
    .innerJoin(users, eq(exchangeItemSaves.user_id, users.id))
    .where(and(...conditions));
}
