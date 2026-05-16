"use server";

import { revalidatePath } from "next/cache";
import { api } from "../../../lib/api";

const VALID_CATEGORIES = new Set(["new_message", "reserved", "saved_item_changed"]);

/**
 * Flip one email preference for the authenticated user. The form passes
 * the target boolean directly (computed from the current state in the
 * server-rendered page) so the action is a pure write, not a toggle —
 * makes it safe to retry without flipping twice.
 */
export async function setEmailPrefAction(form: FormData): Promise<void> {
  const category = String(form.get("category") ?? "");
  const value = String(form.get("value") ?? "");
  if (!VALID_CATEGORIES.has(category)) return;
  const enabled = value === "true";
  await api.updateEmailPrefs({ [category]: enabled } as Record<string, boolean>);
  revalidatePath("/settings/notifications");
}
