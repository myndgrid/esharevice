import { Hono } from "hono";

const health = new Hono();

health.get("/health", (c) =>
  c.json({ status: "ok", uptime: process.uptime() }),
);

export default health;
