import { EventEmitter } from "node:events";
import type { Message } from "@esharevice/shared";

/**
 * In-process pub/sub for newly-sent messages.
 *
 * One emitter per conversation_id, lazily created on first subscribe.
 * The SSE route subscribes; the POST /messages handler publishes after
 * a successful insert. Each subscriber gets a callback per event.
 *
 * Single-instance design: this works because we run ONE api container.
 * If we ever scale to multiple replicas, the obvious migration is
 * Redis pub/sub on `messages:<conversation_id>` channels — same
 * publish/subscribe shape, network instead of intra-process.
 *
 * Subscribers MUST call the returned cleanup function on disconnect or
 * the EventEmitter accumulates listeners (and Node warns at >10).
 */
const emitter = new EventEmitter();
// Lift the listener cap — a popular thread could legitimately have
// many subscribers in parallel (one per open browser tab).
emitter.setMaxListeners(200);

function channel(conversationId: string): string {
  return `msg:${conversationId}`;
}

export function publishMessage(conversationId: string, message: Message): void {
  emitter.emit(channel(conversationId), message);
}

export function subscribeToConversation(
  conversationId: string,
  onMessage: (m: Message) => void,
): () => void {
  const ch = channel(conversationId);
  emitter.on(ch, onMessage);
  return () => {
    emitter.off(ch, onMessage);
  };
}
