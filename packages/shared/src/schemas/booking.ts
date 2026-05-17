import { z } from "zod";
import { PriceUnit } from "./exchange-item";

// ─────────────────────── Enum

/**
 * Booking lifecycle. Each value represents an end-of-transition state:
 *
 *   requested → confirmed → active → returned → completed
 *                       ↘ declined
 *                       ↘ cancelled  (from any non-terminal state, pre-start)
 *
 * Disputed is intentionally NOT in this PR — it lands in PR 10 alongside
 * the disputes table.
 */
export const BookingStatus = z.enum([
  "requested",
  "confirmed",
  "active",
  "returned",
  "completed",
  "declined",
  "cancelled",
]);
export type BookingStatus = z.infer<typeof BookingStatus>;

// ─────────────────────── Read shape

/**
 * The wire shape every client sees. Money is exposed in cents-CAD; format
 * for display on the client side. Lifecycle timestamps are nullable — a
 * booking only carries the timestamps for transitions it's already passed.
 */
export const Booking = z.object({
  id: z.string().uuid(),
  item_id: z.string().uuid(),
  renter_id: z.string().uuid(),
  provider_id: z.string().uuid(),
  status: BookingStatus,
  start_at: z.string().datetime().nullable(),
  end_at: z.string().datetime().nullable(),
  price_cents: z.number().int().nonnegative(),
  price_unit: PriceUnit.nullable(),
  quantity: z.number().int().positive(),
  subtotal_cents: z.number().int().nonnegative(),
  platform_fee_cents: z.number().int().nonnegative(),
  stripe_fee_cents: z.number().int().nonnegative().nullable(),
  deposit_cents: z.number().int().nonnegative(),
  total_cents: z.number().int().nonnegative(),
  currency: z.literal("CAD"),
  // Stripe linkage (PR 4 populates; PR 3 returns null).
  stripe_payment_intent_id: z.string().nullable(),
  stripe_charge_id: z.string().nullable(),
  stripe_transfer_id: z.string().nullable(),
  // Notes / reasons
  message_to_provider: z.string().nullable(),
  decline_reason: z.string().nullable(),
  cancel_reason: z.string().nullable(),
  cancelled_by: z.string().uuid().nullable(),
  // Lifecycle
  requested_at: z.string().datetime(),
  confirmed_at: z.string().datetime().nullable(),
  active_at: z.string().datetime().nullable(),
  returned_at: z.string().datetime().nullable(),
  completed_at: z.string().datetime().nullable(),
  declined_at: z.string().datetime().nullable(),
  cancelled_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Booking = z.infer<typeof Booking>;

// ─────────────────────── Create body
//
// POST /v1/items/:id/bookings. The item's listing_type determines which
// fields are required — same superRefine pattern PR 2 used for items.
//
// rent / hire — start_at + end_at required.
// sell        — start_at + end_at must be absent (instantaneous purchase).
// gift / trade — booking flow doesn't apply; the API rejects with 400 in
// the route handler before this schema runs (the listing_type isn't on
// the body, so we can't validate it here — see route logic).

const BookingCreateCommon = z.object({
  start_at: z.string().datetime().optional(),
  end_at: z.string().datetime().optional(),
  // For hire bookings priced per hour: explicit `quantity` overrides the
  // implicit derivation from (end_at - start_at) for finer control. Default
  // is the duration-derived value computed server-side.
  quantity: z.number().int().positive().max(10000).optional(),
  // Optional renter-to-provider message at booking time.
  message_to_provider: z.string().max(2000).optional(),
});

export const BookingCreate = BookingCreateCommon.strict().superRefine((data, ctx) => {
  // Date pairing: both or neither.
  if ((data.start_at === undefined) !== (data.end_at === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["end_at"],
      message: "Provide both start_at and end_at, or neither.",
    });
  }
  if (
    data.start_at !== undefined &&
    data.end_at !== undefined &&
    new Date(data.end_at) <= new Date(data.start_at)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["end_at"],
      message: "end_at must be after start_at.",
    });
  }
});
export type BookingCreate = z.infer<typeof BookingCreate>;

// ─────────────────────── List query

export const BookingListQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /**
   * `role` filters the list to bookings where the caller is acting in the
   * given capacity. Required so the response is unambiguous about which
   * actor's perspective the cursor pages over.
   */
  role: z.enum(["renter", "provider"]),
  status: BookingStatus.optional(),
});
export type BookingListQuery = z.infer<typeof BookingListQuery>;

// ─────────────────────── Transition bodies

export const BookingDecline = z.object({
  reason: z.string().min(1).max(2000),
}).strict();
export type BookingDecline = z.infer<typeof BookingDecline>;

export const BookingCancel = z.object({
  reason: z.string().min(1).max(2000),
}).strict();
export type BookingCancel = z.infer<typeof BookingCancel>;

// `accept` and `return` carry no body — empty object accepted, no fields.
export const BookingEmptyBody = z.object({}).strict();
export type BookingEmptyBody = z.infer<typeof BookingEmptyBody>;
