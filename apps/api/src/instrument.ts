/**
 * Sentry SDK init for the API.
 *
 * MUST be the very first import in `index.ts` — Sentry installs runtime
 * instrumentation (HTTP, Postgres, etc.) by wrapping module loaders at boot,
 * so any module imported before `Sentry.init` runs uninstrumented.
 *
 * Env-gated: an unset / empty `SENTRY_DSN` makes the SDK no-op cleanly,
 * which is what we want for local dev + the CI typecheck pass.
 */
import * as Sentry from "@sentry/node";

const dsn = process.env["SENTRY_DSN"];

if (dsn && dsn.length > 0) {
  Sentry.init({
    dsn,
    environment: process.env["NODE_ENV"] ?? "development",
    // Conservative defaults — we can dial up tracing later when we actually
    // need performance data and have a budget for it. 10 % traces is fine
    // for spotting slow handlers in production without flooding Sentry.
    tracesSampleRate: 0.1,
    // Don't capture spans for the health check — it fires every 15 s and
    // would dominate the trace store with no diagnostic value.
    tracesSampler: (ctx) => {
      const url = ctx.normalizedRequest?.url ?? ctx.name ?? "";
      if (typeof url === "string" && (url.endsWith("/health") || url.includes("/v1/health"))) {
        return 0;
      }
      return 0.1;
    },
    // The default `sendDefaultPii: false` already strips cookies + headers,
    // but be explicit so a future maintainer doesn't flip it.
    sendDefaultPii: false,
  });
}

/** Lifted to a callsite-agnostic helper so route code doesn't import Sentry directly. */
export function captureException(err: unknown): void {
  if (!dsn) return;
  Sentry.captureException(err);
}
