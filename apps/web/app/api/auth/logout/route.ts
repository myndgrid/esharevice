import { type NextRequest, NextResponse } from "next/server";
import { getAuthServer } from "../../../../lib/oidc";
import { clearSessionCookie, readSession } from "../../../../lib/session";
import { getEnv } from "../../../../lib/env";

export const dynamic = "force-dynamic";

/**
 * Two-stage logout:
 *  1. Clear our session cookie (immediate, local).
 *  2. Redirect to Authentik's end_session_endpoint with id_token_hint so
 *     Authentik also clears its SSO cookie. If Authentik returns a
 *     post_logout_redirect_uri we end up back at the app's home.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await readSession();
  await clearSessionCookie();

  const as = await getAuthServer();
  if (!as.end_session_endpoint || !session?.id_token) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }

  const logoutUrl = new URL(as.end_session_endpoint);
  logoutUrl.searchParams.set("id_token_hint", session.id_token);
  logoutUrl.searchParams.set("client_id", getEnv().OIDC_CLIENT_ID);
  logoutUrl.searchParams.set("post_logout_redirect_uri", new URL("/", req.nextUrl.origin).toString());
  return NextResponse.redirect(logoutUrl);
}
