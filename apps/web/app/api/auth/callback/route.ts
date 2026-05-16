import { type NextRequest, NextResponse } from "next/server";
import * as oauth from "oauth4webapi";
import { getAuthServer, getClient, getClientAuth } from "../../../../lib/oidc";
import {
  attachAccessCookieOn,
  attachSessionCookie,
  clearStateCookieOn,
  readStateCookie,
  type SessionData,
} from "../../../../lib/session";
import { getEnv, getPublicOrigin } from "../../../../lib/env";

export const dynamic = "force-dynamic";

/**
 * Resolve a caller-supplied `return_to` value into a SAFE same-origin path.
 *
 * Defends against the protocol-relative open-redirect class:
 *   `//evil.com/path`      → `new URL(…)` resolves to `https://evil.com/path`
 *   `/\evil.com`           → `new URL(…)` resolves to `https://evil.com/`
 *   `https://evil.com/x`   → obviously a foreign origin
 *   `javascript:alert(1)`  → non-http origin (rejected by origin check anyway)
 *
 * A naive `startsWith("/")` check accepts the first two. The robust pattern is
 * to RESOLVE the candidate via the URL constructor, then compare origins.
 *
 * Returns a same-origin path+search+hash on success, or "/" on any of:
 *   - URL parse failure
 *   - origin mismatch with `publicOrigin`
 *   - any unexpected throw (defensive)
 *
 * The redirect target is composed from the returned path against `publicOrigin`
 * again by the caller, so even a normalised same-origin absolute URL is reduced
 * to its path form — we never reflect an attacker-controlled origin back.
 */
function safeReturnPath(input: string, publicOrigin: string): string {
  try {
    const baseOrigin = new URL(publicOrigin).origin;
    const candidate = new URL(input, publicOrigin);
    if (candidate.origin !== baseOrigin) return "/";
    return candidate.pathname + candidate.search + candidate.hash;
  } catch {
    return "/";
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const publicOrigin = getPublicOrigin();

  const stateData = await readStateCookie();
  if (!stateData) {
    const r = NextResponse.redirect(new URL("/?auth=missing_state", publicOrigin));
    clearStateCookieOn(r);
    return r;
  }

  const as = await getAuthServer();
  const client = getClient();
  const clientAuth = getClientAuth();

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
    const r = NextResponse.redirect(new URL("/?auth=invalid_id_token", publicOrigin));
    clearStateCookieOn(r);
    return r;
  }

  // Cookie carries the MINIMUM needed to re-authenticate against Authentik:
  // sub + refresh_token (+ id_token for logout). The access_token is intentionally
  // NOT cached here — see SessionData docs in lib/session.ts (4 KB limit).
  if (!tokens.refresh_token) {
    const r = NextResponse.redirect(new URL("/?auth=no_refresh_token", publicOrigin));
    clearStateCookieOn(r);
    return r;
  }
  const session: SessionData = {
    sub: claims.sub,
    refresh_token: tokens.refresh_token,
  };
  if (typeof tokens.id_token === "string") session.id_token = tokens.id_token;

  const safeReturn = safeReturnPath(stateData.return_to, publicOrigin);
  const response = NextResponse.redirect(new URL(safeReturn, publicOrigin));
  await attachSessionCookie(response, session);
  // Also seed the access-token cookie so the immediate next request doesn't
  // need to re-exchange the refresh_token (which would rotate it and waste
  // a round-trip). Middleware takes over from here on subsequent requests.
  const expiresIn = typeof tokens.expires_in === "number" ? tokens.expires_in : 900;
  attachAccessCookieOn(response, tokens.access_token, expiresIn);
  clearStateCookieOn(response);
  return response;
}
