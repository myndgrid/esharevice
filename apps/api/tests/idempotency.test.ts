import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// In-process Redis double. Backs ioredis's get/set/setex/del subset that
// the middleware actually exercises. NX semantics are honored so the
// concurrent-first-write race assertion is meaningful.
const store = new Map<string, { value: string; expiresAt: number }>();
function now() {
  return Date.now();
}
const fakeRedis = {
  async get(k: string) {
    const v = store.get(k);
    if (!v) return null;
    if (v.expiresAt && v.expiresAt < now()) {
      store.delete(k);
      return null;
    }
    return v.value;
  },
  async set(k: string, v: string, _ex: "EX", ttl: number, mode?: "NX") {
    if (mode === "NX" && store.has(k)) return null;
    store.set(k, { value: v, expiresAt: now() + ttl * 1000 });
    return "OK";
  },
};

vi.mock("../src/lib/redis.js", () => ({
  getRedis: () => fakeRedis,
  closeRedis: vi.fn(),
}));

import { idempotency } from "../src/middleware/idempotency.js";
import type { AppEnv } from "../src/app.js";

function appWithCounter() {
  const counter = { calls: 0 };
  const app = new Hono<AppEnv>();
  app.use("/p", idempotency());
  app.post("/p", async (c) => {
    counter.calls++;
    const body = await c.req.json<{ x: number }>().catch(() => ({ x: counter.calls }));
    return c.json({ ok: true, x: body.x, count: counter.calls }, 201);
  });
  return { app, counter };
}

describe("idempotency middleware", () => {
  beforeEach(() => {
    store.clear();
  });

  it("runs the handler when no key is present", async () => {
    const { app, counter } = appWithCounter();
    const res = await app.request("/p", { method: "POST", body: JSON.stringify({ x: 1 }) });
    expect(res.status).toBe(201);
    expect(counter.calls).toBe(1);
  });

  it("replays the cached response on identical retry", async () => {
    const { app, counter } = appWithCounter();
    const body = JSON.stringify({ x: 42 });
    const key = "abc-123";

    const first = await app.request("/p", {
      method: "POST",
      body,
      headers: { "idempotency-key": key, "content-type": "application/json" },
    });
    expect(first.status).toBe(201);
    expect(counter.calls).toBe(1);

    const second = await app.request("/p", {
      method: "POST",
      body,
      headers: { "idempotency-key": key, "content-type": "application/json" },
    });
    expect(second.status).toBe(201);
    expect(second.headers.get("idempotency-replay")).toBe("true");
    expect(counter.calls).toBe(1); // handler did NOT run again
    expect(await second.json()).toEqual({ ok: true, x: 42, count: 1 });
  });

  it("409s when the same key is reused with a different body", async () => {
    const { app } = appWithCounter();
    const key = "abc-123";

    await app.request("/p", {
      method: "POST",
      body: JSON.stringify({ x: 1 }),
      headers: { "idempotency-key": key, "content-type": "application/json" },
    });
    const conflict = await app.request("/p", {
      method: "POST",
      body: JSON.stringify({ x: 2 }), // different body
      headers: { "idempotency-key": key, "content-type": "application/json" },
    });
    expect(conflict.status).toBe(409);
  });

  it("rejects an oversized Idempotency-Key", async () => {
    const { app } = appWithCounter();
    const tooLong = "a".repeat(256);
    const res = await app.request("/p", {
      method: "POST",
      body: "{}",
      headers: { "idempotency-key": tooLong, "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("does NOT cache error responses", async () => {
    const app = new Hono<AppEnv>();
    let calls = 0;
    app.use("/fail", idempotency());
    app.post("/fail", async (c) => {
      calls++;
      return c.json({ err: "nope" }, 500);
    });

    const key = "k-err";
    const first = await app.request("/fail", {
      method: "POST",
      body: "{}",
      headers: { "idempotency-key": key, "content-type": "application/json" },
    });
    expect(first.status).toBe(500);
    expect(calls).toBe(1);

    const second = await app.request("/fail", {
      method: "POST",
      body: "{}",
      headers: { "idempotency-key": key, "content-type": "application/json" },
    });
    expect(second.status).toBe(500);
    expect(second.headers.get("idempotency-replay")).toBeNull();
    expect(calls).toBe(2); // ran again because the first wasn't cached
  });
});
