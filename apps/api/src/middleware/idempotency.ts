import { createHash } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { getRedis } from "../lib/redis.js";
import type { AppEnv } from "../app.js";

/**
 * Idempotency-Key middleware (Stripe-flavoured).
 *
 * Apply to unsafe routes (POST / PUT / PATCH / DELETE). Clients pass an
 * `Idempotency-Key` header with a stable per-operation token (typically a
 * UUID generated client-side and persisted across retries). The server:
 *
 *   1. Looks up the key in Redis at `idem:{sub}:{key}`.
 *   2. If found AND the request fingerprint matches → return the cached
 *      `{status, body}` exactly as the original responded. Same status, same
 *      headers, no re-execution. This is what makes "double-submit on a
 *      flaky network" safe.
 *   3. If found AND the fingerprint DIFFERS → respond `409 Conflict`. A
 *      client reusing the same key for a different request is a bug; quiet
 *      replay would corrupt state.
 *   4. If absent → run the handler, capture status + body, write to Redis
 *      with `NX` and the configured TTL, return as normal.
 *
 * Design choices:
 * - Per-user scoping (`{sub}`) prevents one user from poisoning another's
 *   key space.
 * - Fingerprint = sha256(method + path + body). Cheap and stable.
 * - TTL 24 h matches Stripe's window; long enough to cover retries on
 *   mobile / unreliable networks, short enough that Redis memory stays bounded.
 * - Only success responses (2xx) are cached. Caching errors would lock the
 *   user out of retrying after a transient failure.
 * - The header is OPTIONAL — endpoints work without it for one-shot calls.
 *   Setting `requireKey: true` flips this when an endpoint MUST be idempotent.
 */
export type IdempotencyOptions = {
  /** Reject 4xx if the header is absent. Default false. */
  requireKey?: boolean;
  /** TTL for the cached response, in seconds. Default 86400 (24 h). */
  ttlSeconds?: number;
};

type CachedResponse = {
  fingerprint: string;
  status: number;
  body: string;
};

export function idempotency(opts: IdempotencyOptions = {}): MiddlewareHandler<AppEnv> {
  const ttl = opts.ttlSeconds ?? 86_400;

  return async (c, next) => {
    const key = c.req.header("idempotency-key")?.trim();
    if (!key) {
      if (opts.requireKey) {
        throw new HTTPException(400, {
          message: "Idempotency-Key header is required for this endpoint",
        });
      }
      return next();
    }

    if (key.length > 255) {
      throw new HTTPException(400, {
        message: "Idempotency-Key must be 255 characters or fewer",
      });
    }

    const user = c.get("user");
    const sub = user?.oidc_sub ?? "anon";
    const redisKey = `idem:${sub}:${key}`;

    const fingerprint = await computeFingerprint(c);
    const redis = getRedis();
    const existingRaw = await redis.get(redisKey);

    if (existingRaw) {
      const existing = JSON.parse(existingRaw) as CachedResponse;
      if (existing.fingerprint !== fingerprint) {
        throw new HTTPException(409, {
          message:
            "Idempotency-Key reused with a different request body — choose a fresh key for distinct operations.",
        });
      }
      // Replay the cached response verbatim.
      return new Response(existing.body, {
        status: existing.status,
        headers: { "content-type": "application/json", "idempotency-replay": "true" },
      });
    }

    await next();

    // Cache only success (2xx). Hono streams the body lazily; the cheap path
    // is to read it via .clone() so the original response still streams to
    // the client unaffected.
    const res = c.res;
    if (res.status >= 200 && res.status < 300) {
      try {
        const body = await res.clone().text();
        const cached: CachedResponse = { fingerprint, status: res.status, body };
        // NX so two concurrent first-time requests don't trample.
        await redis.set(redisKey, JSON.stringify(cached), "EX", ttl, "NX");
      } catch {
        // Caching is best-effort — never fail the request because the cache write blew up.
      }
    }
  };
}

async function computeFingerprint(c: Context<AppEnv>): Promise<string> {
  const hash = createHash("sha256");
  hash.update(c.req.method);
  hash.update("\n");
  hash.update(c.req.path);
  hash.update("\n");
  // Body fingerprinting: skip for multipart (each upload's bytes already
  // dedup via the sha256 in the sharp pipeline, and re-reading the body
  // would consume the stream that the handler still needs).
  const ct = c.req.header("content-type") ?? "";
  if (!ct.startsWith("multipart/")) {
    try {
      const raw = await c.req.raw.clone().text();
      hash.update(raw);
    } catch {
      // Body unreadable (already consumed) — skip; fingerprint is method+path only.
    }
  }
  return hash.digest("hex");
}
