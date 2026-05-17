import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  numeric,
  pgEnum,
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

// ─────────────────────── Listing taxonomy enums (migration 0007)

export const listingTypeEnum = pgEnum("listing_type", [
  "gift",
  "trade",
  "rent",
  "hire",
  "sell",
]);
export type ListingType = (typeof listingTypeEnum.enumValues)[number];

export const priceUnitEnum = pgEnum("price_unit", ["hour", "day", "fixed"]);
export type PriceUnit = (typeof priceUnitEnum.enumValues)[number];

export const itemConditionEnum = pgEnum("item_condition", [
  "new",
  "like_new",
  "good",
  "fair",
  "well_used",
]);
export type ItemCondition = (typeof itemConditionEnum.enumValues)[number];

export const locationPrecisionEnum = pgEnum("location_precision", [
  "exact",
  "street",
  "neighbourhood",
  "postal_code",
  "city",
]);
export type LocationPrecision = (typeof locationPrecisionEnum.enumValues)[number];

// ─────────────────────── Bookings enum (migration 0008)

export const bookingStatusEnum = pgEnum("booking_status", [
  "requested",
  "confirmed",
  "active",
  "returned",
  "completed",
  "declined",
  "cancelled",
]);
export type BookingStatus = (typeof bookingStatusEnum.enumValues)[number];

// ─────────────────────── Tables

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // OIDC subject — stable per-identity. Source of truth for who the user is.
    // Auth.js issues provider-prefixed subs (`google:1234…`, `email:user@…`);
    // Authentik issues plain stable IDs. Both formats coexist here.
    oidc_sub: text("oidc_sub").notNull(),
    email: citext("email").notNull(),
    // bcrypt hash for the Auth.js Credentials provider. NULL for every user
    // signed in via a social/OIDC path — those rows never run a password check.
    // Set server-side via bcrypt.hash(password, 12); never trust the client.
    password_hash: text("password_hash"),
    first_name: text("first_name").notNull(),
    last_name: text("last_name").notNull(),
    postal_code: text("postal_code"),
    // Opaque token embedded in unsubscribe links — non-enumerable per-user
    // capability that lets the recipient flip a preference without an
    // active session. Rotated on demand by the user; never logged.
    email_token: uuid("email_token").notNull().defaultRandom(),
    // Per-category transactional-email opt-in. Default true for every
    // existing row (the 0005 migration backfills); the helpers gate on these
    // before any Resend send.
    email_new_message_enabled: boolean("email_new_message_enabled").notNull().default(true),
    email_reserved_enabled: boolean("email_reserved_enabled").notNull().default(true),
    email_saved_item_changed_enabled: boolean("email_saved_item_changed_enabled").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_oidc_sub_uq").on(t.oidc_sub),
    uniqueIndex("users_email_uq").on(t.email),
    uniqueIndex("users_email_token_uq").on(t.email_token),
  ],
);

