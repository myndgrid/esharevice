import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { getEnv } from "./env";

export const SESSION_COOKIE = "esharevice_session";
export const ACCESS_COOKIE = "esharevice_at";
const STATE_COOKIE = "esharevice_oidc_state";
const ALG = "HS256";

function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(getEnv().SESSION_COOKIE_SECRET);
}

// ─────────────────────── Long-lived session

/**
 * The session data stored in the cookie. DELIBERATELY does NOT include the
 * access_token — Authentik's access tokens are 1.5-2 KB JWTs, and combined
 * with refresh + id_token they push the wrapping JWT over the 4 KB cookie
 * limit (Chromium silently drops oversized cookies). The auth() helper
 * always exchanges the refresh_token for a fresh access_token on each call;
 * the cost is one local refresh roundtrip per server render (~50 ms).
 *
 * If/when traffic justifies it, move this to a server-side Redis session
 * store and shrink the cookie to a session-id pointer.
 */
export type SessionData = {
  /** Authentik user id (stable per identity) */
  sub: string;
  /** Authentik-issued refresh token (opaque) */
  refresh_token: string;
  /** ID token (JWT) — kept for end_session_endpoint id_token_hint at logout time. */
  id_token?: string;
};

async function signSession(data: SessionData): Promise<string> {
  return new SignJWT({ ...data })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("30d") // matches Authentik refresh token TTL
    .sign(getSecretKey());
}

async function verifySession(token: string): Promise<SessionData | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: [ALG] });
    if (typeof payload.sub === "string" && typeof payload.refresh_token === "string") {
      const out: SessionData = { sub: payload.sub, refresh_token: payload.refresh_token };
      if (typeof payload.id_token === "string") out.id_token = payload.id_token;
      return out;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read the current session from the request cookies. Works in server
 * components, server actions, and route handlers — all read-only.
 */
export async function readSession(): Promise<SessionData | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

/**
 * Attach a signed session cookie to a NextResponse. Must be called on the
 * actual response object — `cookies().set()` from "next/headers" does NOT
 * propagate to a manually-returned NextResponse in Next 15.
 */
export async function attachSessionCookie(
  res: NextResponse,
  data: SessionData,
): Promise<NextResponse> {
  const token = await signSession(data);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: getEnv().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  return res;
}

/** Write the session cookie via the global cookie store (for server actions only). */
export async function setSessionCookie(data: SessionData): Promise<void> {
  const token = await signSession(data);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: getEnv().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
}

/** Clear the session cookie on a NextResponse. */
export function clearSessionCookieOn(res: NextResponse): NextResponse {
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

/** Clear the session cookie via the global cookie store (for server actions only). */
export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

// ─────────────────────── Short-lived access token (managed by middleware)

/**
 * The access token is a JWT issued by Authentik. We store it raw (not wrapped
 * in another JWT) since it's already signed by Authentik and the API verifies
 * it independently. The cookie's maxAge is sized to match the token's `exp`
 * claim so the browser auto-evicts on expiry; middleware refreshes proactively
 * before expiry so server components always find a valid token.
 */
export function readAccessTokenFromRequest(req: NextRequest): string | null {
  return req.cookies.get(ACCESS_COOKIE)?.value ?? null;
}

export async function readAccessToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(ACCESS_COOKIE)?.value ?? null;
}

export function attachAccessCookieOn(
  res: NextResponse,
  access_token: string,
  expires_in_seconds: number,
): NextResponse {
  // Cookie expires slightly before the JWT itself so we never hand out an
  // expired token to the API. Browser then asks for a refresh next request.
  const skew = 30;
  const maxAge = Math.max(60, expires_in_seconds - skew);
  res.cookies.set(ACCESS_COOKIE, access_token, {
    httpOnly: true,
    secure: getEnv().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  return res;
}

export function clearAccessCookieOn(res: NextResponse): NextResponse {
  res.cookies.delete(ACCESS_COOKIE);
  return res;
}

// ─────────────────────── Verify session from a raw cookie value (for middleware)

export async function verifySessionToken(token: string): Promise<SessionData | null> {
  return verifySession(token);
}

// ─────────────────────── Short-lived OIDC state

export type OidcState = {
  state: string;
  nonce: string;
  code_verifier: string;
  return_to: string;
};

async function signState(s: OidcState): Promise<string> {
  return new SignJWT({ ...s })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(getSecretKey());
}

/** Attach the short-lived state cookie to a NextResponse. */
export async function attachStateCookie(
  res: NextResponse,
  state: OidcState,
): Promise<NextResponse> {
  const token = await signState(state);
  res.cookies.set(STATE_COOKIE, token, {
    httpOnly: true,
    secure: getEnv().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  return res;
}

/**
 * Read + verify the state cookie from the request. Caller is responsible
 * for deleting it from the response (via `clearStateCookieOn`).
 */
export async function readStateCookie(): Promise<OidcState | null> {
  const jar = await cookies();
  const token = jar.get(STATE_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: [ALG] });
    if (
      typeof payload.state === "string" &&
      typeof payload.nonce === "string" &&
      typeof payload.code_verifier === "string" &&
      typeof payload.return_to === "string"
    ) {
      return {
        state: payload.state,
        nonce: payload.nonce,
        code_verifier: payload.code_verifier,
        return_to: payload.return_to,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Clear the state cookie on a NextResponse (after successful callback consumption). */
export function clearStateCookieOn(res: NextResponse): NextResponse {
  res.cookies.delete(STATE_COOKIE);
  return res;
}
