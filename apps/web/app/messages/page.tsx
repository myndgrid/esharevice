import { Card, CardContent } from "@esharevice/ui";
import { requireAuth } from "../../lib/auth";

export const dynamic = "force-dynamic";

export default async function MessagesPage(): Promise<React.ReactElement> {
  await requireAuth("/messages");

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <header className="mb-6 grid gap-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Messages</h1>
        <p className="text-sm text-fg-muted">
          Direct messages between exchange partners. Coming soon — needs the conversations/messages API
          and live updates over Server-Sent Events.
        </p>
      </header>
      <Card>
        <CardContent>
          <p className="text-sm text-fg-muted">No conversations yet.</p>
        </CardContent>
      </Card>
    </main>
  );
}
