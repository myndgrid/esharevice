/**
 * Auth.js v5 (NextAuth beta) configuration. Sole identity provider for the
 * app post Phase 3 of the Authentik teardown.
 *
 * Key design:
 *   • basePath "/api/authjs" — kept distinct from the (now-deleted) legacy
 *     `/api/auth/*` URL space. The basePath name stays so future commit
 *     logs and route comments make sense.
 *   • Cookie "esharevice_authjs_session" — custom name kept for the same
 *     historical-clarity reason.
 *   • Session strategy "jwt" with a custom RS256 access_token minted in
 *     the jwt callback. The session cookie itself is the standard JWE
 *     (symmetric, AUTH_SECRET-encrypted). The access_token is what the
 *     Hono API verifies via JWKS — asymmetric so the API never has the
 *     signing key.
 *   • Providers gated on env presence — Google + magic-link both opt-in
 *     so dev with only AUTH_SECRET set still boots without crashing.
 *
 * Plan: tasks/2026-05-16_premium-marketplace-redesign-plan.md
 *       §Backend Systems — Authentication.
 */
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { SignJWT, importPKCS8 } from "jose";

const ISSUER = process.env["AUTH_ISSUER"] ?? process.env["NEXTAUTH_URL"] ?? "http://localhost:3000";
const AUDIENCE = process.env["AUTH_AUDIENCE"] ?? "esharevice-api";
const COOKIE_NAME = "esharevice_authjs_session";

/**
 * Build the provider array from whatever env vars are populated. Empty when
 * neither Google nor Resend is configured — Auth.js then renders the email
 * sign-in UI but every attempt 400s. Useful only as a "lights are on, nobody
 * home" smoke check in fresh-clone dev environments.
 */
function buildProviders() {
  const providers = [];
  if (process.env["AUTH_GOOGLE_ID"] && process.env["AUTH_GOOGLE_SECRET"]) {
    providers.push(
      Google({
        clientId: process.env["AUTH_GOOGLE_ID"],
        clientSecret: process.env["AUTH_GOOGLE_SECRET"],
        // Force account selection on every sign-in so a user who's signed
        // into multiple Google accounts gets the chooser instead of
        // silently logging in with whichever account Google picked last.
        authorization: { params: { prompt: "select_account" } },
      }),
    );
  }
  if (process.env["RESEND_API_KEY"]) {
    providers.push(
      Resend({
        apiKey: process.env["RESEND_API_KEY"],
        from: process.env["AUTH_RESEND_FROM"] ?? "auth@example.com",
      }),
    );
  }
  return providers;
}

/**
 * Mint an OIDC-shaped RS256 access token for the API. The Hono API verifies
 * this via the JWKS endpoint at /.well-known/jwks.json (served from this app).
 *
 * Claims kept minimal + OIDC-standard so any future provider swap is
 * transparent to the API. Anything app-specific is fetched by `sub` server-side.
 */
async function mintAccessToken(payload: {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}): Promise<string> {
  const pemBase64 = process.env["AUTH_JWT_PRIVATE_KEY"];
  if (!pemBase64) {
    throw new Error("AUTH_JWT_PRIVATE_KEY is not configured");
  }
  // .env.creds stores PEM as base64 single-line; decode to multi-line PEM.
  const pem = Buffer.from(pemBase64, "base64").toString("utf8");
  const key = await importPKCS8(pem, "RS256");
  // Only include claims that are actually defined — `exactOptionalPropertyTypes`
  // treats undefined as a distinct value.
  const claims: Record<string, unknown> = {};
  if (payload.email !== undefined) claims.email = payload.email;
  if (payload.email_verified !== undefined) claims.email_verified = payload.email_verified;
  if (payload.name !== undefined) claims.name = payload.name;
  if (payload.picture !== undefined) claims.picture = payload.picture;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "authjs-rs256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
}

/**
 * Normalise the provider-specific user info into a stable `sub` format the
 * API recognises. Pattern: `<provider>:<account_id>` for OAuth, `email:<addr>`
 * for magic-link (no upstream account_id concept).
 *
 * The API's resolveUserFromSub handles both shapes — see apps/api/src/lib/users.ts.
 */
function deriveSub(provider: string | undefined, accountProviderAccountId: string | undefined, email: string | undefined): string {
  if (provider === "google" && accountProviderAccountId) {
    return `google:${accountProviderAccountId}`;
  }
  if (provider === "apple" && accountProviderAccountId) {
    return `apple:${accountProviderAccountId}`;
  }
  if (email) {
    return `email:${email.toLowerCase()}`;
  }
  // Fallback — should never hit in practice since every provider supplies
  // either a stable account id or an email.
  throw new Error("Unable to derive a sub: neither account.providerAccountId nor email is present");
}

