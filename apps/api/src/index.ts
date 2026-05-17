// Sentry's runtime instrumentation has to install BEFORE any other module
// loads — pulling this in first patches the HTTP / Postgres clients so
// downstream code is observable. The file no-ops cleanly when SENTRY_DSN
// isn't set, so local dev + tests are unaffected.
import "./instrument.js";

import { serve } from "@hono/node-server";
import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { rateLimiter } from "hono-rate-limiter";

import { env } from "./env.js";
import { notFound, onError } from "./middleware/error.js";
import health from "./routes/health.js";
import me from "./routes/v1/me.js";
import exchangeItems from "./routes/v1/exchange-items.js";
import categoriesRoute from "./routes/v1/categories.js";
import bookingsRoute from "./routes/v1/bookings.js";
import payoutsRoute from "./routes/v1/payouts.js";
import stripeWebhooksRoute from "./routes/v1/webhooks-stripe.js";
import saves from "./routes/v1/saves.js";
import conversationsRoute from "./routes/v1/conversations.js";
import emailUnsubscribe from "./routes/v1/email-unsubscribe.js";
import type { AppEnv } from "./app.js";

const app = new OpenAPIHono<AppEnv>();

// ─────────────────────── Global middleware
app.use("*", secureHeaders());
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: env.WEB_ORIGIN.split(",").map((o) => o.trim()),
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }),
);
app.use(
  "*",
  rateLimiter({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: "draft-7",
    keyGenerator: (c) =>
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "unknown",
  }),
);

// ─────────────────────── Routes
// Unversioned /health for load balancers.
app.route("/", health);

// Versioned API surface.
app.route("/v1", health); // also expose /v1/health
app.route("/v1", me);
app.route("/v1", exchangeItems);
app.route("/v1", categoriesRoute);
app.route("/v1", bookingsRoute);
app.route("/v1", payoutsRoute);
app.route("/v1", stripeWebhooksRoute);
app.route("/v1", saves);
app.route("/v1", conversationsRoute);
app.route("/v1", emailUnsubscribe);

// ─────────────────────── OpenAPI spec + Swagger UI
app.doc("/v1/openapi.json", {
  openapi: "3.0.0",
  info: {
    title: "e-Sharevice API",
    version: "0.1.0",
    description: "Community skill / item exchange — versioned public API.",
  },
  servers: [
    { url: "https://api.esharevice.com", description: "production" },
    { url: "http://localhost:8080", description: "local dev" },
  ],
});
app.openAPIRegistry.registerComponent("securitySchemes", "Bearer", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description: "Authentik-issued JWT access token.",
});
app.get("/v1/docs", swaggerUI({ url: "/v1/openapi.json" }));

// ─────────────────────── Error handling
app.onError(onError);
app.notFound(notFound);

// ─────────────────────── Boot
const server = serve(
  { fetch: app.fetch, port: env.API_PORT, hostname: "0.0.0.0" },
  (info) => {
     
    console.log(`[api] listening on http://${info.address}:${info.port}`);
  },
);

const shutdown = (signal: NodeJS.Signals): void => {
   
  console.log(`[api] received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

process.on("unhandledRejection", (reason) => {
   
  console.error("[api] unhandledRejection", reason);
});

export { app };
