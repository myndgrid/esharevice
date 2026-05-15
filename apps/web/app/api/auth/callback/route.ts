import { type NextRequest, NextResponse } from "next/server";
import * as oauth from "oauth4webapi";
import { getAuthServer, getClient, getClientAuth } from "../../../../lib/oidc";
import { consumeStateCookie, setSessionCookie, type SessionData } from "../../../../lib/session";
import { getEnv } from "../../../../lib/env";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const as = await getAuthServer();
  const client = getClient();
  const clientAuth = getClientAuth();

  const stateData = await consumeStateCookie();
  if (!stateData) {
    return NextResponse.redirect(new URL("/login?error=missing_state", req.nextUrl.origin));
  }

  // Validate the redirect from Authentik (state, code, errors).
  const params = oauth.validateAuthResponse(as, client, req.nextUrl.searchParams, stateData.state);

  // Exchange code → tokens. PKCE verifier is sent here.
  const tokenRes = await oauth.authorizationCodeGrantRequest(
    as,
    client,
    clientAuth,
    params,
    getEnv().OIDC_REDIRECT_URI,
    stateData.code_verifier,
  );
  const tokens = await oauth.processAuthorizationCodeResponse(as, client, tokenRes, {
    expectedNonce: stateData.nonce,
    requireIdToken: true,
  });

  const claims = oauth.getValidatedIdTokenClaims(tokens);
  if (!claims?.sub) {
    return NextResponse.redirect(new URL("/login?error=invalid_id_token", req.nextUrl.origin));
  }

  const session: SessionData = {
    sub: claims.sub,
    access_token: tokens.access_token,
    access_expires_at:
      Math.floor(Date.now() / 1000) + (typeof tokens.expires_in === "number" ? tokens.expires_in : 900),
    refresh_token: tokens.refresh_token ?? "",
  };
  if (typeof tokens.id_token === "string") session.id_token = tokens.id_token;
  await setSessionCookie(session);

  const safeReturn = stateData.return_to.startsWith("/") ? stateData.return_to : "/";
  return NextResponse.redirect(new URL(safeReturn, req.nextUrl.origin));
}
