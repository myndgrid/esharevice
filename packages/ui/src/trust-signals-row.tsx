import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "./utils";
import { RatingStar } from "./rating-star";
import type { ListingType } from "./type-badge";

export type TrustSignalsRowProps = HTMLAttributes<HTMLDivElement> & {
  /** Average rating across all completed transactions, 0–5. */
  rating?: number;
  /** Total review count behind the rating value. */
  reviewCount?: number;
  /** Per-type completed-transaction counts. Types with count=0 are hidden. */
  completedByType?: Partial<Record<ListingType, number>>;
  /** Verified-tier subscriber flag — shows a brand-coloured Verified pill. */
  verified?: boolean;
};

const TYPE_VERB: Record<ListingType, string> = {
  gift: "gifted",
  trade: "traded",
  rent: "rented",
  hire: "hired",
  sell: "sold",
};

/**
 * Row of trust signals that appears on profile heroes + the host-card on
 * item detail. Shows: rating · per-type completed counts · Verified pill.
 *
 * Per-type counts are a compact "12 rented · 8 sold · 3 gifted" string —
 * types with 0 completions are filtered out so brand-new providers don't
 * show a row of "0 rented · 0 sold". An entirely empty signals row
 * renders `null` to avoid leaving an awkward gap.
 */
export const TrustSignalsRow = forwardRef<HTMLDivElement, TrustSignalsRowProps>(
  ({ rating, reviewCount, completedByType, verified, className, ...props }, ref) => {
    const ratingNode =
      typeof rating === "number" && rating > 0 ? (
        typeof reviewCount === "number" ? (
          <RatingStar value={rating} count={reviewCount} />
        ) : (
          <RatingStar value={rating} />
        )
      ) : null;
    const completedEntries = (Object.entries(completedByType ?? {}) as Array<[ListingType, number]>)
      .filter(([, n]) => typeof n === "number" && n > 0);
    const verifiedNode = verified ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--brand-deep)]">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
        </svg>
        Verified
      </span>
    ) : null;

    if (!ratingNode && completedEntries.length === 0 && !verifiedNode) return null;

    return (
      <div
        ref={ref}
        className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted", className)}
        {...props}
      >
        {ratingNode}
        {completedEntries.length > 0 ? (
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            {completedEntries.map(([t, n], i) => (
              <span key={t}>
                {i > 0 ? <span aria-hidden="true" className="text-fg-subtle">·</span> : null}
                <span className="ml-1">
                  <span className="font-semibold text-fg">{n}</span> {TYPE_VERB[t]}
                </span>
              </span>
            ))}
          </span>
        ) : null}
        {verifiedNode}
      </div>
    );
  },
);
TrustSignalsRow.displayName = "TrustSignalsRow";
