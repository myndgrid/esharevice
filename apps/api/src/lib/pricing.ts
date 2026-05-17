/**
 * Pricing math for bookings.
 *
 * All amounts in cents-CAD per the Toronto launch decision. Stripe processing
 * fees are NOT computed here — those land in PR 4 alongside the actual Stripe
 * call, where the live amount comes back on the PaymentIntent response.
 *
 * Take rates (from the plan §Backend Systems — Stripe Connect):
 *   • rent + sell — 10%
 *   • hire        — 12% (services have higher support cost)
 *   • gift + trade — N/A; the booking flow rejects these listing types
 *
 * Fees round HALF-UP to avoid leaving fractional cents on the table. The
 * `Math.round` JS default rounds half-to-even (banker's rounding) which is
 * mathematically nicer but surprises both providers and accountants.
 */
import type { ListingType, PriceUnit } from "@esharevice/shared";

export type PlatformFeeBps = number; // basis points: 10% = 1000

const FEE_BPS: Record<Extract<ListingType, "rent" | "hire" | "sell">, PlatformFeeBps> = {
  rent: 1000, // 10%
  sell: 1000, // 10%
  hire: 1200, // 12%
};

/**
 * Half-up rounding for currency math. Math.round in JS uses banker's
 * rounding (half-to-even), which results in 0.5 → 0 and 1.5 → 2 — fine for
 * statistical work, mildly confusing for billing.
 */
function roundHalfUp(n: number): number {
  return Math.sign(n) * Math.floor(Math.abs(n) + 0.5);
}

/**
 * Compute quantity from a date range for a given price_unit. The booking
 * route can override with an explicit quantity for hire bookings where the
 * renter says "I want exactly 3 hours" even though their picker selected
 * a longer window.
 *
 * - 'day'   → ceil(hours / 24). A booking that crosses a day boundary by
 *             even one minute charges for two days. Matches how rental
 *             agencies normally bill.
 * - 'hour'  → ceil(minutes / 60). Same rationale — partial hour rounds up.
 * - 'fixed' → 1. The price is the total regardless of duration.
 */
export function quantityFromRange(
  unit: PriceUnit | null,
  start_at: Date,
  end_at: Date,
): number {
  const ms = end_at.getTime() - start_at.getTime();
  if (ms <= 0) {
    throw new Error("end_at must be after start_at");
  }
  if (unit === "day") {
    return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
  }
  if (unit === "hour") {
    return Math.max(1, Math.ceil(ms / (60 * 60 * 1000)));
  }
  return 1; // 'fixed' or null (sell)
}

export type PricingInput = {
  listing_type: Extract<ListingType, "rent" | "hire" | "sell">;
  price_cents: number;
  price_unit: PriceUnit | null;
  quantity: number;
  deposit_cents: number; // 0 for hire (forbidden by Zod) and sell (no deposit concept)
};

export type PricingTotals = {
  subtotal_cents: number;
  platform_fee_cents: number;
  deposit_cents: number;
  /**
   * Total CHARGED to the renter at capture time. Stripe processing fee is
   * NOT included here — it's deducted from the platform's share at settlement,
   * not added on top of the renter's bill. The provider receives:
   *   subtotal - platform_fee - stripe_processing_fee (≈ 2.9% + $0.30)
   */
  total_cents: number;
};

export function calculateTotals(input: PricingInput): PricingTotals {
  if (input.price_cents < 0 || input.quantity <= 0 || input.deposit_cents < 0) {
    throw new Error("calculateTotals: inputs must be non-negative (quantity > 0)");
  }
  const subtotal_cents = input.price_cents * input.quantity;
  const feeBps = FEE_BPS[input.listing_type];
  const platform_fee_cents = roundHalfUp((subtotal_cents * feeBps) / 10000);
  const total_cents = subtotal_cents + platform_fee_cents + input.deposit_cents;
  return {
    subtotal_cents,
    platform_fee_cents,
    deposit_cents: input.deposit_cents,
    total_cents,
  };
}
