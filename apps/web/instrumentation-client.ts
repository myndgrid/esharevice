/**
 * Next 15 auto-loads this file for the browser bundle on the first client
 * navigation. Mirrors instrumentation.ts: env-gated on NEXT_PUBLIC_SENTRY_DSN
 * so dev / CI no-op cleanly without a real DSN.
 */
import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0.1,
    // Replay is heavy and not free — leave it off for v1. We can opt-in
    // selected routes later when there's a real diagnostic need.
    replaysOnErrorSampleRate: 0,
    replaysSessionSampleRate: 0,
    sendDefaultPii: false,
  });
}

/**
 * Required for Next 15 router-instrumentation — captures route-change
 * transitions in Sentry traces. No-ops when Sentry isn't initialised.
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
