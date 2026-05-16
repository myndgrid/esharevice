import { cursorPage, ExchangeItem, ExchangeItemCreate, UserPublic } from "@esharevice/shared";
import { z } from "zod";
import { auth } from "./auth";

// API base is read at module load — it's just NEXT_PUBLIC_API_URL with a
// safe default, so it works even when the OIDC env vars aren't set (e.g.
// during `next build` static analysis).
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const TIMEOUT_MS = 15_000;

type ProblemBody = {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ProblemBody,
    readonly path: string,
  ) {
    super(`${path} → ${status} ${problem.title ?? "Request failed"}`);
    this.name = "ApiError";
  }
}

type Options = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Pre-built FormData body — bypasses JSON serialisation; sets no content-type so the browser/runtime picks the multipart boundary. */
  formBody?: FormData;
  /**
   * If true (default), attach the current session's access token. Set to false
   * for public endpoints to avoid burning a refresh round-trip on every render.
   */
  authed?: boolean;
  /** Server components revalidate every N seconds; pass 0 for no-store. */
  revalidate?: number | false;
  /** Optional Idempotency-Key — forwarded to unsafe routes. */
  idempotencyKey?: string;
};

async function call<T>(path: string, schema: z.ZodType<T>, opts: Options = {}): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = { accept: "application/json" };

  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (opts.idempotencyKey) {
    headers["idempotency-key"] = opts.idempotencyKey;
  }

  if (opts.authed !== false) {
    const session = await auth();
    // Only attach if we actually have an access token. session.access_token
    // can be an empty string when the page rendered from a credential-less
    // probe request — sending `Bearer ` would just 401.
    if (session?.access_token) {
      headers["authorization"] = `Bearer ${session.access_token}`;
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  // Next 15 fetch options: `cache` + `next.revalidate` are how we control SSR caching.
  const init: RequestInit & { next?: { revalidate?: number | false } } = {
    method: opts.method ?? "GET",
    headers,
    signal: controller.signal,
  };
  if (opts.formBody) {
    init.body = opts.formBody;
  } else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
  }
  if (opts.revalidate === false || opts.revalidate === 0) {
    init.cache = "no-store";
  } else if (typeof opts.revalidate === "number") {
    init.next = { revalidate: opts.revalidate };
  }

  let res: Response;
  try {
    res = await fetch(url, init);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let problem: ProblemBody = {};
    try {
      problem = (await res.json()) as ProblemBody;
    } catch {
      // body wasn't JSON
    }
    throw new ApiError(res.status, problem, path);
  }

  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json();
  return schema.parse(json);
}

// ─────────────────────── Concrete endpoints

export const api = {
  me: () => call("/v1/me", UserPublic, { authed: true, revalidate: false }),

  listExchangeItems: (opts: { cursor?: string; limit?: number; q?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.cursor) params.set("cursor", opts.cursor);
    if (opts.limit) params.set("limit", String(opts.limit));
    if (opts.q) params.set("q", opts.q);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return call(`/v1/exchange-items${qs}`, cursorPage(ExchangeItem), {
      authed: false,
      revalidate: 30,
    });
  },

  getExchangeItem: (id: string) =>
    call(`/v1/exchange-items/${id}`, ExchangeItem, { authed: false, revalidate: 60 }),

  reserveExchangeItem: (id: string, idempotencyKey?: string) => {
    const opts: Options = { method: "PUT", authed: true, revalidate: false };
    if (idempotencyKey) opts.idempotencyKey = idempotencyKey;
    return call(`/v1/exchange-items/${id}/reserve`, ExchangeItem, opts);
  },

  createExchangeItem: (body: z.infer<typeof ExchangeItemCreate>, idempotencyKey?: string) => {
    const opts: Options = { method: "POST", body, authed: true, revalidate: false };
    if (idempotencyKey) opts.idempotencyKey = idempotencyKey;
    return call("/v1/exchange-items", ExchangeItem, opts);
  },

  uploadExchangeItemImage: (id: string, file: File, idempotencyKey?: string) => {
    const fd = new FormData();
    fd.append("image", file);
    const opts: Options = { method: "POST", formBody: fd, authed: true, revalidate: false };
    if (idempotencyKey) opts.idempotencyKey = idempotencyKey;
    return call(`/v1/exchange-items/${id}/image`, ExchangeItem, opts);
  },
};
