import { redirect } from "next/navigation";
import { auth as authjs } from "../auth";

/**
 * Authenticated state returned to server components.
 *
 * Phase 3 complete — Auth.js is now the only auth provider. The wrapper
 * pulls the session from Auth.js's cookie + the access_token from the
 * `jwt` callback's mint (see apps/web/auth.ts).
 */
export type AuthenticatedSession = {
  sub: string;
  access_token: string;
};

/**
 * Server-side auth helper. Pure read — does no refresh. Auth.js handles
 * cookie + access-token lifecycle internally; we just unwrap.
 */
export async function auth(): Promise<AuthenticatedSession | null> {
  const session = await authjs().catch(() => null);
  if (!session?.user?.id) return null;
  const accessToken = (session as { accessToken?: string }).accessToken;
  if (!accessToken) return null;
  return { sub: session.user.id, access_token: accessToken };
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
