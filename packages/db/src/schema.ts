import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// citext for case-insensitive email comparison without LOWER() games.
// Requires: CREATE EXTENSION IF NOT EXISTS citext;
const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return "citext";
  },
});

// Generated tsvector column for full-text search.
// Drizzle has no native tsvector helper yet, so this is a raw column declaration
// finalized in a manual migration alongside the GIN index.
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Authentik OIDC subject — stable per-identity. Source of truth for who the user is.
    oidc_sub: text("oidc_sub").notNull(),
    email: citext("email").notNull(),
    first_name: text("first_name").notNull(),
    last_name: text("last_name").notNull(),
    postal_code: text("postal_code"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_oidc_sub_uq").on(t.oidc_sub), uniqueIndex("users_email_uq").on(t.email)],
);

export const exchangeItems = pgTable(
  "exchange_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    service: text("service").notNull(),
    date: text("date").notNull(),
    exchange: text("exchange").notNull(),
    description: text("description").notNull(),
    rate_type: text("rate_type"),
    img_key: text("img_key"), // R2 object key; URL is composed at read time
    img_hash: text("img_hash"), // sha256 hex of the image bytes (dedup)
    reserved: boolean("reserved").notNull().default(false),
    reserved_by: uuid("reserved_by").references(() => users.id, { onDelete: "set null" }),
    reserved_at: timestamp("reserved_at", { withTimezone: true }),
    // Generated tsvector for FTS — finalized in a manual migration so weights stick.
    search: tsvector("search"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("exchange_items_user_id_idx").on(t.user_id),
    index("exchange_items_reserved_idx").on(t.reserved),
    // GIN index added in a manual migration (drizzle-kit can't express USING gin on a generated tsvector yet).
  ],
);

/**
 * exchange_item_saves — many-to-many "user bookmarked this item" mapping.
 * Composite PK on (user_id, item_id) makes the relationship idempotent at the
 * SQL layer; INSERT … ON CONFLICT DO NOTHING is the canonical add path.
 * Both FKs cascade so a user/item delete cleans up associated rows.
 */
export const exchangeItemSaves = pgTable(
  "exchange_item_saves",
  {
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    item_id: uuid("item_id")
      .notNull()
      .references(() => exchangeItems.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.user_id, t.item_id] }),
    // Reverse index for "what items has user X saved?" — composite PK already
    // covers the (user_id, item_id) lookup; this one supports listing.
    index("exchange_item_saves_user_id_idx").on(t.user_id, t.created_at),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ExchangeItemRow = typeof exchangeItems.$inferSelect;
export type NewExchangeItemRow = typeof exchangeItems.$inferInsert;
export type ExchangeItemSaveRow = typeof exchangeItemSaves.$inferSelect;
export type NewExchangeItemSaveRow = typeof exchangeItemSaves.$inferInsert;

// Re-export sql for callers that want to reach for it from one place.
export { sql };
