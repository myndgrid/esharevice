import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { getDb, stripeAccounts, type StripeAccountRow } from "@esharevice/db";
import { PayoutAccount, PayoutAccountLink } from "@esharevice/shared";
import { requireAuth } from "../../middleware/auth.js";
import { idempotency } from "../../middleware/idempotency.js";
import {
  createAccountOnboardingLink,
  createExpressAccount,
  stripeConfigured,
} from "../../lib/stripe.js";
import { env } from "../../env.js";
import type { AppEnv } from "../../app.js";

const route = new OpenAPIHono<AppEnv>();

const ProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number(),
    detail: z.string().optional(),
    instance: z.string().optional(),
  })
  .openapi("Problem");
const problemContent = { "application/problem+json": { schema: ProblemSchema } };

const PayoutAccountSchema = PayoutAccount.openapi("PayoutAccount");
const PayoutAccountLinkSchema = PayoutAccountLink.openapi("PayoutAccountLink");
const EmptyBodySchema = z.object({}).strict().openapi("EmptyBody");

function toApiAccount(row: StripeAccountRow): z.infer<typeof PayoutAccountSchema> {
  return PayoutAccount.parse({
    status: row.status,
    charges_enabled: row.charges_enabled,
    payouts_enabled: row.payouts_enabled,
    details_submitted: row.details_submitted,
    country: row.country,
    default_currency: row.default_currency,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  });
}

/** 404 the entire route surface when Stripe isn't configured + feature off. */
function requireStripeFlag(): void {
  if (!stripeConfigured()) {
    throw new HTTPException(404, { message: "Not Found" });
  }
}

// ─────────────────────── POST /v1/payouts/account
route.openapi(
  createRoute({
    method: "post",
    path: "/payouts/account",
    tags: ["payouts"],
    summary: "Create or fetch the caller's Stripe Connect account + onboarding link.",
    description:
      "Idempotent: returns the existing account if one is already linked. The " +
      "`onboarding_url` is a short-lived (~5 min) Stripe-hosted link the caller " +
      "redirects to. Returns null `onboarding_url` once the account is fully set up.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth, idempotency()] as const,
    request: { body: { content: { "application/json": { schema: EmptyBodySchema } } } },
    responses: {
      200: { description: "OK", content: { "application/json": { schema: PayoutAccountLinkSchema } } },
      401: { description: "Unauthenticated", content: problemContent },
      404: { description: "Stripe not configured", content: problemContent },
    },
  }),
  async (c) => {
    requireStripeFlag();
    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });

    const db = getDb();
    const existing = await db
      .select()
      .from(stripeAccounts)
      .where(eq(stripeAccounts.user_id, u.id))
      .limit(1);

    let account: StripeAccountRow;
    let stripeAccountId: string;
    if (existing[0]) {
      account = existing[0];
      stripeAccountId = account.account_id;
    } else {
      // Lazy-create the Stripe Express account + persist our mirror row.
      // Wrap in try/catch so a Stripe error surfaces clean instead of crashing.
      let created;
      try {
        created = await createExpressAccount({ email: u.email, userId: u.id });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Stripe create failed";
        throw new HTTPException(502, { message: `Stripe error: ${msg}` });
      }
      stripeAccountId = created.id;
      const inserted = await db
        .insert(stripeAccounts)
        .values({
          user_id: u.id,
          account_id: stripeAccountId,
          status: "pending",
          country: env.STRIPE_ACCOUNT_COUNTRY,
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new HTTPException(500, { message: "insert returned no rows" });
      account = row;
    }

    // Active accounts don't need re-onboarding — return a null link so the
    // UI shows "Open Stripe dashboard" instead of "Continue setup".
    let onboardingUrl: string | null = null;
    if (account.status !== "active") {
      const link = await createAccountOnboardingLink({
        accountId: stripeAccountId,
        refreshUrl: `${env.WEB_PUBLIC_URL ?? env.WEB_ORIGIN}/payouts/setup`,
        returnUrl: `${env.WEB_PUBLIC_URL ?? env.WEB_ORIGIN}/payouts/done`,
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Stripe link failed";
        throw new HTTPException(502, { message: `Stripe error: ${msg}` });
      });
      onboardingUrl = link.url;
    }

    return c.json(
      PayoutAccountLink.parse({
        account: toApiAccount(account),
        onboarding_url: onboardingUrl,
      }),
      200,
    );
  },
);

// ─────────────────────── GET /v1/payouts/status
route.openapi(
  createRoute({
    method: "get",
    path: "/payouts/status",
    tags: ["payouts"],
    summary: "Fetch the caller's Stripe Connect account status mirror.",
    description:
      "Returns the cached account-state mirror from our DB (kept in sync via " +
      "the account.updated webhook). Does NOT hit Stripe's API — fast read.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth] as const,
    responses: {
      200: { description: "OK", content: { "application/json": { schema: PayoutAccountSchema } } },
      401: { description: "Unauthenticated", content: problemContent },
      404: { description: "No Stripe account yet / Stripe not configured", content: problemContent },
    },
  }),
  async (c) => {
    requireStripeFlag();
    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });
    const db = getDb();
    const rows = await db
      .select()
      .from(stripeAccounts)
      .where(eq(stripeAccounts.user_id, u.id))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new HTTPException(404, {
        message: "No Stripe account for this user. POST /v1/payouts/account first.",
      });
    }
    return c.json(toApiAccount(row), 200);
  },
);

export default route;
