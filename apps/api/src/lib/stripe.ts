/**
 * Stripe SDK singleton + thin helpers. The endpoints + booking lifecycle
 * call these instead of importing Stripe directly so behaviour is
 * env-gated and testable.
 *
 * Pattern: each helper takes the resolved Stripe instance via `getStripe()`
 * which throws when keys are absent — every consumer wraps with
 * `if (!stripeConfigured()) return 503`. Mirrors the R2 env-gate shape.
 *
 * Plan §Backend Systems — Stripe Connect:
 *   • Express accounts (Stripe-hosted onboarding)
 *   • manual_capture so accept = capture, decline = void (no refund visible)
 *   • transfer_data.destination → Stripe routes funds at capture time
 *   • Drizzle insert BEFORE the Stripe call so the EXCLUDE constraint
 *     catches double-bookings before any money moves
 */
import Stripe from "stripe";
import { env } from "../env.js";

/** True iff Stripe keys are present and the feature flag is on. */
export function stripeConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.FEATURE_STRIPE);
}

let cached: Stripe | null = null;

/**
 * Returns the lazy-initialised Stripe client. Throws if keys are missing —
 * callers MUST gate with `stripeConfigured()` first. The throw is a defensive
 * trip-wire for the rare case the env shifts mid-process.
 */
export function getStripe(): Stripe {
  if (cached) return cached;
  const key = env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  // Use the SDK's default apiVersion — bumping it is a deliberate action
  // tied to an SDK upgrade. Pin once we hit production traffic.
  cached = new Stripe(key, {
    typescript: true,
    appInfo: {
      name: "e-Sharevice",
      version: "0.1.0",
      url: "https://esharevice.com",
    },
  });
  return cached;
}

/**
 * Reset the cached Stripe instance. Test helper — production never calls this.
 * @internal
 */
export function __resetStripeForTests(): void {
  cached = null;
}

// ─────────────────────── Express account onboarding

/**
 * Create a Stripe Express account for a Canadian provider. Returns the
 * account ID so the caller can persist it in stripe_accounts. The actual
 * onboarding link is a separate call (createAccountLink below) so the
 * caller can decide whether to redirect immediately or just provision
 * the account in the background.
 */
export async function createExpressAccount(input: {
  email: string;
  userId: string;
}): Promise<Stripe.Account> {
  const stripe = getStripe();
  return stripe.accounts.create({
    type: "express",
    country: env.STRIPE_ACCOUNT_COUNTRY,
    email: input.email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    business_type: "individual", // Default; providers can change in onboarding
    metadata: { user_id: input.userId },
  });
}

/**
 * Build a Stripe-hosted onboarding link. Short-lived (5 min default Stripe
 * side). `refresh_url` is where Stripe sends the user back if the link
 * expires; `return_url` is the post-onboarding landing page. Both URLs
 * are app-side so we control the post-flow UX.
 */
export async function createAccountOnboardingLink(input: {
  accountId: string;
  refreshUrl: string;
  returnUrl: string;
}): Promise<Stripe.AccountLink> {
  const stripe = getStripe();
  return stripe.accountLinks.create({
    account: input.accountId,
    refresh_url: input.refreshUrl,
    return_url: input.returnUrl,
    type: "account_onboarding",
  });
}

// ─────────────────────── Booking payment lifecycle

/**
 * Create a PaymentIntent for a confirmed-not-yet-captured booking.
 *
 * Three load-bearing config choices:
 *   • capture_method: "manual" — funds are AUTHORIZED but not captured.
 *     The provider's accept call triggers capture; their decline triggers
 *     a void (no refund visible on the renter's statement).
 *   • transfer_data.destination — Stripe routes funds to the provider's
 *     Connect account at capture time. We never hold the money in the
 *     platform account except for the platform fee.
 *   • application_fee_amount — the platform's take, deducted from the
 *     captured amount before transfer.
 *
 * Idempotency-Key is per-booking so retries from the route handler are safe.
 */
export async function createBookingPaymentIntent(input: {
  bookingId: string;
  amountCents: number;
  applicationFeeCents: number;
  providerAccountId: string;
  customerEmail?: string;
  description?: string;
}): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();
  return stripe.paymentIntents.create(
    {
      amount: input.amountCents,
      currency: "cad",
      capture_method: "manual",
      payment_method_types: ["card"],
      application_fee_amount: input.applicationFeeCents,
      transfer_data: { destination: input.providerAccountId },
      ...(input.customerEmail ? { receipt_email: input.customerEmail } : {}),
      ...(input.description ? { description: input.description } : {}),
      metadata: { booking_id: input.bookingId },
    },
    { idempotencyKey: `booking:${input.bookingId}:intent` },
  );
}

/** Capture an authorized PaymentIntent. Called from POST /v1/bookings/:id/accept. */
export async function capturePaymentIntent(intentId: string): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();
  return stripe.paymentIntents.capture(intentId);
}

/**
 * Cancel an authorized-but-uncaptured PaymentIntent. Called from
 * POST /v1/bookings/:id/decline. The auth hold is released; no refund
 * appears on the renter's statement (Stripe convention for `manual_capture`
 * cancels).
 */
export async function cancelPaymentIntent(intentId: string): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();
  return stripe.paymentIntents.cancel(intentId);
}

/**
 * Refund a captured PaymentIntent. Called from POST /v1/bookings/:id/cancel
 * (after the booking was confirmed-and-captured). Refund hits the renter's
 * card; the application fee is also reversed unless `refund_application_fee`
 * is false.
 *
 * Deposit-aware: callers pass the refund amount they want. Partial refunds
 * are supported by passing a non-null amount.
 */
export async function refundPaymentIntent(input: {
  intentId: string;
  amountCents?: number;
  reason?: Stripe.RefundCreateParams.Reason;
}): Promise<Stripe.Refund> {
  const stripe = getStripe();
  return stripe.refunds.create(
    {
      payment_intent: input.intentId,
      ...(input.amountCents !== undefined ? { amount: input.amountCents } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      refund_application_fee: true,
      reverse_transfer: true,
    },
    { idempotencyKey: `booking:${input.intentId}:refund` },
  );
}

// ─────────────────────── Webhook helper

/**
 * Verify a Stripe webhook signature and parse the event. Returns the parsed
 * Stripe.Event on success, throws on signature mismatch or missing config.
 *
 * The raw body MUST be a string or Buffer — the JSON-parsed shape is NOT
 * accepted because the signature is computed over the bytes. See the
 * webhooks-stripe route for the `c.req.text()` pattern.
 */
export function constructWebhookEvent(input: {
  rawBody: string;
  signature: string;
}): Stripe.Event {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  }
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(
    input.rawBody,
    input.signature,
    env.STRIPE_WEBHOOK_SECRET,
  );
}
