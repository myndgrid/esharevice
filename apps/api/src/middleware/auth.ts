import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { env } from "../env.js";
import { resolveUserFromSub } from "../lib/users.js";
import type { AppEnv } from "../app.js";

// JWKS is cached in-memory by jose; one cold call to Authentik per cache miss.
const JWKS = createRemoteJWKSet(new URL(env.OIDC_JWKS_URL));

function claimsFromPayload(p: JWTPayload): Parameters<typeof resolveUserFromSub>[1] {
  const c: Parameters<typeof resolveUserFromSub>[1] = {};
  if (typeof p.email === "string") c.email = p.email;
  if (typeof p.given_name === "string") c.given_name = p.given_name;
  if (typeof p.family_name === "string") c.family_name = p.family_name;
  if (typeof p.name === "string") c.name = p.name;
  return c;
}

/** Hard requirement: 401s with a problem+json body unless a valid Authentik-issued JWT is present. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Missing Bearer token" });
  }
  const token = header.slice(7);
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: env.OIDC_ISSUER,
      audience: env.OIDC_AUDIENCE,
    });
    if (!payload.sub) {
      throw new HTTPException(401, { message: "Token missing sub claim" });
    }
    c.set("auth", { sub: payload.sub, claims: payload });
    c.set("user", await resolveUserFromSub(payload.sub, claimsFromPayload(payload)));
    await next();
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    const msg = err instanceof Error ? err.message : "verification failed";
    throw new HTTPException(401, { message: msg });
  }
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
    const { payload } = await jwtVerify(header.slice(7), JWKS, {
      issuer: env.OIDC_ISSUER,
      audience: env.OIDC_AUDIENCE,
    });
    if (payload.sub) {
      c.set("auth", { sub: payload.sub, claims: payload });
      c.set("user", await resolveUserFromSub(payload.sub, claimsFromPayload(payload)));
    }
  } catch {
    // Silent — soft auth never rejects.
  }
  await next();
});
