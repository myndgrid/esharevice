import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import type { Problem } from "@esharevice/shared";
import { captureException } from "../instrument.js";

const PROBLEM_BASE = "https://esharevice.com/errors";

/** Hono onError handler — produces RFC 7807 problem+json for every thrown error. */
export function onError(err: Error, c: Context): Response {
  let problem: Problem;

  if (err instanceof ZodError) {
    problem = {
      type: `${PROBLEM_BASE}/validation`,
      title: "Validation failed",
      status: 400,
      detail: JSON.stringify(err.flatten()),
      instance: c.req.path,
    };
  } else if (err instanceof HTTPException) {
    // 4xx are user-facing and self-explanatory; don't ship them to Sentry.
    // 5xx HTTPExceptions are unexpected server faults we want visibility on.
    if (err.status >= 500) {
      captureException(err);
    }
    problem = {
      type: `${PROBLEM_BASE}/${err.status === 500 ? "internal" : "client"}`,
      title: err.message || "Request failed",
      status: err.status,
      ...(err.message ? { detail: err.message } : {}),
      instance: c.req.path,
    };
  } else {
    // Truly unexpected — log locally + report to Sentry. Treat as 500.
    // eslint-disable-next-line no-console
    console.error(`[ERROR] ${c.req.method} ${c.req.path}`, err);
    captureException(err);
    problem = {
      type: `${PROBLEM_BASE}/internal`,
      title: "Internal server error",
      status: 500,
      ...(process.env.NODE_ENV === "production" ? {} : { detail: err.message }),
      instance: c.req.path,
    };
  }

  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: { "content-type": "application/problem+json" },
  });
}

export function notFound(c: Context): Response {
  const problem: Problem = {
    type: `${PROBLEM_BASE}/not-found`,
    title: "Not Found",
    status: 404,
    detail: `No route for ${c.req.method} ${c.req.path}`,
    instance: c.req.path,
  };
  return new Response(JSON.stringify(problem), {
    status: 404,
    headers: { "content-type": "application/problem+json" },
  });
}
