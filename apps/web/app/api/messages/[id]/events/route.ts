import { type NextRequest } from "next/server";
import { auth } from "../../../../../lib/auth";
import { getEnv } from "../../../../../lib/env";

/**
 * Same-origin proxy for the conversation SSE stream.
 *
 * EventSource can't set request headers (the browser builds the request
 * itself), so a direct connect from the browser to api.esharevice.com
 * has no way to send our `Authorization: Bearer …` header. We work
 * around that by streaming through this route: the browser hits the
 * same-origin proxy with its session cookie, the proxy resolves the
 * access token server-side via `auth()`, opens the upstream SSE
 * connection with the bearer header, and pipes the response body back.
 *
 * The upstream heartbeats every 25 s; that traffic flows through here
 * unchanged, so the browser's connection stays warm past any proxy
 * idle timeout.
 *
 * Cleanup: when the client disconnects, undici's TCP cancel propagates
 * up through the AbortController to the upstream fetch — the API's
 * `stream.onAbort` then resolves and the EventEmitter listener +
 * heartbeat interval are released. No bookkeeping needed here.
 */
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.access_token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await ctx.params;
  const apiBase = getEnv().NEXT_PUBLIC_API_URL;

  const controller = new AbortController();
  // If the browser closes the EventSource, Next aborts the request — we
  // forward that to the upstream fetch.
  req.signal.addEventListener("abort", () => controller.abort());

  const upstream = await fetch(`${apiBase}/v1/conversations/${id}/events`, {
    method: "GET",
    headers: {
      accept: "text/event-stream",
      authorization: `Bearer ${session.access_token}`,
    },
    signal: controller.signal,
    // No buffering / caching on either side of the proxy hop.
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    return new Response(`upstream ${upstream.status}`, { status: upstream.status });
  }

  // Wrap the upstream body so that undici's "other side closed" / "terminated"
  // errors during an upstream restart don't bubble into Next's response-piping
  // layer (which would surface as `Error: failed to pipe response` in Sentry).
  // These signatures are EXPECTED when the API container is force-recreated
  // mid-stream — EventSource on the client will auto-reconnect. We close the
  // stream cleanly instead of raising, and report unfamiliar errors so a real
  // regression still shows up.
  const reader = upstream.body.getReader();
  const passthrough = new ReadableStream<Uint8Array>({
    async pull(c) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          c.close();
          return;
        }
        c.enqueue(value);
      } catch (err) {
        if (isExpectedUpstreamClose(err)) {
          c.close();
          return;
        }
        c.error(err);
      }
    },
    cancel(reason) {
      controller.abort(reason);
      // Best-effort release; errors here are intentionally ignored — the
      // upstream has already been told to abort.
      reader.cancel(reason).catch(() => {});
    },
  });

  return new Response(passthrough, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      // Tell every layer between us and the browser not to buffer this.
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}

/**
 * Match the undici/Node disconnect signatures we expect when the upstream
 * SSE peer goes away (deploy restart, container kill, network blip). These
 * are never bugs — we want to drop the stream cleanly so the EventSource
 * client reconnects on its own without polluting Sentry.
 */
function isExpectedUpstreamClose(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // SocketError: "other side closed"
  if (err.name === "SocketError") return true;
  // TypeError: "terminated" — undici's wrapper when the fetch is aborted by
  // upstream socket close.
  if (err.name === "TypeError" && err.message === "terminated") return true;
  // AbortError fires when the client disconnected; expected.
  if (err.name === "AbortError") return true;
  return false;
}
