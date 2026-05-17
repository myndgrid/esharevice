import { z } from "zod";
import { CategoryRef } from "./category";

// ─────────────────────── Enums (must match packages/db pgEnums)

export const ListingType = z.enum(["gift", "trade", "rent", "hire", "sell"]);
export type ListingType = z.infer<typeof ListingType>;

export const PriceUnit = z.enum(["hour", "day", "fixed"]);
export type PriceUnit = z.infer<typeof PriceUnit>;

export const ItemCondition = z.enum(["new", "like_new", "good", "fair", "well_used"]);
export type ItemCondition = z.infer<typeof ItemCondition>;

export const LocationPrecision = z.enum([
  "exact",
  "street",
  "neighbourhood",
  "postal_code",
  "city",
]);
export type LocationPrecision = z.infer<typeof LocationPrecision>;

// ─────────────────────── Read shape (response from the API)

/**
 * Server-stored shape. Every paid-type field is nullable on the wire because
 * gift/trade listings legitimately omit them; clients differentiate on
 * `listing_type` to know which subset to render.
 *
 * New-in-0007 fields (listing_type onward) are always present on the wire,
 * even for legacy trade-only rows — they were backfilled by the migration's
 * default and the API populates them additively. Old clients ignore unknown
 * keys, so this is forward-compatible.
 */
export const ExchangeItem = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  provider: z.string().min(1).max(120),
  service: z.string().min(1).max(120),
  date: z.string(),
  // `wants` is the type='trade' rename for what was historically `exchange`.
  // Both fields ship in the response: `exchange` for backward compat with
  // pre-PR-2 clients, `wants` for new clients that understand the taxonomy.
  // Either is nullable for non-trade listings.
  exchange: z.string().max(240).nullable(),
  wants: z.string().max(240).nullable(),
  description: z.string().min(1).max(4000),
  rate_type: z.string().max(40).nullable(),
  img_url: z.string().url().nullable(),
  img_hash: z.string().length(64).nullable(),
  reserved: z.boolean(),
  reserved_by: z.string().uuid().nullable(),
  reserved_at: z.string().datetime().nullable(),
  // ── Listing taxonomy (0007) ──
  listing_type: ListingType,
  price_cents: z.number().int().nonnegative().nullable(),
  price_unit: PriceUnit.nullable(),
  deposit_cents: z.number().int().nonnegative().nullable(),
  condition: ItemCondition.nullable(),
  available_from: z.string().datetime().nullable(),
  available_to: z.string().datetime().nullable(),
  location_lat: z.number().min(-90).max(90).nullable(),
  location_lng: z.number().min(-180).max(180).nullable(),
  location_precision: LocationPrecision.nullable(),
  category_id: z.string().uuid().nullable(),
  category: CategoryRef.nullable(),
  // ── Stubs for PRs 9+ (reviews / geo distance / favourite signal). Always
  // null in PR 2; populated when their backing data lands. Shipping the
  // shape now means the web app can wire UI against the final response now.
  rating: z.number().min(0).max(5).nullable(),
  neighbourhood: z.string().nullable(),
  distance_km: z.number().nonnegative().nullable(),
  neighbour_favourite: z.boolean(),
  // ── Timestamps ──
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type ExchangeItem = z.infer<typeof ExchangeItem>;

// ─────────────────────── Create body (type-discriminated)

/**
 * Common fields every type carries. Old clients (pre-PR-2) post these and
 * nothing else; their body defaults to `listing_type='trade'` server-side so
 * existing form submissions keep working.
 *
 * `exchange` stays accepted for trade listings; new clients should send
 * `wants` instead — the API treats them as aliases and stores in `exchange`.
 */
const ExchangeItemCreateCommon = z.object({
  provider: z.string().min(1).max(120),
  service: z.string().min(1).max(120),
  date: z.string().min(1),
  description: z.string().min(1).max(4000),
  rate_type: z.string().max(40).optional(),
  listing_type: ListingType.default("trade"),
  // Type-specific fields. All optional at the base layer; superRefine enforces
  // per-type presence rules below.
  wants: z.string().min(1).max(240).optional(),
  exchange: z.string().min(1).max(240).optional(),
  price_cents: z.number().int().min(0).max(100_000_000).optional(),
  price_unit: PriceUnit.optional(),
  deposit_cents: z.number().int().min(0).max(100_000_000).optional(),
  condition: ItemCondition.optional(),
  available_from: z.string().datetime().optional(),
  available_to: z.string().datetime().optional(),
  location_lat: z.number().min(-90).max(90).optional(),
  location_lng: z.number().min(-180).max(180).optional(),
  location_precision: LocationPrecision.optional(),
  category_id: z.string().uuid().optional(),
});

