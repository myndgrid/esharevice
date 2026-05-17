import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  getDb,
  bookings,
  exchangeItems,
  stripeAccounts,
  type BookingRow,
  type ExchangeItemRow,
} from "@esharevice/db";
import {
  Booking,
  BookingCancel,
  BookingCreate,
  BookingCreateResponse,
  BookingDecline,
  BookingEmptyBody,
  BookingListQuery,
  cursorPage,
} from "@esharevice/shared";
import { requireAuth } from "../../middleware/auth.js";
import { idempotency } from "../../middleware/idempotency.js";
import { decodeCursor, encodeCursor } from "../../lib/cursor.js";
import { calculateTotals, quantityFromRange } from "../../lib/pricing.js";
import {
  cancelPaymentIntent,
  capturePaymentIntent,
  createBookingPaymentIntent,
  refundPaymentIntent,
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

const BookingSchema = Booking.openapi("Booking");
const BookingCreateSchema = BookingCreate.openapi("BookingCreate");
const BookingCreateResponseSchema = BookingCreateResponse.openapi("BookingCreateResponse");
const BookingDeclineSchema = BookingDecline.openapi("BookingDecline");
const BookingCancelSchema = BookingCancel.openapi("BookingCancel");
const BookingEmptyBodySchema = BookingEmptyBody.openapi("BookingEmptyBody");
const BookingListQuerySchema = BookingListQuery.openapi("BookingListQuery");
const BookingListResponseSchema = cursorPage(Booking).openapi("BookingPage");
const IdParamSchema = z.object({ id: z.string().uuid() }).openapi("IdParam");

const problemContent = { "application/problem+json": { schema: ProblemSchema } };

/**
 * Translate a Drizzle row into the wire shape. Dates → ISO strings. Money
 * fields stay as integers — formatting belongs on the client.
 */
function toApiBooking(row: BookingRow): z.infer<typeof BookingSchema> {
  return Booking.parse({
    id: row.id,
    item_id: row.item_id,
    renter_id: row.renter_id,
    provider_id: row.provider_id,
    status: row.status,
    start_at: row.start_at?.toISOString() ?? null,
    end_at: row.end_at?.toISOString() ?? null,
    price_cents: row.price_cents,
    price_unit: row.price_unit ?? null,
    quantity: row.quantity,
    subtotal_cents: row.subtotal_cents,
    platform_fee_cents: row.platform_fee_cents,
    stripe_fee_cents: row.stripe_fee_cents ?? null,
    deposit_cents: row.deposit_cents,
    total_cents: row.total_cents,
    currency: row.currency,
    stripe_payment_intent_id: row.stripe_payment_intent_id ?? null,
    stripe_charge_id: row.stripe_charge_id ?? null,
    stripe_transfer_id: row.stripe_transfer_id ?? null,
    message_to_provider: row.message_to_provider ?? null,
    decline_reason: row.decline_reason ?? null,
    cancel_reason: row.cancel_reason ?? null,
    cancelled_by: row.cancelled_by ?? null,
    requested_at: row.requested_at.toISOString(),
    confirmed_at: row.confirmed_at?.toISOString() ?? null,
    active_at: row.active_at?.toISOString() ?? null,
    returned_at: row.returned_at?.toISOString() ?? null,
    completed_at: row.completed_at?.toISOString() ?? null,
    declined_at: row.declined_at?.toISOString() ?? null,
    cancelled_at: row.cancelled_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  });
}

/**
 * Feature-flag guard for every endpoint. When FEATURE_BOOKINGS is off the
 * whole route surface 404s, mirroring the plan's "schema lives, routes hide"
 * pattern. Single point of control so the flag can flip atomically in PR 11.
 */
function requireBookingsFlag(): void {
  if (!env.FEATURE_BOOKINGS) {
    throw new HTTPException(404, { message: "Not Found" });
  }
}

/**
 * Look up an item by id, including listing-type/price/availability fields
 * needed to price + validate a booking against. Throws 404 if archived or
 * missing.
 */
async function loadItemForBooking(itemId: string): Promise<ExchangeItemRow> {
  const db = getDb();
  const rows = await db
    .select()
    .from(exchangeItems)
    .where(and(eq(exchangeItems.id, itemId), isNull(exchangeItems.archived_at)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new HTTPException(404, { message: "Item not found" });
  return row;
}

/**
 * Look up a booking by id. The caller must be one of (renter, provider).
 * Anyone else gets 404 (not 403) so we don't leak the booking's existence.
 */
async function loadBookingForActor(id: string, userId: string): Promise<BookingRow> {
  const db = getDb();
  const rows = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new HTTPException(404, { message: "Not Found" });
  if (row.renter_id !== userId && row.provider_id !== userId) {
    throw new HTTPException(404, { message: "Not Found" });
  }
  return row;
}

// ─────────────────────── POST /v1/items/:id/bookings
route.openapi(
  createRoute({
    method: "post",
    path: "/items/{id}/bookings",
    tags: ["bookings"],
    summary: "Create a booking for an exchange item.",
    description:
      "Renter creates a booking against a paid listing (rent / hire / sell). " +
      "Pricing snapshot computed server-side from current item price + " +
      "request quantity. SQL EXCLUDE constraint protects against overlapping " +
      "rent/hire bookings on the same item — second concurrent request 409s. " +
      "When Stripe is configured AND the provider's Connect account is active, " +
      "the response includes a `client_secret` for Stripe Elements. Otherwise " +
      "`client_secret` is null and the booking exists but has no payment leg.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth, idempotency()] as const,
    request: {
      params: IdParamSchema,
      body: { content: { "application/json": { schema: BookingCreateSchema } } },
    },
    responses: {
      201: { description: "Created", content: { "application/json": { schema: BookingCreateResponseSchema } } },
      400: { description: "Validation failed / provider not Stripe-ready when Stripe required", content: problemContent },
      401: { description: "Unauthenticated", content: problemContent },
      404: { description: "Item not found / feature disabled", content: problemContent },
      409: { description: "Date range overlaps an existing booking, or renter is the item owner", content: problemContent },
      502: { description: "Stripe call failed", content: problemContent },
    },
  }),
  async (c) => {
    requireBookingsFlag();
    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });
    const { id: itemId } = c.req.valid("param");
    const body = c.req.valid("json");

    const item = await loadItemForBooking(itemId);

    // Booking flow is paid-types-only. Gift + trade have their own flows.
    if (item.listing_type !== "rent" && item.listing_type !== "hire" && item.listing_type !== "sell") {
      throw new HTTPException(400, {
        message: `Listing type '${item.listing_type}' doesn't accept bookings. Use the messages flow.`,
      });
    }

    // Cannot book your own listing.
    if (item.user_id === u.id) {
      throw new HTTPException(409, { message: "Cannot book your own listing" });
    }

    // Pricing snapshot — every paid type has price_cents (the 0007 CHECK
    // enforces this), so non-null is invariant at this point.
    if (item.price_cents === null) {
      throw new HTTPException(500, { message: "Item is paid-type but has no price" });
    }

    // Date-pair validation: rent + hire require start/end; sell forbids them.
    const hasDates = body.start_at !== undefined && body.end_at !== undefined;
    if (item.listing_type === "sell" && hasDates) {
      throw new HTTPException(400, {
        message: "Sell listings are instantaneous; omit start_at and end_at.",
      });
    }
    if ((item.listing_type === "rent" || item.listing_type === "hire") && !hasDates) {
      throw new HTTPException(400, {
        message: `${item.listing_type} listings need start_at and end_at.`,
      });
    }

    const start_at = hasDates ? new Date(body.start_at!) : null;
    const end_at = hasDates ? new Date(body.end_at!) : null;

    // Derive quantity: client may override for hire bookings priced by hour
    // where the renter wants explicit control. Default uses the date range.
    let quantity: number;
    if (start_at && end_at) {
      quantity = body.quantity ?? quantityFromRange(item.price_unit, start_at, end_at);
    } else {
      quantity = body.quantity ?? 1;
    }

    const totals = calculateTotals({
      listing_type: item.listing_type,
      price_cents: item.price_cents,
      price_unit: item.price_unit,
      quantity,
      deposit_cents: item.listing_type === "rent" ? item.deposit_cents ?? 0 : 0,
    });

    const db = getDb();

    // Insert FIRST — the EXCLUDE constraint catches double-bookings before
    // any Stripe call. Critical ordering: SQL invariant before money moves.
    let row: BookingRow;
    try {
      const inserted = await db
        .insert(bookings)
        .values({
          item_id: item.id,
          renter_id: u.id,
          provider_id: item.user_id,
          status: "requested",
          start_at,
          end_at,
          price_cents: item.price_cents,
          price_unit: item.price_unit ?? null,
          quantity,
          subtotal_cents: totals.subtotal_cents,
          platform_fee_cents: totals.platform_fee_cents,
          deposit_cents: totals.deposit_cents,
          total_cents: totals.total_cents,
          message_to_provider: body.message_to_provider ?? null,
        })
        .returning();
      const ins = inserted[0];
      if (!ins) throw new HTTPException(500, { message: "insert returned no rows" });
      row = ins;
    } catch (err) {
      const cause = (err as { cause?: { code?: string; constraint_name?: string } }).cause;
      if (
        cause?.code === "23P01" ||
        cause?.constraint_name === "bookings_no_overlap" ||
        (err instanceof Error && /23P01|exclusion_violation|bookings_no_overlap/i.test(err.message))
      ) {
        throw new HTTPException(409, {
          message: "Those dates overlap an existing booking on this item. Try a different range.",
        });
      }
      throw err;
    }

    // Stripe leg — only when configured AND the provider has an active
    // Connect account. Otherwise the booking exists but is payment-free
    // (free trade-paths reuse this for backward compat with PR 3).
    let clientSecret: string | null = null;
    if (stripeConfigured()) {
      const acctRows = await db
        .select()
        .from(stripeAccounts)
        .where(eq(stripeAccounts.user_id, item.user_id))
        .limit(1);
      const acct = acctRows[0];
      if (!acct || acct.status !== "active") {
        // Provider needs to finish Stripe onboarding before they can accept
        // paid bookings. Roll back the booking row so the renter doesn't
        // see a stuck 'requested' booking.
        await db.delete(bookings).where(eq(bookings.id, row.id));
        throw new HTTPException(400, {
          message:
            "This provider hasn't set up payouts yet. They'll need to finish Stripe onboarding before accepting bookings.",
        });
      }
      let intent;
      try {
        intent = await createBookingPaymentIntent({
          bookingId: row.id,
          amountCents: row.total_cents,
          applicationFeeCents: row.platform_fee_cents,
          providerAccountId: acct.account_id,
          customerEmail: u.email,
          description: `Booking ${row.id.slice(0, 8)} — ${item.service}`,
        });
      } catch (err) {
        // Stripe call failed — roll back the booking. The renter's card
        // was never charged (PaymentIntent never created); state stays clean.
        await db.delete(bookings).where(eq(bookings.id, row.id));
        const msg = err instanceof Error ? err.message : "Stripe create failed";
        throw new HTTPException(502, { message: `Stripe error: ${msg}` });
      }
      // Update booking with the intent id; surface client_secret for Elements.
      const updated = await db
        .update(bookings)
        .set({
          stripe_payment_intent_id: intent.id,
          updated_at: new Date(),
        })
        .where(eq(bookings.id, row.id))
        .returning();
      const u2 = updated[0];
      if (u2) row = u2;
      clientSecret = intent.client_secret ?? null;
    }

    return c.json(
      BookingCreateResponse.parse({
        booking: toApiBooking(row),
        client_secret: clientSecret,
      }),
      201,
    );
  },
);

// ─────────────────────── GET /v1/bookings
route.openapi(
  createRoute({
    method: "get",
    path: "/bookings",
    tags: ["bookings"],
    summary: "List the caller's bookings (as renter or provider).",
    security: [{ Bearer: [] }],
    middleware: [requireAuth] as const,
    request: { query: BookingListQuerySchema },
    responses: {
      200: { description: "OK", content: { "application/json": { schema: BookingListResponseSchema } } },
      401: { description: "Unauthenticated", content: problemContent },
      404: { description: "Feature disabled", content: problemContent },
    },
  }),
  async (c) => {
    requireBookingsFlag();
    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });

    const { cursor: cursorRaw, limit, role, status } = c.req.valid("query");
    const cursor = decodeCursor(cursorRaw);

    const actorColumn = role === "renter" ? bookings.renter_id : bookings.provider_id;
    const conditions = [eq(actorColumn, u.id)];
    if (status) conditions.push(eq(bookings.status, status));
    if (cursor) {
      conditions.push(
        sql`(${bookings.created_at}, ${bookings.id}) < (${new Date(cursor.ts).toISOString()}, ${cursor.id}::uuid)`,
      );
    }

    const db = getDb();
    const rows = await db
      .select()
      .from(bookings)
      .where(and(...conditions))
      .orderBy(desc(bookings.created_at), desc(bookings.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const next_cursor =
      hasMore && last ? encodeCursor({ ts: last.created_at.toISOString(), id: last.id }) : null;

    return c.json({ items: page.map(toApiBooking), next_cursor }, 200);
  },
);

// ─────────────────────── GET /v1/bookings/:id
route.openapi(
  createRoute({
    method: "get",
    path: "/bookings/{id}",
    tags: ["bookings"],
    summary: "Fetch a single booking. Caller must be renter or provider.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth] as const,
    request: { params: IdParamSchema },
    responses: {
      200: { description: "OK", content: { "application/json": { schema: BookingSchema } } },
      401: { description: "Unauthenticated", content: problemContent },
      404: { description: "Not found / not a participant / feature disabled", content: problemContent },
    },
  }),
  async (c) => {
    requireBookingsFlag();
    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });
    const { id } = c.req.valid("param");
    const row = await loadBookingForActor(id, u.id);
    return c.json(toApiBooking(row), 200);
  },
);

