"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError } from "../../../lib/api";

export type ReserveActionState = { ok: false; error: string } | { ok: true };

/**
 * Reserve a single exchange item. Server-action so it runs after a
 * `<form method="post">` submit — keeps state-changing operations off
 * idempotent GET (the same rule that bit us with the logout link).
 *
 * The Idempotency-Key is generated server-side per invocation. A user
 * clicking "Reserve" twice in 200 ms might still send two requests but
 * each carries a fresh key, so each one truly attempts the operation
 * (the API's race-safe UPDATE makes only one succeed). That matches the
 * user's mental model: clicking twice doesn't double-attempt anything
 * surprising; it just means the second click sees the "already reserved"
 * banner faster.
 */
export async function reserveAction(
  itemId: string,
  _prev: ReserveActionState,
): Promise<ReserveActionState> {
  try {
    await api.reserveExchangeItem(itemId, randomUUID());
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        // Session expired — send through the login round-trip and come back.
        redirect(`/login?callbackUrl=${encodeURIComponent(`/items/${itemId}`)}`);
      }
      return { ok: false, error: err.problem.title ?? `Reserve failed (${err.status})` };
    }
    return { ok: false, error: "Network error while reserving — try again." };
  }
  // Drop the per-request server cache so the detail page re-fetches and
  // shows the new "reserved" badge on the next render.
  revalidatePath(`/items/${itemId}`);
  redirect(`/items/${itemId}`);
}
