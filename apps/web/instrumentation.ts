/**
 * Next.js calls `register()` exactly once at server start (per runtime).
 * We branch on `NEXT_RUNTIME` so the right Sentry SDK loads — `nodejs` for
 * the Node server and route handlers; `edge` for middleware + edge route
 * handlers.
 *
 * Client-side Sentry is initialised separately by `instrumentation-client.ts`
 * (Next 15 auto-loads it for the browser bundle).
 *
 * Env-gated on `SENTRY_DSN`: an empty string makes everything no-op cleanly,
 * which is the local-dev / CI default.
 */
export async function register(): Promise<void> {
  if (!process.env.SENTRY_DSN) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV ?? "development",
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV ?? "development",
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
    });
  }
}

/**
 * Forwarded to Sentry by `withSentryConfig` if/when we wire build-time
 * source-map upload. Until then, runtime errors are still captured (just
 * without source-mapped stack traces).
 */
export const onRequestError = async (
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | undefined> },
  ctx: { routerKind: "Pages Router" | "App Router"; routePath: string; routeType: "render" | "route" | "middleware" | "action" },
): Promise<void> => {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(err, request, ctx);
};
