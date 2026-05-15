import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_API_URL: z.string().url().default("http://localhost:8080"),
  OIDC_ISSUER: z.string().url(),
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
  OIDC_REDIRECT_URI: z.string().url(),
  SESSION_COOKIE_SECRET: z
    .string()
    .min(32, "SESSION_COOKIE_SECRET must be at least 32 chars (use `openssl rand -hex 32`)"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/**
 * Lazy env accessor — parses on first call, throws if required vars are missing.
 *
 * Why lazy: Next.js's `next build` step statically evaluates module-level code
 * in API route handlers (during "Collecting page data"). A top-level `const env
 * = parse(...)` would run at build time when OIDC_* vars aren't set in the
 * Docker build environment. Lazy evaluation defers the parse until the first
 * runtime request, when the env IS populated by Docker Compose.
 */
export function getEnv(): Env {
  if (cached) return cached;
  cached = EnvSchema.parse({
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    OIDC_ISSUER: process.env.OIDC_ISSUER,
    OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID,
    OIDC_CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET,
    OIDC_REDIRECT_URI: process.env.OIDC_REDIRECT_URI,
    SESSION_COOKIE_SECRET: process.env.SESSION_COOKIE_SECRET,
  });
  return cached;
}
