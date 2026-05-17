"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError } from "../../../lib/api";

export type SaveActionResult =
  | { ok: true; saved: boolean }
  | { ok: false; error: string };

/**
 * Toggle the authenticated viewer's save state for an item.
 *
 * `currentlySaved` is passed by the button so the action knows which API
 * call to make (save vs unsave). The boolean is sent via a hidden form
 * input — that way the user's click intent is preserved even across slow
 * networks: a click on "Saved" always *un*-saves, never the other way
 * around. Reading freshness from the server first would race the click.
 *
 * Idempotency key is generated per invocation. The API endpoints are
 * idempotent at the SQL layer (INSERT ON CONFLICT DO NOTHING / DELETE
 * matching nothing returns 200), so a retry produces the same end state.
 *
 * Revalidates both the detail page and the saves listing so the UI
 * reflects the change on the very next render.
 */
export async function toggleSaveAction(
  itemId: string,
  currentlySaved: boolean,
): Promise<SaveActionResult> {
  try {
    const idemKey = randomUUID();
    const result = currentlySaved
      ? await api.unsaveItem(itemId, idemKey)
      : await api.saveItem(itemId, idemKey);
    revalidatePath(`/items/${itemId}`);
    revalidatePath("/saved");
    return { ok: true, saved: result.saved };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      redirect(`/login?callbackUrl=${encodeURIComponent(`/items/${itemId}`)}`);
    }
    if (err instanceof ApiError && err.status === 404) {
      return { ok: false, error: "This item no longer exists." };
    }
    if (err instanceof ApiError) {
      return { ok: false, error: err.problem.title ?? `Save failed (${err.status})` };
    }
    return { ok: false, error: "Network error — try again." };
  }
}
