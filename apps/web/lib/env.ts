import { z } from "zod";

/**
 * apps/web env schema. Post-Phase-3 of the Authentik teardown, the only
 * runtime value this app needs from env (outside the Auth.js stack, which
 * reads its own AUTH_* vars directly) is the API base URL.
 *
 * Auth.js manages its own env reads inside apps/web/auth.ts — those vars
 * (AUTH_SECRET, AUTH_JWT_PRIVATE_KEY, AUTH_GOOGLE_*, etc.) intentionally
 * don't go through this module.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_API_URL: z.string().url().default("http://localhost:8080"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/**
 * Lazy env accessor — parses on first call. Lazy because `next build`
 * statically evaluates module-level code; deferring the parse keeps the
 * build step env-independent.
 */
export function getEnv(): Env {
  if (cached) return cached;
  cached = EnvSchema.parse({
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  });
  return cached;
}
