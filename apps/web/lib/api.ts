import {
  Conversation,
  cursorPage,
  EmailPrefs,
  ExchangeItem,
  ExchangeItemCreate,
  ExchangeItemUpdate,
  Message,
  MessageCreate,
  SaveState,
  UnreadCount,
  UserPublic,
} from "@esharevice/shared";
import type { EmailPrefsUpdate } from "@esharevice/shared";
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
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
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

  getEmailPrefs: () =>
    call("/v1/me/email-prefs", EmailPrefs, { authed: true, revalidate: false }),

  updateEmailPrefs: (body: EmailPrefsUpdate) =>
    call("/v1/me/email-prefs", EmailPrefs, {
      method: "PATCH",
      body,
      authed: true,
      revalidate: false,
    }),

  /**
   * Public unsubscribe — no auth, the token IS the capability. Returns
   * void on success; throws ApiError on a stale/invalid token.
   */
  unsubscribeEmail: (token: string, category: string) =>
    call("/v1/email/unsubscribe", z.void(), {
      method: "POST",
      body: { token, category },
      authed: false,
      revalidate: false,
    }),

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

  updateExchangeItem: (
    id: string,
    body: z.infer<typeof ExchangeItemUpdate>,
    idempotencyKey?: string,
  ) => {
    const opts: Options = { method: "PUT", body, authed: true, revalidate: false };
    if (idempotencyKey) opts.idempotencyKey = idempotencyKey;
    return call(`/v1/exchange-items/${id}`, ExchangeItem, opts);
  },

  deleteExchangeItem: async (id: string, idempotencyKey?: string): Promise<void> => {
    // The API returns 204 No Content; the `call` wrapper expects to parse a
    // schema for non-204 responses. Since this endpoint is always 204 on
    // success, pass a placeholder z.void schema; `call` short-circuits to
    // undefined when status === 204 before touching the schema.
    const opts: Options = { method: "DELETE", authed: true, revalidate: false };
    if (idempotencyKey) opts.idempotencyKey = idempotencyKey;
    await call(`/v1/exchange-items/${id}`, z.void(), opts);
  },

  uploadExchangeItemImage: (
    id: string,
    blob: Blob,
    filename: string,
    idempotencyKey?: string,
  ) => {
    const fd = new FormData();
    // FormData.append with (name, blob, filename) is the contract that
    // produces a multipart part with a `filename=` attribute — Hono's
    // formData() parser wants that to treat it as a file vs. a string field.
    fd.append("image", blob, filename);
    const opts: Options = { method: "POST", formBody: fd, authed: true, revalidate: false };
    if (idempotencyKey) opts.idempotencyKey = idempotencyKey;
    return call(`/v1/exchange-items/${id}/image`, ExchangeItem, opts);
  },

  // ─────────────────────── Saves
  isItemSaved: (id: string) =>
    call(`/v1/exchange-items/${id}/save`, SaveState, { authed: true, revalidate: false }),

  saveItem: (id: string, idempotencyKey?: string) => {
    const opts: Options = { method: "PUT", authed: true, revalidate: false };
    if (idempotencyKey) opts.idempotencyKey = idempotencyKey;
    return call(`/v1/exchange-items/${id}/save`, SaveState, opts);
  },

  unsaveItem: (id: string, idempotencyKey?: string) => {
    const opts: Options = { method: "DELETE", authed: true, revalidate: false };
    if (idempotencyKey) opts.idempotencyKey = idempotencyKey;
    return call(`/v1/exchange-items/${id}/save`, SaveState, opts);
  },

  listSavedItems: (opts: { cursor?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.cursor) params.set("cursor", opts.cursor);
    if (opts.limit) params.set("limit", String(opts.limit));
    const qs = params.toString() ? `?${params.toString()}` : "";
    return call(`/v1/saves${qs}`, cursorPage(ExchangeItem), { authed: true, revalidate: false });
  },

  // ─────────────────────── Messaging
  startConversation: (itemId: string, idempotencyKey?: string) => {
    const opts: Options = { method: "POST", authed: true, revalidate: false };
    if (idempotencyKey) opts.idempotencyKey = idempotencyKey;
    return call(`/v1/exchange-items/${itemId}/conversations`, Conversation, opts);
  },

  listConversations: (opts: { cursor?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.cursor) params.set("cursor", opts.cursor);
    if (opts.limit) params.set("limit", String(opts.limit));
    const qs = params.toString() ? `?${params.toString()}` : "";
    return call(`/v1/conversations${qs}`, cursorPage(Conversation), { authed: true, revalidate: false });
  },

  getConversation: (id: string) =>
    call(`/v1/conversations/${id}`, Conversation, { authed: true, revalidate: false }),

  listMessages: (conversationId: string, opts: { cursor?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.cursor) params.set("cursor", opts.cursor);
    if (opts.limit) params.set("limit", String(opts.limit));
    const qs = params.toString() ? `?${params.toString()}` : "";
    return call(
      `/v1/conversations/${conversationId}/messages${qs}`,
      cursorPage(Message),
      { authed: true, revalidate: false },
    );
  },

  sendMessage: (
    conversationId: string,
    body: z.infer<typeof MessageCreate>,
    idempotencyKey?: string,
  ) => {
    const opts: Options = { method: "POST", body, authed: true, revalidate: false };
    if (idempotencyKey) opts.idempotencyKey = idempotencyKey;
    return call(`/v1/conversations/${conversationId}/messages`, Message, opts);
  },

  unreadMessageCount: () =>
    call("/v1/conversations/unread-count", UnreadCount, { authed: true, revalidate: false }),

  // Mark-read is fire-and-forget on the client side — the response body
  // is empty (204) and the call's only purpose is bumping the
  // suppression window. The shared `call` helper expects a Zod schema
  // for response parsing, so this uses fetch directly.
  markConversationRead: async (conversationId: string): Promise<void> => {
    const session = await auth();
    if (!session?.access_token) return;
    await fetch(`${API_BASE}/v1/conversations/${conversationId}/read`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });
  },
};
