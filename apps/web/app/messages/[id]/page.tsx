import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button, Card, CardContent } from "@esharevice/ui";
import type { Message } from "@esharevice/shared";
import { api, ApiError } from "../../../lib/api";
import { requireAuth } from "../../../lib/auth";
import { ConversationView } from "./conversation-view";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function ConversationPage({ params }: Props): Promise<React.ReactElement> {
  const { id } = await params;
  await requireAuth(`/messages/${id}`);

  let conv;
  try {
    conv = await api.getConversation(id);
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 404) notFound();
      if (err.status === 403) redirect("/messages");
    }
    throw err;
  }

  // Server-side first page so the user sees content immediately. The
  // client component takes over from there, polling every 5 s.
  let initialMessages: Message[];
  try {
    initialMessages = (await api.listMessages(id, { limit: 50 })).items;
  } catch {
    initialMessages = [];
  }

  const me = await api.me();
  const meId = me.id;

  return (
    <main className="mx-auto flex h-[calc(100vh-3.5rem-env(safe-area-inset-bottom))] max-w-2xl flex-col px-4 pb-24 pt-6 md:pb-6">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <div className="grid gap-0.5">
          <h1 className="text-xl font-bold tracking-tight">{conv.other_party_name}</h1>
          <Link
            href={`/items/${conv.item_id}`}
            className="text-xs text-fg-subtle hover:text-fg-muted"
          >
            about &quot;{conv.item_service}&quot; →
          </Link>
        </div>
        <Link href="/messages">
          <Button variant="ghost" size="sm">Back</Button>
        </Link>
      </header>

      <Card className="flex-1 overflow-hidden">
        <CardContent className="flex h-full flex-col p-0">
          <ConversationView
            conversationId={id}
            meId={meId}
            initialMessages={initialMessages}
          />
        </CardContent>
      </Card>
    </main>
  );
}
