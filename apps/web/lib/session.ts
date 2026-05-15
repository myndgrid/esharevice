import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getEnv } from "./env";

const COOKIE_NAME = "esharevice_session";
const ALG = "HS256";

function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(getEnv().SESSION_COOKIE_SECRET);
}

/**
 * The session payload stored (signed) in the HttpOnly cookie.
 * Refresh tokens are long-lived and revocable server-side via Authentik.
 * Access tokens are stored too so we can call the API without a round-trip;
 * when expired, we refresh on demand.
 */
export type SessionData = {
  /** Authentik user id (stable per identity) */
  sub: string;
  /** Authentik-issued access token (JWT) */
  access_token: string;
  /** Unix seconds — when access_token expires */
  access_expires_at: number;
  /** Authentik-issued refresh token (opaque) */
  refresh_token: string;
  /** ID token, optional — useful for logout (end_session_endpoint id_token_hint) */
  id_token?: string;
};

export async function createSession(data: SessionData): Promise<string> {
  return new SignJWT({ ...data })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("30d") // matches Authentik refresh token TTL
    .sign(getSecretKey());
}

export async function verifySession(token: string): Promise<SessionData | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: [ALG] });
    if (
      typeof payload.sub === "string" &&
      typeof payload.access_token === "string" &&
      typeof payload.access_expires_at === "number" &&
      typeof payload.refresh_token === "string"
    ) {
      const out: SessionData = {
        sub: payload.sub,
        access_token: payload.access_token,
        access_expires_at: payload.access_expires_at,
        refresh_token: payload.refresh_token,
      };
      if (typeof payload.id_token === "string") out.id_token = payload.id_token;
      return out;
    }
    return null;
  } catch {
    return null;
  }
}

export async function setSessionCookie(data: SessionData): Promise<void> {
  const token = await createSession(data);
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: getEnv().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function readSession(): Promise<SessionData | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}

/**
 * Short-lived state cookies (PKCE verifier, state, nonce) used during the auth code flow.
 * These are wiped on callback.
 */
const STATE_COOKIE = "esharevice_oidc_state";

export type OidcState = {
  state: string;
  nonce: string;
  code_verifier: string;
  return_to: string;
};

export async function setStateCookie(state: OidcState): Promise<void> {
  const token = await new SignJWT({ ...state })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(getSecretKey());
  const jar = await cookies();
  jar.set(STATE_COOKIE, token, {
    httpOnly: true,
    secure: getEnv().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
}

export async function consumeStateCookie(): Promise<OidcState | null> {
  const jar = await cookies();
  const token = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
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
