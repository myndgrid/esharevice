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

  return new Response(upstream.body, {
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