/**
 * categories — the 40-row seed defines the leaf taxonomy users tag listings
 * with. `parent_slug` groups them into the 10 top-level filters shown on the
 * landing category strip (Tools / Skills / Kitchen / Wheels / Garden / Studio
 * / Lessons / Services / Edibles / Sports / Kids / Apparel / Free).
 *
 * Read-cache friendly: rows rarely change post-seed (24h cache in the API).
 * `display_order` is the stable sort key.
 */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    parent_slug: text("parent_slug"),
    icon: text("icon"),
    display_order: integer("display_order").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("categories_slug_uq").on(t.slug),
    index("categories_parent_slug_idx").on(t.parent_slug),
    index("categories_display_order_idx").on(t.display_order),
  ],
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
    // Nullable since migration 0007 — non-trade listings (gift/rent/hire/sell)
    // don't supply a "wants in return" line. Stays non-null for trade rows,
    // enforced by the API's Zod superRefine, not by SQL.
    exchange: text("exchange"),
    description: text("description").notNull(),
    rate_type: text("rate_type"),
    img_key: text("img_key"), // R2 object key; URL is composed at read time
    img_hash: text("img_hash"), // sha256 hex of the image bytes (dedup)
    reserved: boolean("reserved").notNull().default(false),
    reserved_by: uuid("reserved_by").references(() => users.id, { onDelete: "set null" }),
    reserved_at: timestamp("reserved_at", { withTimezone: true }),
    // Soft delete — NULL = active listing, non-NULL = archived. The 0002
    // migration also adds a partial index on the active subset so
    // `WHERE archived_at IS NULL` reads stay cheap as the archived tail grows.
    archived_at: timestamp("archived_at", { withTimezone: true }),
    // Generated tsvector for FTS — finalized in a manual migration so weights stick.
    search: tsvector("search"),
    // ─── Listing taxonomy (0007) ───
    // Default 'trade' in SQL so every existing row stays a trade listing
    // without a backfill. Immutable post-create at the API layer.
    listing_type: listingTypeEnum("listing_type").notNull().default("trade"),
    // Paid types (rent/hire/sell) carry price in cents-CAD. SQL CHECK enforces
    // "paid type ⇔ price_cents non-null" so a misconfigured client can't ship
    // a free rent listing or a priced gift.
    price_cents: integer("price_cents"),
    price_unit: priceUnitEnum("price_unit"),
    deposit_cents: integer("deposit_cents"),
    condition: itemConditionEnum("condition"),
    available_from: timestamp("available_from", { withTimezone: true }),
    available_to: timestamp("available_to", { withTimezone: true }),
    location_lat: numeric("location_lat", { precision: 9, scale: 6 }),
    location_lng: numeric("location_lng", { precision: 9, scale: 6 }),
    location_precision: locationPrecisionEnum("location_precision"),
    category_id: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    // ─── Timestamps ───
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("exchange_items_user_id_idx").on(t.user_id),
    index("exchange_items_reserved_idx").on(t.reserved),
    // GIN index on `search` added in a manual migration.
    // listing_type / category / price / location indexes live in migration
    // 0007 SQL with `WHERE archived_at IS NULL` predicates that drizzle-kit
    // can't currently express.
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

/**
 * conversations — a chat thread tied to ONE exchange_item and started
 * by exactly ONE non-owner. The listing owner is derivable from
 * `exchange_items.user_id`; we don't denormalise it here to keep a
 * single source of truth.
 *
 * UNIQUE (item_id, initiator_id) means a prospective party never has
 * more than one thread per item — POSTing "start a conversation"
 * twice from the same user produces the same row both times.
 */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    item_id: uuid("item_id")
      .notNull()
      .references(() => exchangeItems.id, { onDelete: "cascade" }),
    initiator_id: uuid("initiator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Updated on every message send — drives the "most-recent thread first"
    // ordering on the list view without needing a subquery.
    last_message_at: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    // Per-participant "last seen" timestamp. Used by the email-on-new-message
    // helper to suppress notifications when the recipient is actively engaged.
    // NULL = "never opened the thread"; receiver still gets an email.
    initiator_last_read_at: timestamp("initiator_last_read_at", { withTimezone: true }),
    owner_last_read_at: timestamp("owner_last_read_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("conversations_item_initiator_uq").on(t.item_id, t.initiator_id),
    index("conversations_initiator_idx").on(t.initiator_id, t.last_message_at),
    index("conversations_item_idx").on(t.item_id),
  ],
);

