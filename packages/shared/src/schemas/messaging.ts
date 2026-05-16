import { z } from "zod";

/**
 * Conversation shape returned by the API. The owner is derivable from
 * `item_id`'s row, but we ship the owner_id directly so the web client
 * doesn't need a second round-trip just to know who the "other party"
 * is. `last_message_preview` is a 120-char snippet for the list view.
 */
export const Conversation = z.object({
  id: z.string().uuid(),
  item_id: z.string().uuid(),
  item_service: z.string(),
  initiator_id: z.string().uuid(),
  owner_id: z.string().uuid(),
  other_party_name: z.string(),
  last_message_preview: z.string().nullable(),
  last_message_at: z.string().datetime(),
  created_at: z.string().datetime(),
  /** Messages newer than viewer's last_read_at AND not authored by viewer. */
  unread_count: z.number().int().nonnegative(),
});
export type Conversation = z.infer<typeof Conversation>;

export const Message = z.object({
  id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  sender_id: z.string().uuid(),
  body: z.string().min(1).max(4000),
  created_at: z.string().datetime(),
});
export type Message = z.infer<typeof Message>;

/** Body for POST /v1/conversations/:id/messages. */
export const MessageCreate = z.object({
  body: z.string().min(1).max(4000),
});
export type MessageCreate = z.infer<typeof MessageCreate>;

/**
 * Response for GET /v1/conversations/unread-count.
 *
 * `total` is the count of unread messages across every conversation the
 * viewer participates in — messages newer than their per-conversation
 * `last_read_at` AND not authored by themselves. Drives the badge on the
 * Messages tab.
 */
export const UnreadCount = z.object({
  total: z.number().int().nonnegative(),
});
export type UnreadCount = z.infer<typeof UnreadCount>;
