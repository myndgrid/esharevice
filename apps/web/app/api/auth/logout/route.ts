import { NextResponse } from "next/server";
import { getAuthServer } from "../../../../lib/oidc";
import {
  clearAccessCookieOn,
  clearSessionCookieOn,
  readSession,
} from "../../../../lib/session";
import { getEnv, getPublicOrigin } from "../../../../lib/env";

export const dynamic = "force-dynamic";

/**
 * Two-stage logout:
 *  1. Clear our session cookie (immediate, local).
 *  2. Redirect to Authentik's end_session_endpoint with id_token_hint so
 *     Authentik also clears its SSO cookie. If Authentik returns a
 *     post_logout_redirect_uri we end up back at the app's home.
 *
 * POST-only: Next 15's <Link> prefetches GET responses, and Set-Cookie
 * headers from a prefetch are applied to the browser. A GET logout
 * handler silently signs users out as soon as any page mounts a
 * <Link href="/api/auth/logout"> in the viewport — even if they never
 * click it. State-changing endpoints must not be reachable via GET.
 */
export async function POST(): Promise<NextResponse> {
  const publicOrigin = getPublicOrigin();
  const session = await readSession();

  const as = await getAuthServer();

  let targetUrl: URL;
  if (!as.end_session_endpoint || !session?.id_token) {
    targetUrl = new URL("/", publicOrigin);
  } else {
    targetUrl = new URL(as.end_session_endpoint);
    targetUrl.searchParams.set("id_token_hint", session.id_token);
    targetUrl.searchParams.set("client_id", getEnv().OIDC_CLIENT_ID);
    targetUrl.searchParams.set(
      "post_logout_redirect_uri",
      new URL("/", publicOrigin).toString(),
    );
  }

  const response = NextResponse.redirect(targetUrl);
  clearSessionCookieOn(response);
  clearAccessCookieOn(response);
  return response;
}
