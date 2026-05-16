import { and, eq, notInArray } from "drizzle-orm";
import { exchangeItemSaves, getDb, users } from "@esharevice/db";

export type SaverRecipient = {
  email: string;
  first_name: string;
  last_name: string;
};

/**
 * All users who have bookmarked `itemId`, joined with their profile, with
 * a configurable exclusion list (the reserver and the owner already get
 * dedicated notifications and shouldn't be double-emailed).
 *
 * The composite PK on `exchange_item_saves(user_id, item_id)` makes this
 * lookup an index range scan; the inner join with `users` is the typical
 * one-row-per-saver cost. No pagination — for an exchange-item listing,
 * the saves count is bounded by the user-base size and realistically
 * stays well under triple digits. If it grows, add a cursor + dispatch
 * to a background queue.
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
    .select({
      email: users.email,
      first_name: users.first_name,
      last_name: users.last_name,
    })
    .from(exchangeItemSaves)
    .innerJoin(users, eq(exchangeItemSaves.user_id, users.id))
    .where(and(...conditions));
}

/** Build a friendly display name from a SaverRecipient row, falling back when both name fields are empty. */
export function recipientDisplayName(r: SaverRecipient): string {
  const composed = `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim();
  return composed.length > 0 ? composed : "there";
}
