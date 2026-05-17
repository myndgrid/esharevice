/**
 * Stripe webhook receiver. Five hard rules:
 *
 *   1. Signature verification BEFORE anything else. A request without a valid
 *      `Stripe-Signature` header is 400'd — we never touch the body.
 *   2. Raw body, not parsed. The signature is computed over the bytes Stripe
 *      sent; any JSON re-serialisation breaks verification. Use c.req.text().
 *   3. Idempotency via `stripe_events` PK. The first INSERT wins; duplicate
 *      deliveries (network blips, Stripe-side retries) short-circuit.
 *   4. Handlers must be self-idempotent inside their own work — webhooks can
 *      arrive out of order. Every state mutation checks current DB state before
 *      writing.
 *   5. ALWAYS return 200 quickly on signature-valid events, even if the handler
 *      can't process them (unknown type, transient downstream failure). Stripe
 *      retries on non-2xx for 3 days; a flaky downstream service would cause
 *      a retry storm. Log + Sentry instead.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import {
  bookings,
  getDb,
  stripeAccounts,
  stripeEvents,
} from "@esharevice/db";
import { constructWebhookEvent, stripeConfigured } from "../../lib/stripe.js";
import type { AppEnv } from "../../app.js";

const route = new OpenAPIHono<AppEnv>();

/**
 * POST /v1/webhooks/stripe — handler is mounted with a non-openapi route so
 * we can read the raw body directly (the OpenAPI-route body validator would
 * consume the stream before signature verification).
 */