// ─────────────────────── State-machine helpers

/**
 * Run a status transition with a guarded UPDATE. The WHERE clause includes
 * the current expected status so two concurrent transition attempts (e.g.
 * provider hits accept twice via flaky network) can't both succeed — the
 * second sees zero rows and returns 409.
 */
async function transition(
  bookingId: string,
  expectedStatus: BookingRow["status"],
  patch: Partial<typeof bookings.$inferInsert>,
): Promise<BookingRow> {
  const db = getDb();
  const updated = await db
    .update(bookings)
    .set({ ...patch, updated_at: new Date() })
    .where(and(eq(bookings.id, bookingId), eq(bookings.status, expectedStatus)))
    .returning();
  const row = updated[0];
  if (!row) {
    throw new HTTPException(409, {
      message: `Booking is no longer in state '${expectedStatus}' — transition rejected.`,
    });
  }
  return row;
}

// ─────────────────────── POST /v1/bookings/:id/accept
route.openapi(
  createRoute({
    method: "post",
    path: "/bookings/{id}/accept",
    tags: ["bookings"],
    summary: "Provider accepts a requested booking. requested → confirmed.",
    description:
      "Stripe capture lands in PR 4 — PR 3 only flips the status. Provider " +
      "ownership is enforced; other actors get 404 to avoid leaking existence.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth, idempotency()] as const,
    request: {
      params: IdParamSchema,
      body: { content: { "application/json": { schema: BookingEmptyBodySchema } } },
    },
    responses: {
      200: { description: "OK", content: { "application/json": { schema: BookingSchema } } },
      401: { description: "Unauthenticated", content: problemContent },
      404: { description: "Not found / not the provider / feature disabled", content: problemContent },
      409: { description: "Booking is not in 'requested' state", content: problemContent },
    },
  }),
  async (c) => {
    requireBookingsFlag();
    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });
    const { id } = c.req.valid("param");
    const row = await loadBookingForActor(id, u.id);
    if (row.provider_id !== u.id) {
      throw new HTTPException(404, { message: "Not Found" });
    }
    const now = new Date();
    const updated = await transition(row.id, "requested", {
      status: "confirmed",
      confirmed_at: now,
    });

    // Capture the authorized PaymentIntent. The transfer_data.destination
    // on the intent means Stripe routes funds to the provider's Connect
    // account at this point. Any Stripe-side failure leaves the booking
    // in 'confirmed' state — the webhook handler reconciles when Stripe
    // eventually catches up (or the operator retries via dashboard).
    if (stripeConfigured() && updated.stripe_payment_intent_id) {
      try {
        await capturePaymentIntent(updated.stripe_payment_intent_id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Stripe capture failed";
        console.error(`[bookings.accept] capture failed for ${updated.id}:`, msg);
        // Don't bubble — booking is confirmed, Stripe webhook will reconcile.
      }
    }
    return c.json(toApiBooking(updated), 200);
  },
);

