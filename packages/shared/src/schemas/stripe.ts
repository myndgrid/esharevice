import { z } from "zod";

/**
 * Stripe Connect account state mirror — shipped on the wire for the provider's
 * payout-setup UI. Drives the "Continue setup" vs "Open dashboard" CTA logic
 * on the /payouts page (PR 11).
 *
 * Status meanings:
 *   • pending     — account created server-side, provider hasn't started Stripe onboarding yet
 *   • restricted  — onboarding incomplete OR Stripe paused the account (info needed)
 *   • active      — charges + payouts both enabled; can accept bookings
 *   • rejected    — Stripe terminated the account (terminal)
 */
export const StripeAccountStatus = z.enum(["pending", "restricted", "active", "rejected"]);
export type StripeAccountStatus = z.infer<typeof StripeAccountStatus>;

export const PayoutAccount = z.object({
  status: StripeAccountStatus,
  charges_enabled: z.boolean(),
  payouts_enabled: z.boolean(),
  details_submitted: z.boolean(),
  country: z.string().length(2),
  default_currency: z.literal("CAD"),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type PayoutAccount = z.infer<typeof PayoutAccount>;

/**
 * Return shape of POST /v1/payouts/account — the Stripe-hosted onboarding URL
 * the provider needs to visit, plus the current account state so the caller
 * can decide whether to redirect immediately or surface a "you're already set up"
 * confirmation.
 */
export const PayoutAccountLink = z.object({
  account: PayoutAccount,
  // Stripe AccountLink URL — short-lived (5 min default). Caller redirects
  // the user to this; Stripe handles the rest of onboarding.
  onboarding_url: z.string().url().nullable(),
});
export type PayoutAccountLink = z.infer<typeof PayoutAccountLink>;
