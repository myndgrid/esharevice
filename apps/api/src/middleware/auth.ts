import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import {
  createRemoteJWKSet,
  decodeJwt,
  jwtVerify,
  type JWTPayload,
} from "jose";
import { env } from "../env.js";
import { resolveUserFromSub } from "../lib/users.js";
import type { AppEnv } from "../app.js";

/**
 * Dual-issuer JWT verifier.
 *
 * During the Authentik → Auth.js migration window the API trusts BOTH
 * issuers. The `iss` claim picks which JWKS to verify against:
 *
 *   • iss === env.AUTHJS_ISSUER  → verify against env.AUTHJS_JWKS_URL
 *   • iss === env.OIDC_ISSUER    → verify against env.OIDC_JWKS_URL (Authentik)
 *
 * After the 7-day cutover the Authentik branch is dropped; only Auth.js
 * tokens remain valid.
 *
 * Each JWKS gets its own `createRemoteJWKSet` instance — jose caches the
 * fetched keys per-instance, so one cold fetch per source per process start.
 */
const AuthentikJWKS = createRemoteJWKSet(new URL(env.OIDC_JWKS_URL));
const AuthjsJWKS = env.AUTHJS_JWKS_URL
  ? createRemoteJWKSet(new URL(env.AUTHJS_JWKS_URL))
  : null;

type IssuerKind = "authentik" | "authjs";

function pickIssuer(payload: JWTPayload): IssuerKind | null {
  if (typeof payload.iss !== "string") return null;
  if (payload.iss === env.OIDC_ISSUER) return "authentik";
  if (env.AUTHJS_ISSUER && payload.iss === env.AUTHJS_ISSUER) return "authjs";
  return null;
}

/**
 * Verify a Bearer token against whichever issuer it claims. Returns the
 * payload, or throws HTTPException(401) on any failure.
 *
 * We decode (without verifying) first to read `iss`, then run the real
 * `jwtVerify` with the matching JWKS + expected audience. This is the
 * standard pattern for multi-issuer setups — `decodeJwt` is constant-time
 * + side-effect-free, and the result is discarded if verification fails.
 */
async function verifyToken(token: string): Promise<JWTPayload> {
  let unverified: JWTPayload;
  try {
    unverified = decodeJwt(token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "decode failed";
    throw new HTTPException(401, { message: msg });
  }
  const kind = pickIssuer(unverified);
  if (!kind) {
    throw new HTTPException(401, { message: "Unknown token issuer" });
  }

  try {
    if (kind === "authentik") {
      const { payload } = await jwtVerify(token, AuthentikJWKS, {
        issuer: env.OIDC_ISSUER,
        audience: env.OIDC_AUDIENCE,
      });
      return payload;
    }
    // kind === "authjs" — env-presence is checked above (pickIssuer returns
    // 'authjs' only when env.AUTHJS_ISSUER is set), but TS doesn't narrow
    // through a free function so we re-assert the JWKS is non-null.
    if (!AuthjsJWKS || !env.AUTHJS_ISSUER) {
      throw new HTTPException(401, { message: "Auth.js issuer not configured" });
    }
    const { payload } = await jwtVerify(token, AuthjsJWKS, {
      issuer: env.AUTHJS_ISSUER,
      audience: env.AUTHJS_AUDIENCE ?? "esharevice-api",
    });
    return payload;
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    const msg = err instanceof Error ? err.message : "verification failed";
    throw new HTTPException(401, { message: msg });
  }
}

function claimsFromPayload(p: JWTPayload): Parameters<typeof resolveUserFromSub>[1] {
  const c: Parameters<typeof resolveUserFromSub>[1] = {};
  if (typeof p.email === "string") c.email = p.email;
  if (typeof p.given_name === "string") c.given_name = p.given_name;
  if (typeof p.family_name === "string") c.family_name = p.family_name;
  if (typeof p.name === "string") c.name = p.name;
  return c;
}

/** Hard requirement: 401s with a problem+json body unless a valid JWT is present. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Missing Bearer token" });
  }
  const token = header.slice(7);
  const payload = await verifyToken(token);
  if (!payload.sub) {
    throw new HTTPException(401, { message: "Token missing sub claim" });
  }
  c.set("auth", { sub: payload.sub, claims: payload });
  c.set("user", await resolveUserFromSub(payload.sub, claimsFromPayload(payload)));
  await next();
});

/**
 * Soft auth: attaches user + auth if a valid token is present, but never rejects.
 * Useful for endpoints that vary their response by auth state.
 */
export const attachAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    await next();
    return;
  }
  try {
    const payload = await verifyToken(header.slice(7));
    if (payload.sub) {
      c.set("auth", { sub: payload.sub, claims: payload });
      c.set("user", await resolveUserFromSub(payload.sub, claimsFromPayload(payload)));
    }
  } catch {
    // Silent — soft auth never rejects.
  }
  await next();
});
