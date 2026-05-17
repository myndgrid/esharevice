import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { env } from "../env.js";
import { resolveUserFromSub } from "../lib/users.js";
import type { AppEnv } from "../app.js";

/**
 * JWKS-based JWT verifier. Post Phase 3 of the Authentik teardown, the only
 * trusted issuer is Auth.js (apps/web/auth.ts signs RS256 JWTs whose public
 * key is served at `${web_origin}/.well-known/jwks.json`).
 *
 * The `OIDC_*` env vars stay generically named — they now point at the
 * Auth.js endpoints, but a future IdP swap is a one-config-line change.
 *
 * jose caches the fetched keys in-memory; one cold call per process start.
 */
const JWKS = createRemoteJWKSet(new URL(env.OIDC_JWKS_URL));

function claimsFromPayload(p: JWTPayload): Parameters<typeof resolveUserFromSub>[1] {
  const c: Parameters<typeof resolveUserFromSub>[1] = {};
  if (typeof p.email === "string") c.email = p.email;
  if (typeof p.given_name === "string") c.given_name = p.given_name;
  if (typeof p.family_name === "string") c.family_name = p.family_name;
  if (typeof p.name === "string") c.name = p.name;
  return c;
}

async function verifyToken(token: string): Promise<JWTPayload> {
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: env.OIDC_ISSUER,
      audience: env.OIDC_AUDIENCE,
    });
    return payload;
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    const msg = err instanceof Error ? err.message : "verification failed";
    throw new HTTPException(401, { message: msg });
  }
}

/** Hard requirement: 401s with a problem+json body unless a valid JWT is present. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Missing Bearer token" });
  }
  const payload = await verifyToken(header.slice(7));
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
