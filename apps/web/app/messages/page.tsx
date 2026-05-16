import Link from "next/link";
import { Card, CardContent } from "@esharevice/ui";
import type { Conversation } from "@esharevice/shared";
import { api, ApiError } from "../../lib/api";
import { requireAuth } from "../../lib/auth";

export const dynamic = "force-dynamic";

export default async function MessagesPage(): Promise<React.ReactElement> {
  await requireAuth("/messages");

  let conversations: Conversation[] = [];
  let error: string | null = null;
  try {
    const page = await api.listConversations({ limit: 50 });
    conversations = page.items;
  } catch (err) {
    error =
      err instanceof ApiError
        ? `${err.problem.title ?? "Request failed"} (${err.status})`
        : "Network error";
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <header className="mb-6 grid gap-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Messages</h1>
        <p className="text-sm text-fg-muted">
          Direct conversations about specific listings, between you and another member.
        </p>
      </header>

      {error ? (
        <Card>
          <CardContent>
            <p className="text-sm text-fg-muted">
              Couldn&apos;t load messages: <span className="text-danger">{error}</span>
            </p>
          </CardContent>
        </Card>
      ) : conversations.length === 0 ? (
        <Card>
          <CardContent>
            <p className="text-sm text-fg-muted">
              No conversations yet. Open any item&apos;s detail page and tap{" "}
              <span className="font-medium text-fg">Message owner</span> to start one.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {conversations.map((c) => {
            const unread = c.unread_count > 0;
            return (
              <li key={c.id}>
                <Link
                  href={`/messages/${c.id}`}
                  aria-label={
                    unread
                      ? `${c.other_party_name}, ${c.unread_count} unread ${c.unread_count === 1 ? "message" : "messages"}`
                      : undefined
                  }
                  className="block rounded-lg outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  <Card>
                    <CardContent>
                      <div className="mb-1 flex items-baseline justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <h2 className={"truncate text-base tracking-tight " + (unread ? "font-bold text-fg" : "font-semibold")}>
                            {c.other_party_name}
                          </h2>
                          {unread && (
                            <span
                              aria-hidden
                              className="inline-flex h-[18px] min-w-[18px] flex-shrink-0 items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-semibold leading-none text-white"
                            >
                              {c.unread_count > 9 ? "9+" : c.unread_count}
                            </span>
                          )}
                        </div>
                        <time className="text-xs text-fg-subtle">{formatTime(c.last_message_at)}</time>
                      </div>
                      <p className="mb-1 text-xs text-fg-subtle">about &quot;{c.item_service}&quot;</p>
                      <p className={"line-clamp-2 text-sm " + (unread ? "font-medium text-fg" : "text-fg-muted")}>
                        {c.last_message_preview ?? "(no messages yet — say hello)"}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