// ─────────────────────── POST /v1/bookings/:id/decline
route.openapi(
  createRoute({
    method: "post",
    path: "/bookings/{id}/decline",
    tags: ["bookings"],
    summary: "Provider declines a requested booking. requested → declined.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth, idempotency()] as const,
    request: {
      params: IdParamSchema,
      body: { content: { "application/json": { schema: BookingDeclineSchema } } },
    },
    responses: {
      200: { description: "OK", content: { "application/json": { schema: BookingSchema } } },
      400: { description: "Validation failed", content: problemContent },
      401: { description: "Unauthenticated", content: problemContent },
      404: { description: "Not found / not the provider / feature disabled", content: problemContent },
      409: { description: "Booking is not in 'requested' state", content: problemContent },
    },
  }),
  async (c) => {
    requireBookingsFlag();
    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const row = await loadBookingForActor(id, u.id);
    if (row.provider_id !== u.id) {
      throw new HTTPException(404, { message: "Not Found" });
    }
    const now = new Date();
    const updated = await transition(row.id, "requested", {
      status: "declined",
      declined_at: now,
      decline_reason: body.reason,
    });

    // Cancel the authorized PaymentIntent. capture_method='manual' means
    // the auth hold is released without a refund appearing on the renter's
    // statement (Stripe convention). Best-effort: if the cancel fails the
    // webhook handler reconciles when payment_intent.canceled fires.
    if (stripeConfigured() && updated.stripe_payment_intent_id) {
      try {
        await cancelPaymentIntent(updated.stripe_payment_intent_id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Stripe cancel failed";
        console.error(`[bookings.decline] cancel failed for ${updated.id}:`, msg);
      }
    }
    return c.json(toApiBooking(updated), 200);
  },
);

// ─────────────────────── POST /v1/bookings/:id/return
route.openapi(
  createRoute({
    method: "post",
    path: "/bookings/{id}/return",
    tags: ["bookings"],
    summary: "Provider marks the item returned. active → returned (24h release window).",
    description:
      "Starts the 24-hour release timer. The bookings-complete cron flips " +
      "to 'completed' after 24h passes without a dispute (cron stub in PR 3, " +
      "live in PR 11). Marking a not-yet-active booking returned is rejected.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth, idempotency()] as const,
    request: {
      params: IdParamSchema,
      body: { content: { "application/json": { schema: BookingEmptyBodySchema } } },
    },
    responses: {
      200: { description: "OK", content: { "application/json": { schema: BookingSchema } } },
      401: { description: "Unauthenticated", content: problemContent },
      404: { description: "Not found / not the provider / feature disabled", content: problemContent },
      409: { description: "Booking is not in 'active' state", content: problemContent },
    },
  }),
  async (c) => {
    requireBookingsFlag();
    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });
    const { id } = c.req.valid("param");
    const row = await loadBookingForActor(id, u.id);
    if (row.provider_id !== u.id) {
      throw new HTTPException(404, { message: "Not Found" });
    }
    const now = new Date();
    const updated = await transition(row.id, "active", {
      status: "returned",
      returned_at: now,
    });
    return c.json(toApiBooking(updated), 200);
  },
);

