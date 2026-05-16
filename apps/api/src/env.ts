import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(8080),
  API_PUBLIC_URL: z.string().url().default("http://localhost:8080"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  // OIDC — Authentik is the issuer. The API never signs or stores secrets for tokens.
  OIDC_ISSUER: z.string().url(),
  OIDC_AUDIENCE: z.string().min(1),
  OIDC_JWKS_URL: z.string().url(),
  // Cloudflare R2 — optional at boot so dev/test can run without uploads wired.
  // If any of {account_id, access_key, secret, bucket} are absent the upload
  // endpoint returns 503; everything else still works.
  // `.transform(undefined-on-empty)` lets docker-compose pass `${VAR:-}`
  // (empty string when unset) without tripping Zod — empty == absent here.
  R2_ACCOUNT_ID: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  R2_ACCESS_KEY_ID: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  R2_SECRET_ACCESS_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  R2_BUCKET: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  // Public URL prefix for image variants. Examples:
  //   https://cdn.esharevice.com         (custom domain bound to the R2 bucket)
  //   https://pub-<hash>.r2.dev          (default R2 dev URL)
  // The API composes URLs as `${CDN_BASE_URL}/<img_key>/<width>.webp`.
  // Validate as a URL only when actually set — empty string == absent.
  CDN_BASE_URL: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .pipe(z.string().url().optional()),
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);

/** True iff all four R2 creds and a CDN base URL are present. */
export function r2Configured(): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY &&
      env.R2_BUCKET &&
      env.CDN_BASE_URL,
  );
}
