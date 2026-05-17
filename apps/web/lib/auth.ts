import { redirect } from "next/navigation";
import { auth as authjs } from "../auth";
import { readAccessToken, readSession } from "./session";

/**
 * Authenticated state returned to server components.
 *
 * Phase 2 of the Authentik → Auth.js migration. This wrapper now prefers
 * the Auth.js session (set by next-auth via the `esharevice_authjs_session`
 * cookie). When that's absent, it falls back to the legacy Authentik
 * session/access cookies that PR 1a's middleware refreshes. Both code
 * paths return the same shape so consumers don't need to know which auth
 * stack a given user came in through.
 *
 * After Phase 3 (Authentik teardown), only the Auth.js branch remains.
 */
export type AuthenticatedSession = {
  sub: string;
  access_token: string;
  id_token?: string;
};

/**
 * Server-side auth helper. Pure read — does no refresh.
 */
export async function auth(): Promise<AuthenticatedSession | null> {
  // Auth.js path (preferred). NextAuth.auth() resolves the session from the
  // esharevice_authjs_session cookie; the jwt callback in apps/web/auth.ts
  // mints a fresh RS256 access_token on every touch and stashes it on the
  // session via `session.accessToken`.
  const ajs = await authjs().catch(() => null);
  if (ajs?.user?.id) {
    const accessToken = (ajs as { accessToken?: string }).accessToken;
    if (accessToken) {
      return { sub: ajs.user.id, access_token: accessToken };
    }
    // Session exists but the access_token didn't get minted — happens on the
    // brief window after sign-in before the jwt callback runs. Fall through
    // to Authentik (won't match either, returns null = anonymous) so the
    // user gets bounced through /login again rather than rendering broken.
  }

  // Authentik fallback. Same logic as pre-cutover: the middleware refreshes
  // the access_token cookie proactively, so server components see a valid
  // value unless the refresh failed (in which case the cookies are cleared
  // and we return null).
  const session = await readSession();
  if (!session) return null;
  const access_token = (await readAccessToken()) ?? "";
  const out: AuthenticatedSession = { sub: session.sub, access_token };
  if (session.id_token) out.id_token = session.id_token;
  return out;
}

/**
 * Convenience wrapper for protected pages — redirects to /login if
 * unauthenticated OR if the access token isn't currently available.
 */
export async function requireAuth(returnTo: string): Promise<AuthenticatedSession> {
  const session = await auth();
  if (!session || !session.access_token) {
    const params = new URLSearchParams({ callbackUrl: returnTo });
    redirect(`/login?${params.toString()}`);
  }
  return session;
}
