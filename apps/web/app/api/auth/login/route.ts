import { type NextRequest, NextResponse } from "next/server";
import * as oauth from "oauth4webapi";
import { getAuthServer, getClient } from "../../../../lib/oidc";
import { attachStateCookie } from "../../../../lib/session";
import { getEnv } from "../../../../lib/env";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const as = await getAuthServer();
  const client = getClient();

  // PKCE: pair a random verifier with its SHA-256 challenge.
  const code_verifier = oauth.generateRandomCodeVerifier();
  const code_challenge = await oauth.calculatePKCECodeChallenge(code_verifier);
  const state = oauth.generateRandomState();
  const nonce = oauth.generateRandomNonce();

  // Where to send the user after login (?return_to=/profile etc.)
  const return_to = req.nextUrl.searchParams.get("return_to") ?? "/";

  // `?signup=1` is a soft hint that the user clicked "Sign up" rather than
  // "Sign in". Authentik's authorize endpoint supports the OIDC standard
  // `prompt=create` parameter to signal the IdP to land on the registration
  // screen rather than the login screen. If Authentik doesn't honour it on a
  // given deployment, the user still sees a normal login page with a visible
  // "Need an account? Sign up" link — same end state, one extra click.
  const signup = req.nextUrl.searchParams.get("signup") === "1";

  const authUrl = new URL(as.authorization_endpoint!);
  authUrl.searchParams.set("client_id", client.client_id);
  authUrl.searchParams.set("redirect_uri", getEnv().OIDC_REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid profile email offline_access");
  authUrl.searchParams.set("code_challenge", code_challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("nonce", nonce);
  if (signup) {
    authUrl.searchParams.set("prompt", "create");
  }

  // Cookies set via `cookies()` from "next/headers" do NOT propagate to a
  // manually-returned NextResponse in Next 15. Build the redirect first, then
  // attach the state cookie directly to its response object.
  const response = NextResponse.redirect(authUrl);
  await attachStateCookie(response, { state, nonce, code_verifier, return_to });
  return response;
}
