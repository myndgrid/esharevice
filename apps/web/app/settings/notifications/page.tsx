import { Card, CardContent } from "@esharevice/ui";
import type { EmailPrefs } from "@esharevice/shared";
import { api, ApiError } from "../../../lib/api";
import { requireAuth } from "../../../lib/auth";
import { setEmailPrefAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Per-category email preferences. Each toggle is a tiny form whose
 * submit-button posts a server action that PATCHes /v1/me/email-prefs
 * with `{ [category]: !currentValue }`. The page is then re-rendered
 * fresh by Next's revalidate-on-action default.
 */
export default async function NotificationSettingsPage(): Promise<React.ReactElement> {
  await requireAuth("/settings/notifications");

  let prefs: EmailPrefs | null = null;
  let error: string | null = null;
  try {
    prefs = await api.getEmailPrefs();
  } catch (err) {
    error =
      err instanceof ApiError
        ? `${err.problem.title ?? "Request failed"} (${err.status})`
        : "Network error";
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <header className="mb-6 grid gap-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Email notifications</h1>
        <p className="text-sm text-fg-muted">
          Choose which transactional emails e-Sharevice sends you. You&apos;ll
          still see in-app updates regardless of these toggles.
        </p>
      </header>

      {error ? (
        <Card>
          <CardContent>
            <p className="text-sm text-fg-muted">
              Couldn&apos;t load preferences: <span className="text-danger">{error}</span>
            </p>
          </CardContent>
        </Card>
      ) : prefs ? (
        <ul className="grid gap-3">
          <PrefRow
            category="new_message"
            title="New message"
            description="Someone sent you a message about a listing."
            enabled={prefs.new_message}
          />
          <PrefRow
            category="reserved"
            title="Reservations"
            description="Someone reserved a listing you posted."
            enabled={prefs.reserved}
          />
          <PrefRow
            category="saved_item_changed"
            title="Saved-item updates"
            description="An item you bookmarked was reserved or removed."
            enabled={prefs.saved_item_changed}
          />
        </ul>
      ) : null}
    </main>
  );
}

/**
 * One row + one form per toggle so each submit is independent. The button
 * label flips based on current state; aria-pressed signals the toggle role
 * to assistive tech (the form-submit-button-as-toggle pattern is a11y-OK
 * as long as the submit clearly describes the resulting state).
 */
function PrefRow({
  category,
  title,
  description,
  enabled,
}: {
  category: "new_message" | "reserved" | "saved_item_changed";
  title: string;
  description: string;
  enabled: boolean;
}): React.ReactElement {
  return (
    <li>
      <Card>
        <CardContent>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight">{title}</h2>
              <p className="text-xs text-fg-muted">{description}</p>
            </div>
            <form action={setEmailPrefAction}>
              <input type="hidden" name="category" value={category} />
              <input type="hidden" name="value" value={enabled ? "false" : "true"} />
              <button
                type="submit"
                aria-pressed={enabled}
                className={
                  "inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg " +
                  (enabled
                    ? "border-brand bg-brand text-brand-fg hover:bg-brand-h"
                    : "border-border bg-bg-subtle text-fg hover:bg-bg-subtle/80")
                }
              >
                {enabled ? "On" : "Off"}
              </button>
            </form>
          </div>
        </CardContent>
      </Card>
    </li>
  );
}
