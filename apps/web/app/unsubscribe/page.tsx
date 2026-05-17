import { Button, Card, CardContent } from "@esharevice/ui";
import { unsubscribeAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Public unsubscribe confirmation page. Reached by every email's footer link
 * with `?token=<uuid>&c=<category>`. We deliberately do NOT flip the
 * preference on GET — link previews, security scanners, and prefetchers
 * would otherwise unsubscribe users by accident. Instead, render a one-button
 * confirmation form; the user's submit POSTs to the API.
 */
type SearchParams = Promise<{ token?: string; c?: string; ok?: string; err?: string }>;

const CATEGORY_LABELS: Record<string, string> = {
  new_message: "new-message notifications",
  reserved: "listing reservation notifications",
  saved_item_changed: "saved-item update notifications",
};

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<React.ReactElement> {
  const sp = await searchParams;
  const token = sp.token ?? "";
  const category = sp.c ?? "";
  const label = CATEGORY_LABELS[category] ?? "these emails";
  const tokenLooksValid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    token,
  );
  const categoryValid = category in CATEGORY_LABELS;

  if (!tokenLooksValid || !categoryValid) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <Card>
          <CardContent>
            <h1 className="mb-2 text-xl font-bold">Invalid unsubscribe link</h1>
            <p className="text-sm text-fg-muted">
              This link doesn&apos;t look right. If you got it from a recent
              e-Sharevice email, try copying the URL from the original message
              again — sometimes mail clients break long links on paste.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (sp.ok === "1") {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <Card>
          <CardContent>
            <h1 className="mb-2 text-xl font-bold">You&apos;re unsubscribed.</h1>
            <p className="text-sm text-fg-muted">
              You won&apos;t receive any more {label} from e-Sharevice. You can
              re-enable them anytime from{" "}
              <a className="text-brand underline" href="/settings/notifications">
                your notification settings
              </a>
              .
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <Card>
        <CardContent>
          <h1 className="mb-2 text-xl font-bold">Unsubscribe from {label}?</h1>
          <p className="mb-4 text-sm text-fg-muted">
            Click the button below to stop receiving {label} from e-Sharevice.
            You can always re-enable them later from your notification settings.
          </p>
          {sp.err && (
            <p role="alert" className="mb-3 text-xs text-danger">
              Couldn&apos;t process unsubscribe right now. Try again, or sign in
              and use{" "}
              <a className="underline" href="/settings/notifications">
                notification settings
              </a>{" "}
              instead.
            </p>
          )}
          <form action={unsubscribeAction}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="category" value={category} />
            <Button type="submit" variant="brand" size="md">
              Confirm unsubscribe
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