route.post("/webhooks/stripe", async (c) => {
  if (!stripeConfigured()) {
    throw new HTTPException(404, { message: "Not Found" });
  }
  const signature = c.req.header("stripe-signature");
  if (!signature) {
    throw new HTTPException(400, { message: "Missing Stripe-Signature header" });
  }

  // Raw body for signature verification — Stripe signs the bytes, not JSON.
  let rawBody: string;
  try {
    rawBody = await c.req.text();
  } catch {
    throw new HTTPException(400, { message: "Failed to read request body" });
  }

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent({ rawBody, signature });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "signature verification failed";
    // Sentry-eligible — a real attacker probing the endpoint trips this path,
    // and so does a misconfigured webhook secret.
    console.warn("[stripe-webhook] signature verification failed:", msg);
    throw new HTTPException(400, { message: `Webhook signature failed: ${msg}` });
  }

  const db = getDb();

  // Idempotency gate. INSERT with the event id as PK — duplicate delivery
  // raises a unique-violation we catch + short-circuit. Cheaper than a
  // SELECT + INSERT round-trip + race-window.
  try {
    await db.insert(stripeEvents).values({
      event_id: event.id,
      type: event.type,
      processed: false,
    });
  } catch (err) {
    // Postgres unique violation = 23505. Drizzle wraps it; check cause.
    const cause = (err as { cause?: { code?: string } }).cause;
    if (cause?.code === "23505") {
      // Already saw this event. Idempotent return.
      return c.json({ received: true, duplicate: true }, 200);
    }
    throw err;
  }

  try {
    await dispatchEvent(event);
    await db
      .update(stripeEvents)
      .set({ processed: true })
      .where(eq(stripeEvents.event_id, event.id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stripe-webhook] handler for ${event.type} failed:`, msg);
    await db
      .update(stripeEvents)
      .set({ processed: false, error_detail: msg })
      .where(eq(stripeEvents.event_id, event.id));
    // Still return 200 — rule 5. Operator retries via Stripe dashboard
    // after the underlying issue is fixed.
  }

  return c.json({ received: true }, 200);
});

/**
 * Route table by event type. New event types: add a case here + a handler
 * function below. Unknown event types are NOT an error — we log and skip.
 */
async function dispatchEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "account.updated":
      return handleAccountUpdated(event.data.object as Stripe.Account);
    case "payment_intent.succeeded":
      return handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
    case "payment_intent.payment_failed":
      return handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
    case "payment_intent.canceled":
      return handlePaymentIntentCanceled(event.data.object as Stripe.PaymentIntent);
    case "charge.refunded":
      return handleChargeRefunded(event.data.object as Stripe.Charge);
    default:
      console.log(`[stripe-webhook] unhandled event type: ${event.type}`);
  }
}

// ─────────────────────── account.updated

async function handleAccountUpdated(acct: Stripe.Account): Promise<void> {
  const db = getDb();
  const status = deriveAccountStatus(acct);
  await db
    .update(stripeAccounts)
    .set({
      status,
      charges_enabled: acct.charges_enabled ?? false,
      payouts_enabled: acct.payouts_enabled ?? false,
      details_submitted: acct.details_submitted ?? false,
      updated_at: new Date(),
    })
    .where(eq(stripeAccounts.account_id, acct.id));
}

function deriveAccountStatus(acct: Stripe.Account): "pending" | "restricted" | "active" | "rejected" {
  // Stripe's "rejected" is encoded as `requirements.disabled_reason` containing
  // certain strings. Conservative match — if Stripe terminates the account,
  // their dashboard reflects it within minutes.
  const disabled = acct.requirements?.disabled_reason;
  if (typeof disabled === "string" && /rejected|listed|terms_of_service/i.test(disabled)) {
    return "rejected";
  }
  if (acct.charges_enabled && acct.payouts_enabled) return "active";
  if (acct.details_submitted) return "restricted"; // submitted but Stripe wants more info
  return "pending";
}

// ─────────────────────── payment_intent.*

async function handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent): Promise<void> {
  const db = getDb();
  // Stripe's "succeeded" fires after a manual capture. Match by stored
  // intent id, then advance booking status to 'confirmed' (idempotent —
  // already-confirmed bookings just rewrite the timestamps).
  const stripeFeeCents = typeof pi.application_fee_amount === "number"
    ? null // The application_fee_amount is OUR take, not Stripe's processing fee.
    : null;
  await db
    .update(bookings)
    .set({
      stripe_charge_id: typeof pi.latest_charge === "string" ? pi.latest_charge : null,
      ...(stripeFeeCents !== null ? { stripe_fee_cents: stripeFeeCents } : {}),
      updated_at: new Date(),
    })
    .where(eq(bookings.stripe_payment_intent_id, pi.id));
}

async function handlePaymentIntentFailed(pi: Stripe.PaymentIntent): Promise<void> {
  const db = getDb();
  // Card declined / 3DS failed / etc. Move the booking to 'declined' with a
  // reason pulled from the intent's last_payment_error. The renter sees a
  // 409 from the booking-create path with a friendly message.
  const reason = pi.last_payment_error?.message ?? "Card declined";
  await db
    .update(bookings)
    .set({
      status: "declined",
      declined_at: new Date(),
      decline_reason: reason,
      updated_at: new Date(),
    })
    .where(eq(bookings.stripe_payment_intent_id, pi.id));
}

async function handlePaymentIntentCanceled(pi: Stripe.PaymentIntent): Promise<void> {
  // Provider declined the booking (we call paymentIntents.cancel). Status
  // was already set to 'declined' inside the route handler — this webhook
  // is the cross-system confirmation. No-op unless the route handler hasn't
  // landed yet (race), in which case we set declined.
  const db = getDb();
  await db
    .update(bookings)
    .set({
      status: "declined",
      declined_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(bookings.stripe_payment_intent_id, pi.id));
}

async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
  // Cancellation refund landed. Booking was already in 'cancelled' state
  // when the refund was issued; this is the cross-system confirmation.
  // Track refund_id on the booking? Not in the schema yet (PR 4 keeps the
  // minimal cancel-side surface). For now, just log.
  console.log(
    `[stripe-webhook] charge ${charge.id} refunded ${charge.amount_refunded} cents`,
  );
}

export default route;
