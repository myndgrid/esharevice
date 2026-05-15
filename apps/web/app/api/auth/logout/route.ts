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
 */
export async function GET(): Promise<NextResponse> {
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
