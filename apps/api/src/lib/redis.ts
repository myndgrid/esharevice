import IORedis, { type Redis } from "ioredis";
import { env } from "../env.js";

let _client: Redis | null = null;

/**
 * Lazy singleton Redis client. Used for idempotency-key storage today;
 * cache + rate-limit windows will land on top of it later.
 *
 * `lazyConnect: false` so the connection opens immediately at first call —
 * we want a fast-fail at boot rather than a deferred error on the first
 * write.
 */
export function getRedis(): Redis {
  if (_client) return _client;
  _client = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    // Reconnect with backoff but cap to ~10s.
    retryStrategy: (times) => Math.min(times * 100, 10_000),
  });
  return _client;
}

/** Graceful shutdown — call from the process SIGTERM/SIGINT handler. */
export async function closeRedis(): Promise<void> {
  if (!_client) return;
  await _client.quit();
  _client = null;
}