/**
 * Per-type validation. Each rule reports its issue at the precise field the
 * user touched (or didn't touch) so client UI can surface the error inline.
 *
 * Rules summarised:
 *   gift  — no money, no wants. Pickup-only.
 *   trade — wants/exchange required, no money fields.
 *   rent  — price_cents + price_unit required. Optional deposit + availability.
 *   hire  — price_cents + price_unit required. price_unit MUST be 'hour'
 *           (or 'fixed' for one-off jobs). No 'day' for hire.
 *   sell  — price_cents required. condition required. No price_unit
 *           (price is the fixed total).
 */
function applyTypeRules(
  data: z.infer<typeof ExchangeItemCreateCommon>,
  ctx: z.RefinementCtx,
): void {
  const t = data.listing_type;
  const hasWants =
    (data.wants !== undefined && data.wants.length > 0) ||
    (data.exchange !== undefined && data.exchange.length > 0);

  if (t === "gift") {
    if (data.price_cents !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price_cents"],
        message: "Gift listings can't have a price.",
      });
    }
    if (hasWants) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["wants"],
        message: "Gift listings can't ask for something in return — that would be a trade.",
      });
    }
  }

  if (t === "trade") {
    if (!hasWants) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["wants"],
        message: "Trade listings need a `wants` line (what you'd take in return).",
      });
    }
    if (data.price_cents !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price_cents"],
        message: "Trade listings don't carry a price. Use `rent`, `hire`, or `sell` for paid types.",
      });
    }
  }

  if (t === "rent") {
    if (data.price_cents === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price_cents"],
        message: "Rent listings need a price (in cents-CAD).",
      });
    }
    if (data.price_unit === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price_unit"],
        message: "Rent listings need a price_unit (`hour`, `day`, or `fixed`).",
      });
    }
  }

  if (t === "hire") {
    if (data.price_cents === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price_cents"],
        message: "Hire listings need a price (in cents-CAD).",
      });
    }
    if (data.price_unit === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price_unit"],
        message: "Hire listings need a price_unit (`hour` or `fixed`).",
      });
    } else if (data.price_unit === "day") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price_unit"],
        message: "Hire jobs price by `hour` or `fixed`, not by day. Use `rent` for day pricing.",
      });
    }
    if (data.deposit_cents !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deposit_cents"],
        message: "Deposits are for rent listings only.",
      });
    }
  }

  if (t === "sell") {
    if (data.price_cents === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price_cents"],
        message: "Sell listings need a price (in cents-CAD).",
      });
    }
    if (data.price_unit !== undefined && data.price_unit !== "fixed") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price_unit"],
        message: "Sell listings are priced as a fixed total. Drop `price_unit` (or set it to `fixed`).",
      });
    }
    if (data.condition === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["condition"],
        message: "Sell listings need a `condition` (`new`/`like_new`/`good`/`fair`/`well_used`).",
      });
    }
    if (data.deposit_cents !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deposit_cents"],
        message: "Deposits are for rent listings only.",
      });
    }
  }

  // Date sanity across all types.
  if (
    data.available_from !== undefined &&
    data.available_to !== undefined &&
    new Date(data.available_to) < new Date(data.available_from)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["available_to"],
      message: "`available_to` must be on or after `available_from`.",
    });
  }
}

export const ExchangeItemCreate = ExchangeItemCreateCommon
  .strict() // reject unknown keys
  .superRefine(applyTypeRules);
export type ExchangeItemCreate = z.infer<typeof ExchangeItemCreate>;

// ─────────────────────── Update body
//
// Every field optional, listing_type IMMUTABLE post-create. We strip it
// explicitly here so a client that includes it gets a clear "unknown key"
// 400 rather than a silent ignore.

export const ExchangeItemUpdate = ExchangeItemCreateCommon
  .omit({ listing_type: true })
  .partial()
  .strict();
export type ExchangeItemUpdate = z.infer<typeof ExchangeItemUpdate>;

// ─────────────────────── List query
//
// Cursor pagination + the new filter set. `bbox` is "minLng,minLat,maxLng,maxLat"
// (Web Mercator convention, comma-separated). All filters are AND-combined.

export const ExchangeItemListQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().optional(),
  listing_type: ListingType.optional(),
  category_slug: z.string().min(1).max(64).optional(),
  min_price_cents: z.coerce.number().int().min(0).optional(),
  max_price_cents: z.coerce.number().int().min(0).optional(),
  bbox: z
    .string()
    .regex(
      /^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/,
      "bbox must be `minLng,minLat,maxLng,maxLat`",
    )
    .optional(),
});
export type ExchangeItemListQuery = z.infer<typeof ExchangeItemListQuery>;