/**
 * Call the API's /v1/me/provision endpoint to upsert the local users row
 * for this verified identity. Returns the local UUID so subsequent API
 * calls can use it. We MUST pass our newly minted access token in the
 * Authorization header — the provision endpoint is auth-required and
 * verifies the token against our JWKS.
 */
async function provisionLocalUser(input: {
  sub: string;
  email?: string;
  given_name?: string;
  family_name?: string;
  name?: string;
  email_verified?: boolean;
}): Promise<void> {
  const apiBase = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:8080";
  // Build the mintAccessToken input without undefined values (the helper
  // signature uses optional properties under exactOptionalPropertyTypes).
  const tokenInput: Parameters<typeof mintAccessToken>[0] = { sub: input.sub };
  if (input.email !== undefined) tokenInput.email = input.email;
  if (input.email_verified !== undefined) tokenInput.email_verified = input.email_verified;
  if (input.name !== undefined) tokenInput.name = input.name;
  const token = await mintAccessToken(tokenInput);

  // Same pattern for the provision body — drop unset keys so the JSON
  // matches the API's strict Zod schema (which rejects undefined entries).
  const body: Record<string, unknown> = { sub: input.sub };
  if (input.email !== undefined) body.email = input.email;
  if (input.given_name !== undefined) body.given_name = input.given_name;
  if (input.family_name !== undefined) body.family_name = input.family_name;
  if (input.name !== undefined) body.name = input.name;
  if (input.email_verified !== undefined) body.email_verified = input.email_verified;

  const res = await fetch(`${apiBase}/v1/me/provision`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "(no body)");
    throw new Error(`Provision failed: ${res.status} ${detail}`);
  }
}

const AUTH_SECRET = process.env["AUTH_SECRET"];
if (!AUTH_SECRET) {
  throw new Error(
    "AUTH_SECRET is required. Set a 32-byte base64 string via `openssl rand -base64 32`.",
  );
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  basePath: "/api/authjs",
  secret: AUTH_SECRET,
  trustHost: true,
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  cookies: {
    sessionToken: {
      name: COOKIE_NAME,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env["NODE_ENV"] === "production",
      },
    },
  },
  providers: buildProviders(),
  pages: {
    signIn: "/login",
    error: "/login",
    verifyRequest: "/login/check-email",
  },
  callbacks: {
    /**
     * Fires on EVERY sign-in (social and magic-link). We use it to upsert
     * the local `users` row via the API. Returning false aborts the sign-in
     * with a generic error; throwing surfaces the message on the error page.
     */
    async signIn({ user, account }) {
      try {
        const email = user.email ?? undefined;
        const sub = deriveSub(account?.provider, account?.providerAccountId, email);
        // Build provision input without undefined entries (exactOptionalPropertyTypes).
        const provInput: Parameters<typeof provisionLocalUser>[0] = {
          sub,
          email_verified: account?.provider !== "credentials",
        };
        if (email !== undefined) provInput.email = email;
        if (user.name) provInput.name = user.name;
        await provisionLocalUser(provInput);
        // Stash the derived sub on the user object so the jwt callback can
        // bake it into the token without re-deriving (jwt callback doesn't
        // receive `account` after the initial sign-in).
        (user as { _esv_sub?: string })._esv_sub = sub;
        return true;
      } catch (err) {
        // Log + reject. The user lands on /login?error=AccessDenied.
        console.error("[auth.signIn] provision failed:", err);
        return false;
      }
    },
    /**
     * Bake our derived sub + a freshly minted access_token into the JWT.
     * The session callback then exposes them to server components.
     */
    async jwt({ token, user, trigger }) {
      if (trigger === "signIn" && user) {
        const stashed = (user as { _esv_sub?: string })._esv_sub;
        if (stashed) token.sub = stashed;
      }
      // Re-mint the access token on every JWT touch (every page load) so
      // the API always sees a fresh, short-lived token. The session cookie
      // itself rotates on each render thanks to Next 15 streaming.
      if (token.sub) {
        try {
          const input: Parameters<typeof mintAccessToken>[0] = { sub: token.sub };
          if (typeof token.email === "string") input.email = token.email;
          if (typeof token.name === "string") input.name = token.name;
          if (typeof token.picture === "string") input.picture = token.picture;
          token.access_token = await mintAccessToken(input);
        } catch (err) {
          console.error("[auth.jwt] mintAccessToken failed:", err);
        }
      }
      return token;
    },
    /**
     * Expose sub + access_token on session so server-side fetch wrappers can
     * grab them. The browser sees the session via /api/authjs/session which
     * intentionally strips the access_token from the JSON (Auth.js's session
     * serializer respects only declared keys).
     */
    async session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      if (typeof token.access_token === "string") {
        (session as { accessToken?: string }).accessToken = token.access_token;
      }
      return session;
    },
  },
});
