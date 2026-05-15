import { redirect } from "next/navigation";
import * as oauth from "oauth4webapi";
import { getAuthServer, getClient, getClientAuth } from "./oidc";
import {
  clearSessionCookie,
  readSession,
  setSessionCookie,
  type SessionData,
} from "./session";

// Refresh access tokens 60s before they actually expire so a long-running render
// doesn't burn a fresh token mid-flight.
const SKEW_SECONDS = 60;

/**
 * Server-side auth helper. Returns a session whose access_token is guaranteed
 * to be valid for at least SKEW_SECONDS more seconds. Returns null if no
 * session OR if refresh failed (in which case the session cookie is cleared).
 */
export async function auth(): Promise<SessionData | null> {
  const session = await readSession();
  if (!session) return null;

  const now = Math.floor(Date.now() / 1000);
  if (session.access_expires_at > now + SKEW_SECONDS) {
    return session;
  }

  // Access expired (or about to). Refresh using the refresh_token.
  if (!session.refresh_token) {
    await clearSessionCookie();
    return null;
  }

  try {
    const as = await getAuthServer();
    const client = getClient();
    const clientAuth = getClientAuth();
    const res = await oauth.refreshTokenGrantRequest(as, client, clientAuth, session.refresh_token);
    const tokens = await oauth.processRefreshTokenResponse(as, client, res);

    const updated: SessionData = {
      sub: session.sub,
      access_token: tokens.access_token,
      access_expires_at:
        Math.floor(Date.now() / 1000) +
        (typeof tokens.expires_in === "number" ? tokens.expires_in : 900),
      // Authentik rotates refresh tokens — use the new one if returned.
      refresh_token: tokens.refresh_token ?? session.refresh_token,
    };
    if (typeof tokens.id_token === "string") {
      updated.id_token = tokens.id_token;
    } else if (session.id_token) {
      updated.id_token = session.id_token;
    }
    await setSessionCookie(updated);
    return updated;
  } catch {
    // Refresh failed (revoked, expired, or Authentik downtime). Force re-login.
    await clearSessionCookie();
    return null;
  }
}

/**
 * Convenience wrapper for protected pages — redirects to /login if unauthenticated.
 * Pass the current path so the user lands back here after login.
 */
export async function requireAuth(returnTo: string): Promise<SessionData> {
  const session = await auth();
  if (!session) {
    const params = new URLSearchParams({ return_to: returnTo });
    redirect(`/api/auth/login?${params.toString()}`);
  }
  return session;
}
