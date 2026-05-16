"use server";

import { redirect } from "next/navigation";
import { api, ApiError } from "../../lib/api";

/**
 * Confirm-unsubscribe server action. Posts the token + category to the
 * public API and redirects back to the page with `?ok=1` so we can render
 * a confirmation. On error, redirect with `?err=1` so the page surfaces
 * an inline retry hint without losing the token in the URL bar.
 */
export async function unsubscribeAction(form: FormData): Promise<void> {
  const token = String(form.get("token") ?? "");
  const category = String(form.get("category") ?? "");
  try {
    await api.unsubscribeEmail(token, category);
  } catch (err) {
    const code = err instanceof ApiError ? err.status : 0;
    // 404 = stale/invalid token. Surface as "ok" too — it's UX-equivalent
    // (the user has nothing to unsubscribe from with this token).
    if (code === 404) {
      redirect(
        `/unsubscribe?token=${encodeURIComponent(token)}&c=${encodeURIComponent(category)}&ok=1`,
      );
    }
    redirect(
      `/unsubscribe?token=${encodeURIComponent(token)}&c=${encodeURIComponent(category)}&err=1`,
    );
  }
  redirect(
    `/unsubscribe?token=${encodeURIComponent(token)}&c=${encodeURIComponent(category)}&ok=1`,
  );
}