// ─────────────────────── POST /v1/bookings/:id/cancel
route.openapi(
  createRoute({
    method: "post",
    path: "/bookings/{id}/cancel",
    tags: ["bookings"],
    summary: "Either party cancels a non-terminal booking pre-start.",
    description:
      "Cancellation rules (per plan §Stripe Connect): renter gets full " +
      "refund if cancellation lands >24h before start; provider may cancel " +
      "any time but accrues strikes (3 = manual review). Refund mechanics " +
      "land in PR 4 — PR 3 only logs the cancellation.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth, idempotency()] as const,
    request: {
      params: IdParamSchema,
      body: { content: { "application/json": { schema: BookingCancelSchema } } },
    },
    responses: {
      200: { description: "OK", content: { "application/json": { schema: BookingSchema } } },
      400: { description: "Validation failed", content: problemContent },
      401: { description: "Unauthenticated", content: problemContent },
      404: { description: "Not found / not a participant / feature disabled", content: problemContent },
      409: { description: "Booking is in a terminal state or already active", content: problemContent },
    },
  }),
  async (c) => {
    requireBookingsFlag();
    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const row = await loadBookingForActor(id, u.id);

    // Allowed pre-cancel states: requested + confirmed. Once active/returned/
    // completed/declined/cancelled, the booking can't be cancelled — it
    // either ran its course or is already terminal.
    if (row.status !== "requested" && row.status !== "confirmed") {
      throw new HTTPException(409, {
        message: `Cannot cancel a booking in state '${row.status}'.`,
      });
    }

    // Use a guarded UPDATE so two concurrent cancels can't both succeed.
    const db = getDb();
    const now = new Date();
    const priorStatus = row.status;
    const updated = await db
      .update(bookings)
      .set({
        status: "cancelled",
        cancelled_at: now,
        cancelled_by: u.id,
        cancel_reason: body.reason,
        updated_at: now,
      })
      .where(
        and(
          eq(bookings.id, row.id),
          sql`${bookings.status} IN ('requested', 'confirmed')`,
        ),
      )
      .returning();
    const u2 = updated[0];
    if (!u2) {
      throw new HTTPException(409, {
        message: "Booking state changed before the cancel landed — try again.",
      });
    }

    // Stripe refund/void path. Depends on the booking's prior status:
    //   • 'requested'  — auth hold, not captured → cancel the intent (no refund visible)
    //   • 'confirmed'  — already captured → full refund + reverse_transfer
    if (stripeConfigured() && u2.stripe_payment_intent_id) {
      try {
        if (priorStatus === "requested") {
          await cancelPaymentIntent(u2.stripe_payment_intent_id);
        } else {
          await refundPaymentIntent({
            intentId: u2.stripe_payment_intent_id,
            reason: "requested_by_customer",
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Stripe refund/cancel failed";
        console.error(`[bookings.cancel] Stripe call failed for ${u2.id}:`, msg);
        // Booking is in 'cancelled' state already; the operator can retry
        // the refund via Stripe dashboard if this transient failure persists.
      }
    }

    return c.json(toApiBooking(u2), 200);
  },
);

export default route;
