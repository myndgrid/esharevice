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
    // Soft delete — NULL = active listing, non-NULL = archived. The 0002
    // migration also adds a partial index on the active subset so
    // `WHERE archived_at IS NULL` reads stay cheap as the archived tail grows.
    archived_at: timestamp("archived_at", { withTimezone: true }),
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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ExchangeItemRow = typeof exchangeItems.$inferSelect;
export type NewExchangeItemRow = typeof exchangeItems.$inferInsert;
export type ExchangeItemSaveRow = typeof exchangeItemSaves.$inferSelect;
export type NewExchangeItemSaveRow = typeof exchangeItemSaves.$inferInsert;
export type ConversationRow = typeof conversations.$inferSelect;
export type NewConversationRow = typeof conversations.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;

// Re-export sql for callers that want to reach for it from one place.
export { sql };
