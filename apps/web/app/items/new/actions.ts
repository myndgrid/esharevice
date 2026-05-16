"use server";

import { redirect } from "next/navigation";
import { ExchangeItemCreate } from "@esharevice/shared";
import { api, ApiError } from "../../../lib/api";

/**
 * State surfaced back to the form on validation / network failure. `ok: true`
 * paths redirect server-side; the form only ever sees `ok: false` here.
 */
export type CreateItemFormState =
  | { ok: false; fieldErrors?: Record<string, string[]>; formError?: string }
  | { ok: true; id: string };

/** Single combined field+image submission. Runs server-side; never reaches the browser. */
export async function createItemAction(
  _prev: CreateItemFormState,
  formData: FormData,
): Promise<CreateItemFormState> {
  // Client-generated idempotency key — survives client retries. Re-using the
  // same FormData hidden input means a duplicate submit replays the cached
  // response without recreating the row.
  const idempotencyKey = String(formData.get("idempotency_key") ?? "");
  if (!idempotencyKey || idempotencyKey.length > 255) {
    return { ok: false, formError: "Missing idempotency key — refresh and try again." };
  }

  // 1. Validate the structured fields with the shared Zod schema.
  const parsed = ExchangeItemCreate.safeParse({
    provider: formData.get("provider"),
    service: formData.get("service"),
    date: formData.get("date"),
    exchange: formData.get("exchange"),
    description: formData.get("description"),
    rate_type: formData.get("rate_type") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  // 2. Create the row.
  let id: string;
  try {
    const item = await api.createExchangeItem(parsed.data, idempotencyKey);
    id = item.id;
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401) return { ok: false, formError: "Session expired — sign in again." };
      return { ok: false, formError: err.problem.title ?? `Create failed (${err.status})` };
    }
    return { ok: false, formError: "Network error while creating the item." };
  }

  // 3. Optionally upload the image. Separate try/catch so a failed upload
  //    leaves the row in place — user can edit/re-upload from the detail page.
  const file = formData.get("image");
  if (file instanceof File && file.size > 0) {
    try {
      await api.uploadExchangeItemImage(id, file, `${idempotencyKey}-image`);
    } catch (err) {
      // The row exists but the image didn't land. Redirect with a flash hint.
      const reason =
        err instanceof ApiError
          ? `${err.problem.title ?? "upload failed"} (${err.status})`
          : "network error";
      redirect(`/items/${id}?image_error=${encodeURIComponent(reason)}`);
    }
  }

  redirect(`/items/${id}`);
}
