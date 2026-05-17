"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@esharevice/ui";
import { Message } from "@esharevice/shared";
import {
  fetchMessagesAfterAction,
  markConversationReadAction,
  sendMessageAction,
} from "./actions";

/**
 * Polling kicks in only when SSE is unavailable (network, intermediary,
 * 401). 30 s is sloppy enough to be a fallback without flooding the API.
 */
const FALLBACK_POLL_INTERVAL_MS = 30_000;
const MAX_BODY = 4000;

/**
 * Conversation view — message list + composer. The server renders the
 * initial message list; this component takes over after hydration and
 * polls for new messages every 5 s while the page is open.
 *
 * Optimistic send: a new outgoing message renders immediately with a
 * `pending` flag; once the API confirms, the optimistic row is replaced
 * with the canonical one. On failure we surface an inline retry hint
 * without dropping the typed body.
 */
export function ConversationView({
  conversationId,
  meId,
  initialMessages,
}: {
  conversationId: string;
  meId: string;
  initialMessages: Message[];
}): React.ReactElement {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll-to-bottom on first paint + on every new message append.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Primary live channel: SSE through the same-origin proxy at
  // /api/messages/:id/events. EventSource handles reconnect on its own
  // (browser-managed exponential backoff). Whenever the connection
  // opens or re-opens we fire a single catch-up fetch with a
  // tail-cursor so anything that arrived during a disconnect lands in
  // the list before the next live event.
  //
  // Polling stays around as a fallback: if EventSource never reaches
  // `OPEN` (network blocks SSE, intermediary buffers, etc.) we still
  // catch up every 30 s. When SSE is healthy this is dormant.
  useEffect(() => {
    let stopped = false;
    let sse: EventSource | null = null;

    const catchUp = async () => {
      if (stopped) return;
      try {
        const tail = messages[messages.length - 1];
        const cursor = tail
          ? btoa(JSON.stringify({ ts: tail.created_at, id: tail.id }))
          : null;
        const fresh = await fetchMessagesAfterAction(conversationId, cursor);
        if (stopped) return;
        if (fresh.length > 0) setMessages((prev) => mergeNew(prev, fresh));
      } catch {
        /* transient — next tick / next event will retry */
      }
    };

    try {
      sse = new EventSource(`/api/messages/${conversationId}/events`);
      sse.addEventListener("ready", () => {
        // Server confirmed the stream is open. Catch up on anything that
        // arrived between page-render and SSE-open (rare race).
        void catchUp();
        // Mark read — viewer is now actively engaged on this thread.
        // Suppression window on the API side prevents email-on-new-message
        // for the recipient who's looking at the thread right now.
        void markConversationReadAction(conversationId);
      });
      sse.addEventListener("message", (e) => {
        try {
          const parsed = Message.parse(JSON.parse((e as MessageEvent<string>).data));
          setMessages((prev) => mergeNew(prev, [parsed]));
          // Keep the read timestamp warm — every incoming message reset
          // the recipient's "actively viewing" window. Sender's own
          // message doesn't need this (the API marks the sender as read
          // on insert), but the cheapest correct thing is to fire
          // unconditionally; the suppression check is server-side.
          if (parsed.sender_id !== meId) {
            void markConversationReadAction(conversationId);
          }
        } catch {
          /* malformed event — ignore */
        }
      });
      // EventSource emits 'error' on both transient and terminal failures.
      // The browser retries automatically; we don't need to do anything.
    } catch {
      /* EventSource unavailable — fall through to the poll fallback. */
    }

    const fallbackTick = setInterval(catchUp, FALLBACK_POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(fallbackTick);
      if (sse) sse.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const trimmed = body.trim();
      if (!trimmed || sending) return;
      setSending(true);
      setError(null);
      // Optimistic insert — a temp message that gets replaced when the
      // server response lands. tempId is a stable client-side UUID so
      // the dedup in mergeNew works.
      const tempId = crypto.randomUUID();
      const optimistic: Message = {
        id: tempId,
        conversation_id: conversationId,
        sender_id: meId,
        body: trimmed,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
      setBody("");
      try {
        const real = await sendMessageAction(conversationId, trimmed, tempId);
        // Replace the optimistic row with the real one (same tempId is the
        // idempotency key, but the returned `id` is the real DB UUID).
        setMessages((prev) => prev.map((m) => (m.id === tempId ? real : m)));
      } catch (err) {
        // Roll back the optimistic message + restore the typed body.
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setBody(trimmed);
        setError(err instanceof Error ? err.message : "Network error — try again.");
      } finally {
        setSending(false);
      }
    },
    [body, conversationId, meId, sending],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={listRef} className="flex-1 overflow-y-auto px-1 py-2">
        {messages.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-fg-muted">
            No messages yet. Say hello.
          </p>
        ) : (
          // role="log" + aria-live="polite" so screen readers announce
          // new messages as they arrive via SSE. "polite" (not "assertive")
          // means announcements wait for any in-progress speech to finish,
          // avoiding interrupting the user mid-read.
          <ul
            className="grid gap-2 px-2 pb-2"
            role="log"
            aria-live="polite"
            aria-label="Conversation messages"
          >
            {messages.map((m) => (
              <li
                key={m.id}
                className={`flex ${m.sender_id === meId ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={
                    "max-w-[80%] rounded-2xl px-3 py-2 text-sm " +
                    (m.sender_id === meId
                      ? "bg-brand text-brand-fg"
                      : "bg-bg-subtle text-fg")
                  }
                >
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p
                    className={
                      "mt-1 text-[10px] " +
                      (m.sender_id === meId ? "text-brand-fg/75" : "text-fg-subtle")
                    }
                  >
                    {formatTime(m.created_at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={onSubmit} className="border-t border-border px-3 py-3">
        {error && (
          <p role="alert" className="mb-2 text-xs text-danger">
            {error}
          </p>
        )}
        <div className="flex items-end gap-2">
          <label htmlFor="conversation-body" className="sr-only">
            Message
          </label>
          <textarea
            id="conversation-body"
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter inserts a newline.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            rows={1}
            placeholder="Type a message…"
            maxLength={MAX_BODY}
            className="min-h-10 max-h-32 flex-1 resize-y rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-brand focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-bg"
          />
          {/*
            Keep the "Send" text stable across pending/idle so screen
            readers don't hear "…" announced. aria-busy signals the
            in-progress state instead.
          */}
          <Button
            type="submit"
            variant="brand"
            size="sm"
            disabled={sending || body.trim().length === 0}
            aria-busy={sending}
          >
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * Append-only merge that drops messages already in the list (by id).
 * Server-side `id`s win when a client tempId collides with a real id —
 * we never see that in practice since the tempId path replaces the
 * optimistic row separately, but the dedup keeps the polling loop from
 * accidentally duplicating an already-delivered message.
 */
function mergeNew(prev: Message[], incoming: Message[]): Message[] {
  const seen = new Set(prev.map((m) => m.id));
  const fresh = incoming.filter((m) => !seen.has(m.id));
  if (fresh.length === 0) return prev;
  return [...prev, ...fresh];
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
