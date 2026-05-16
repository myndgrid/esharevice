"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ExchangeItemUpdate } from "@esharevice/shared";
import { api, ApiError } from "../../../../lib/api";

export type EditItemFormState =
  | { ok: false; fieldErrors?: Record<string, string[]>; formError?: string }
  | { ok: true };

/** Update an existing exchange item. Owner-only (gated server-side). */
export async function editItemAction(
  itemId: string,
  _prev: EditItemFormState,
  formData: FormData,
): Promise<EditItemFormState> {
  const idempotencyKey = String(formData.get("idempotency_key") ?? "");
  if (!idempotencyKey || idempotencyKey.length > 255) {
    return { ok: false, formError: "Missing idempotency key — refresh and try again." };
  }

  // Validate the structured fields. All optional in the update schema; the
  // user might have only changed one row.
  const parsed = ExchangeItemUpdate.safeParse({
    provider: takeOrUndefined(formData.get("provider")),
    service: takeOrUndefined(formData.get("service")),
    date: takeOrUndefined(formData.get("date")),
    exchange: takeOrUndefined(formData.get("exchange")),
    description: takeOrUndefined(formData.get("description")),
    rate_type: takeOrUndefined(formData.get("rate_type")),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await api.updateExchangeItem(itemId, parsed.data, idempotencyKey);
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401) return { ok: false, formError: "Session expired — sign in again." };
      if (err.status === 403) {
        return { ok: false, formError: "You can only edit your own listings." };
      }
      if (err.status === 404) {
        return { ok: false, formError: "This listing no longer exists." };
      }
      return { ok: false, formError: err.problem.title ?? `Update failed (${err.status})` };
    }
    return { ok: false, formError: "Network error while updating the item." };
  }

  // Optional image replacement — same pattern as create. Failure leaves the
  // row updated but the image untouched; flash via ?image_error on the
  // detail-page redirect so the user can retry.
  const file = formData.get("image");
  if (file instanceof File && file.size > 0) {
    try {
      const bytes = await file.arrayBuffer();
      const blob = new Blob([bytes], { type: file.type || "application/octet-stream" });
      await api.uploadExchangeItemImage(itemId, blob, file.name || "image", `${idempotencyKey}-image`);
    } catch (err) {
      const reason =
        err instanceof ApiError
          ? `${err.problem.title ?? "upload failed"} (${err.status})`
          : "network error";
      revalidatePath(`/items/${itemId}`);
      redirect(`/items/${itemId}?image_error=${encodeURIComponent(reason)}`);
    }
  }

  revalidatePath(`/items/${itemId}`);
  revalidatePath("/");
  redirect(`/items/${itemId}`);
}

/**
 * FormData.get returns `string | File | null`. For string fields we want
 * empty strings to collapse to `undefined` so they don't accidentally
 * clear a field — the API treats `undefined` (key absent) and an empty
 * string (key present, intentionally cleared) differently.
 */
function takeOrUndefined(v: FormDataEntryValue | null): string | undefined {
  if (typeof v !== "string") return undefined;
  return v.length > 0 ? v : undefined;
}
