import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import type { Problem } from "@esharevice/shared";

const PROBLEM_BASE = "https://your-domain.com/errors";

function send(res: Parameters<ErrorRequestHandler>[2], problem: Problem): void {
  res.status(problem.status).type("application/problem+json").json(problem);
}

export const notFound: RequestHandler = (req, res) => {
  send(res, {
    type: `${PROBLEM_BASE}/not-found`,
    title: "Not Found",
    status: 404,
    detail: `No route for ${req.method} ${req.originalUrl}`,
    instance: req.originalUrl,
  });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    send(res, {
      type: `${PROBLEM_BASE}/validation`,
      title: "Validation failed",
      status: 400,
      detail: JSON.stringify(err.flatten()),
      instance: req.originalUrl,
    });
    return;
  }

  const status = typeof err?.status === "number" ? err.status : 500;
  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error(`[ERROR] ${req.method} ${req.originalUrl}`, err);
  }

  send(res, {
    type: `${PROBLEM_BASE}/${status === 500 ? "internal" : "client"}`,
    title: status === 500 ? "Internal server error" : (err?.title ?? "Request failed"),
    status,
    detail:
      status === 500 && process.env.NODE_ENV === "production"
        ? undefined
        : (err?.message ?? undefined),
    instance: req.originalUrl,
  });
};
