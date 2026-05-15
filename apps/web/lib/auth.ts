import { redirect } from "next/navigation";
import { readAccessToken, readSession } from "./session";

/**
 * Authenticated state returned to server components.
 *
 * The access_token is read from the short-lived `esharevice_at` cookie which
 * is maintained by `apps/web/middleware.ts` — it's refreshed proactively
 * before expiry, so server components can rely on it being valid.
 *
 * If middleware fails to refresh (Authentik down, refresh_token revoked), it
 * clears the cookies, this function returns null, and `requireAuth` redirects
 * to /api/auth/login.
 */
export type AuthenticatedSession = {
  sub: string;
  access_token: string;
  id_token?: string;
};

/**
 * Server-side auth helper. Pure read — does no refresh.
 * Returns null when:
 *   - No session cookie (anonymous user)
 *   - Session cookie exists but access cookie doesn't (middleware refresh failed
 *     OR matcher didn't run for this path — both effectively "not authenticated")
 */
export async function auth(): Promise<AuthenticatedSession | null> {
  const session = await readSession();
  if (!session) return null;

  // The access cookie is short-lived and managed by middleware. It can be
  // briefly absent for two reasons:
  //   (a) the browser dropped it on expiry and the user hasn't yet hit a path
  //       through middleware to refresh, or
  //   (b) a credential-less probe request from the browser (Chromium's pre-
  //       render / prefetch heuristics) is rendering this page.
  // In either case the SESSION cookie alone is enough to say "logged in" —
  // it carries the refresh token, and any API call that actually needs an
  // access token can refresh via middleware on its own request.
  const access_token = (await readAccessToken()) ?? "";
  const out: AuthenticatedSession = { sub: session.sub, access_token };
  if (session.id_token) out.id_token = session.id_token;
  return out;
}

/**
 * Convenience wrapper for protected pages — redirects to /api/auth/login if
 * unauthenticated OR if the access token isn't currently available (a probe
 * request without cookies would otherwise render a half-protected page).
 */
export async function requireAuth(returnTo: string): Promise<AuthenticatedSession> {
  const session = await auth();
  if (!session || !session.access_token) {
    const params = new URLSearchParams({ return_to: returnTo });
    redirect(`/api/auth/login?${params.toString()}`);
  }
  return session;
}