/**
 * messages — append-only log of message bodies in a conversation.
 * `sender_id` is one of the two participants; we validate that at the
 * API layer rather than via a SQL constraint (would require a
 * trigger or CHECK with a subquery and Postgres won't let you).
 *
 * Body length cap of 4000 chars matches the listing description cap;
 * the migration enforces it via a CHECK constraint at the SQL layer.
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversation_id: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    sender_id: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // (conversation_id, created_at desc, id desc) — supports the
    // chat-pagination query (newest first) directly without a sort step.
    index("messages_conversation_idx").on(t.conversation_id, t.created_at, t.id),
  ],
);

/**
 * bookings — the time-range reservation table for rent/hire/sell.
 *
 * The load-bearing invariant lives in SQL: a partial `EXCLUDE USING gist`
 * constraint that makes overlapping bookings on the same item impossible
 * while a booking holds an "active" claim (requested/confirmed/active).
 * Drizzle can't express EXCLUDE constraints, so the constraint is defined
 * in migration 0008_0001_bookings.sql and trusted at the application layer.
 *
 * `provider_id` is denormalised from `exchange_items.user_id` so the
 * "my incoming bookings" query is a single index seek instead of a join.
 * Trade-off accepted because providers don't change on listings.
 *
 * Money is stored in cents-CAD per the Toronto launch decision. Stripe
 * linkage columns are placeholders here; PR 4 fills them in.
 */
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    item_id: uuid("item_id")
      .notNull()
      .references(() => exchangeItems.id, { onDelete: "restrict" }),
    renter_id: uuid("renter_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    provider_id: uuid("provider_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: bookingStatusEnum("status").notNull().default("requested"),
    // Nullable for sell purchases (instantaneous); paired by the
    // `bookings_date_pair` CHECK constraint — both NULL or both non-null.
    start_at: timestamp("start_at", { withTimezone: true }),
    end_at: timestamp("end_at", { withTimezone: true }),
    // Pricing snapshot — immutable post-create. price_unit is nullable
    // because sells are implicitly "fixed" and don't carry the field.
    price_cents: integer("price_cents").notNull(),
    price_unit: priceUnitEnum("price_unit"),
    quantity: integer("quantity").notNull().default(1),
    subtotal_cents: integer("subtotal_cents").notNull(),
    platform_fee_cents: integer("platform_fee_cents").notNull(),
    // Set at Stripe capture time in PR 4; nullable here.
    stripe_fee_cents: integer("stripe_fee_cents"),
    deposit_cents: integer("deposit_cents").notNull().default(0),
    total_cents: integer("total_cents").notNull(),
    currency: text("currency").notNull().default("CAD"),
    // Stripe placeholders — PR 4 wires the actual Stripe calls.
    stripe_payment_intent_id: text("stripe_payment_intent_id"),
    stripe_charge_id: text("stripe_charge_id"),
    stripe_transfer_id: text("stripe_transfer_id"),
    // Notes / reasons
    message_to_provider: text("message_to_provider"),
    decline_reason: text("decline_reason"),
    cancel_reason: text("cancel_reason"),
    cancelled_by: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    // Lifecycle — each transition sets one
    requested_at: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    confirmed_at: timestamp("confirmed_at", { withTimezone: true }),
    active_at: timestamp("active_at", { withTimezone: true }),
    returned_at: timestamp("returned_at", { withTimezone: true }),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    declined_at: timestamp("declined_at", { withTimezone: true }),
    cancelled_at: timestamp("cancelled_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    // Listing indexes live in migration 0008 SQL because they use partial
    // WHERE predicates that drizzle-kit can't currently express.
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type ExchangeItemRow = typeof exchangeItems.$inferSelect;
export type NewExchangeItemRow = typeof exchangeItems.$inferInsert;
export type ExchangeItemSaveRow = typeof exchangeItemSaves.$inferSelect;
export type NewExchangeItemSaveRow = typeof exchangeItemSaves.$inferInsert;
export type ConversationRow = typeof conversations.$inferSelect;
export type NewConversationRow = typeof conversations.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
export type BookingRow = typeof bookings.$inferSelect;
export type NewBookingRow = typeof bookings.$inferInsert;

// Re-export sql for callers that want to reach for it from one place.
export { sql };
