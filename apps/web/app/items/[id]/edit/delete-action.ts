"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError } from "../../../../lib/api";

export type DeleteActionState = { ok: false; error: string } | { ok: true };

/**
 * Soft-delete (archive) an exchange item. Owner-only at both layers — the
 * edit page wouldn't render the button to non-owners, AND the API 403s
 * direct calls.
 *
 * Idempotent: re-running on an already-archived item returns 204 and we
 * just redirect again. randomUUID per invocation so retried clicks all
 * truly attempt the operation (with a SQL-level no-op if already archived).
 *
 * Invalidates the home + saved + detail caches so the archived listing
 * disappears from every view on the next render.
 */
export async function deleteAction(
  itemId: string,
  _prev: DeleteActionState,
): Promise<DeleteActionState> {
  try {
    await api.deleteExchangeItem(itemId, randomUUID());
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        redirect(`/login?callbackUrl=${encodeURIComponent(`/items/${itemId}/edit`)}`);
      }
      if (err.status === 403) return { ok: false, error: "You can only delete your own listings." };
      if (err.status === 404) {
        // Already gone — treat as success, same end state.
        revalidatePath("/");
        revalidatePath("/saved");
        redirect("/");
      }
      return { ok: false, error: err.problem.title ?? `Delete failed (${err.status})` };
    }
    return { ok: false, error: "Network error while deleting — try again." };
  }
  revalidatePath("/");
  revalidatePath("/saved");
  revalidatePath(`/items/${itemId}`);
  redirect("/");
}
