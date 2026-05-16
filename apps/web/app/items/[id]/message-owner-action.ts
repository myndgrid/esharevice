"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { api, ApiError } from "../../../lib/api";

/**
 * Start (or find) the conversation between the viewer and the owner of
 * an item. UNIQUE (item_id, initiator_id) at the SQL layer makes this
 * idempotent — re-submitting lands on the same conversation page.
 */
export async function startConversationAction(itemId: string): Promise<void> {
  let convId: string;
  try {
    const conv = await api.startConversation(itemId, randomUUID());
    convId = conv.id;
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        redirect(`/api/auth/login?return_to=${encodeURIComponent(`/items/${itemId}`)}`);
      }
      if (err.status === 403) {
        // Owner clicked their own button somehow. Bounce silently.
        redirect(`/items/${itemId}`);
      }
      if (err.status === 404) {
        redirect("/");
      }
    }
    throw err;
  }
  redirect(`/messages/${convId}`);
}
