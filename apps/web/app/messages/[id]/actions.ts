"use server";

import type { Message } from "@esharevice/shared";
import { api } from "../../../lib/api";

/**
 * Server actions for the conversation client component. We can't import
 * `lib/api` directly into the client bundle because it imports
 * `lib/auth` → `lib/session` → `next/headers` (server-only). Wrapping
 * the calls as server actions keeps the auth + access-token plumbing
 * on the server where it belongs while still letting the client poll
 * + send via plain async functions.
 */

export async function fetchMessagesAfterAction(
  conversationId: string,
  cursor: string | null,
): Promise<Message[]> {
  const opts: { cursor?: string; limit: number } = { limit: 50 };
  if (cursor) opts.cursor = cursor;
  const page = await api.listMessages(conversationId, opts);
  return page.items;
}

export async function sendMessageAction(
  conversationId: string,
  body: string,
  idempotencyKey: string,
): Promise<Message> {
  return api.sendMessage(conversationId, { body }, idempotencyKey);
}
