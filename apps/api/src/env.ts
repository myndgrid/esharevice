import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(8080),
  API_PUBLIC_URL: z.string().url().default("http://localhost:8080"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  // OIDC verifier — Auth.js is the issuer post Phase 3 teardown.
  // The API never signs tokens; it only verifies against the public JWKS
  // served by `apps/web/.well-known/jwks.json`. Var names kept under the
  // generic OIDC_* convention (not AUTHJS_*) so a future IdP swap is a
  // single-line env change.
  //   OIDC_ISSUER   = web origin (e.g. http://localhost:3000)
  //   OIDC_AUDIENCE = "esharevice-api" (matches AUTH_AUDIENCE on the web side)
  //   OIDC_JWKS_URL = ${web_origin}/.well-known/jwks.json
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
  // Resend transactional email — optional. The owner-notification on
  // reserve falls back to a no-op when either is empty.
  RESEND_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  // FROM address — must be on a domain that's verified in resend.com/domains.
  // Sends from unverified domains return 403 with `validation_error` and the
  // helper logs + Sentry-captures rather than failing the originating request.
  EMAIL_FROM: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  // Public origin used to build clickable links in emails. Defaults to the
  // CDN base host (which already encodes the domain); falls back to the
  // OIDC issuer's origin so links don't 404 if R2 isn't wired yet.
  WEB_PUBLIC_URL: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .pipe(z.string().url().optional()),

  // ─── Feature flags ───
  // Per the marketplace overhaul plan (tasks/2026-05-16_premium-marketplace-
  // redesign-plan.md §Execution Order), each new schema lives in prod from
  // day one but the endpoints that consume new fields gate on a flag. The
  // listing-taxonomy migration (0007) ships its schema + additive response
  // fields immediately; the dedicated /v1/categories endpoint 404s until
  // this flag flips on. Default off so an unset env defaults to safe legacy
  // behavior. Set "true" / "1" / "yes" / "on" to enable.
  FEATURE_LISTING_TYPES: z
    .string()
    .optional()
    .transform((v): boolean => {
      const norm = (v ?? "").trim().toLowerCase();
      return norm === "1" || norm === "true" || norm === "yes" || norm === "on";
    }),

  // FEATURE_BOOKINGS — gates the /v1/bookings endpoints (404 when off) and
  // the bookings-activate / bookings-complete cron jobs (no-op when off).
  // Schema (migration 0008) lives in prod from day one; only the routes +
  // crons gate on this flag. PR 11 flips it to true after Stripe Connect
  // (PR 4) and the booking flow UI (PR 9) are wired end-to-end.
  FEATURE_BOOKINGS: z
    .string()
    .optional()
    .transform((v): boolean => {
      const norm = (v ?? "").trim().toLowerCase();
      return norm === "1" || norm === "true" || norm === "yes" || norm === "on";
    }),

  // FEATURE_STRIPE — gates the /v1/payouts/* + /v1/webhooks/stripe endpoints
  // (404 when off) and the Stripe-side wiring inside the booking lifecycle
  // (payment_intent on booking-create, capture on accept, refund on cancel,
  // transfer on complete). When off, bookings still work but stay free.
  // Schema (migration 0009) is additive and lives in prod from day one.
  // Default off so an unset env defaults to safe legacy behavior.
  FEATURE_STRIPE: z
    .string()
    .optional()
    .transform((v): boolean => {
      const norm = (v ?? "").trim().toLowerCase();
      return norm === "1" || norm === "true" || norm === "yes" || norm === "on";
    }),

  // ─── Stripe Connect (PR 4) ───
  // Test mode: keys start with sk_test_* / whsec_*. Production: sk_live_*.
  // The Stripe SDK is initialized lazily — when these are absent, every
  // /v1/payouts/* endpoint returns 503 and the booking flow stays Stripe-free.
  // Mirrors the R2 env-gate pattern.
  STRIPE_SECRET_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  STRIPE_WEBHOOK_SECRET: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  // Country for newly-provisioned Connect accounts. CAD merchant for the
  // Toronto launch; future markets will provision separate accounts.
  STRIPE_ACCOUNT_COUNTRY: z.string().length(2).default("CA"),
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

/** True iff both Resend creds are present. */
export function emailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}
