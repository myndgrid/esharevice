import { type NextRequest, NextResponse } from "next/server";
import * as oauth from "oauth4webapi";
import {
  ACCESS_COOKIE,
  SESSION_COOKIE,
  attachAccessCookieOn,
  attachSessionCookie,
  clearAccessCookieOn,
  clearSessionCookieOn,
  readAccessTokenFromRequest,
  verifySessionToken,
  type SessionData,
} from "./lib/session";
import { getAuthServer, getClient, getClientAuth } from "./lib/oidc";

/**
 * Refresh-token-rotation middleware.
 *
 * Why this exists: Next.js 15 forbids `cookies().set()` from inside server
 * components. Authentik rotates refresh tokens on every use. If the rotated
 * value can't be persisted, the cookie becomes a one-shot — second page load
 * fails because Authentik rejects the old refresh_token.
 *
 * Middleware can write cookies on the response AND mutate the request cookies
 * forwarded downstream (Next 15's `NextResponse.next({ request })` pattern),
 * so it's the right place to do the refresh dance.
 *
 * Algorithm:
 *   1. If no session cookie → nothing to do (anonymous user), forward.
 *   2. If access-token cookie exists → already-valid token, forward.
 *   3. Otherwise: exchange the refresh_token at Authentik for a new
 *      access_token (and possibly a rotated refresh_token).
 *   4. Write the new access_token cookie (short-lived) AND, if rotated,
 *      the new session cookie (30d). Both on the response (for the browser)
 *      AND the forwarded request (for server components in the same request).
 *   5. On any refresh failure → clear both cookies. Downstream `requireAuth`
 *      will redirect to /api/auth/login.
 *
 * Matcher excludes static assets and the auth-flow routes (which write
 * cookies themselves and don't need middleware refresh).
 */

const AUTHJS_COOKIE = "esharevice_authjs_session";

export async function middleware(req: NextRequest): Promise<NextResponse> {
  // Auth.js manages its own session cookie + refresh internally; we pass
  // through any request that has the Auth.js cookie present. This is the
  // canonical migration-window check — both auth systems coexist by cookie
  // name. After Authentik is torn down, this whole middleware becomes a
  // no-op (or gets replaced with the standard Auth.js middleware wrapper).
  if (req.cookies.get(AUTHJS_COOKIE)?.value) {
    return NextResponse.next();
  }

  const sessionCookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (!sessionCookie) return NextResponse.next();

  const session = await verifySessionToken(sessionCookie);
  if (!session?.refresh_token) {
    // Corrupt or unsigned cookie — clear and forward.
    const res = NextResponse.next();
    return clearSessionCookieOn(res);
  }

  // Already have a current access token from a previous middleware run.
  if (readAccessTokenFromRequest(req)) {
    return NextResponse.next();
  }

  try {
    const as = await getAuthServer();
    const client = getClient();
    const clientAuth = getClientAuth();
    const tokenRes = await oauth.refreshTokenGrantRequest(
      as,
      client,
      clientAuth,
      session.refresh_token,
    );
    const tokens = await oauth.processRefreshTokenResponse(as, client, tokenRes);

    const newRefresh = tokens.refresh_token ?? session.refresh_token;
    const newIdToken =
      typeof tokens.id_token === "string" ? tokens.id_token : session.id_token;
    const expiresIn = typeof tokens.expires_in === "number" ? tokens.expires_in : 900;

    // Forward request to next handler with updated cookies — Next 15 pattern.
    // This makes server components see the new tokens in this SAME request.
    req.cookies.set(ACCESS_COOKIE, tokens.access_token);
    if (newRefresh !== session.refresh_token || newIdToken !== session.id_token) {
      // The session cookie is a signed JWT; we can't forge it on the request
      // directly, but we can update the response. Server components read
      // session via readSession() which uses the request's cookies — so we
      // also need to forward the new VALUE. Since we control the value of
      // SESSION_COOKIE, we re-sign and set on req.cookies too.
    }

    let res = NextResponse.next({
      request: { headers: req.headers },
    });

    // Persist on the browser.
    res = attachAccessCookieOn(res, tokens.access_token, expiresIn);

    if (newRefresh !== session.refresh_token || newIdToken !== session.id_token) {
      const updated: SessionData = { sub: session.sub, refresh_token: newRefresh };
      if (newIdToken) updated.id_token = newIdToken;
      res = await attachSessionCookie(res, updated);
      // Also forward the new session JWT to downstream server components.
      // We re-sign inline to keep the request consistent in-flight.
      const { SignJWT } = await import("jose");
      const newToken = await new SignJWT({ ...updated })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("30d")
        .sign(new TextEncoder().encode(process.env.SESSION_COOKIE_SECRET ?? ""));
      req.cookies.set(SESSION_COOKIE, newToken);
    }

    return res;
  } catch (err) {
    // Refresh failed (revoked, expired, Authentik downtime). Clear cookies
    // so the next render goes through requireAuth → /api/auth/login.
     
    console.warn("[middleware] refresh failed:", err instanceof Error ? err.message : err);
    let res = NextResponse.next();
    res = clearSessionCookieOn(res);
    res = clearAccessCookieOn(res);
    return res;
  }
}

export const config = {
  // Run on every page + RSC fetch, but skip Next internals, static assets, and
  // the auth route handlers (they manage cookies themselves and would loop).
  // /api/authjs/* (Auth.js) is also skipped since Auth.js doesn't need the
  // refresh dance — it manages its own cookie lifecycle. /.well-known/jwks.json
  // is public and never touches the session.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/auth/login|api/auth/callback|api/auth/logout|api/authjs|\\.well-known/jwks\\.json).*)",
  ],
};
