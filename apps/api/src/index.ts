import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./env";
import { errorHandler, notFound } from "./middleware/error";
import healthRouter from "./routes/health";

const app = express();

// Security + parsing.
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: env.WEB_ORIGIN.split(",").map((o: string) => o.trim()),
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  }),
);

// Structured request logs.
app.use(pinoHttp({ level: env.NODE_ENV === "production" ? "info" : "debug" }));

// Global rate limit (per-IP). Per-route limits land in week 3+.
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  }),
);

// /v1 surface — every public route is versioned from day one.
const v1 = express.Router();
v1.use(healthRouter);

// Top-level health for load balancers (unversioned).
app.use(healthRouter);

app.use("/v1", v1);

// 404 + error handler must be last.
app.use(notFound);
app.use(errorHandler);

const server = app.listen(env.API_PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on http://localhost:${env.API_PORT}`);
});

// Graceful shutdown — closes listeners cleanly so pending requests finish.
const shutdown = (signal: NodeJS.Signals): void => {
  // eslint-disable-next-line no-console
  console.log(`[api] received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Defensive — never let an unhandled rejection crash silently.
process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("[api] unhandledRejection", reason);
});
