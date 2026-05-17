import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "./utils";

export type RatingStarProps = HTMLAttributes<HTMLSpanElement> & {
  /** Rating value 0–5. Rendered to two decimals (Airbnb style). */
  value: number;
  /** Optional review count rendered after the value: "4.92 (138)". */
  count?: number;
  /** Pixel size of the star glyph. Defaults to 14. */
  size?: number;
};

/**
 * Airbnb-style rating display: a filled black star followed by the
 * 2-decimal value. Display-only — there's no input behaviour. For input,
 * a different component (`RatingStarInput`) would be needed (not in this PR).
 *
 * Renders nothing when `value` is 0 OR `Number.isNaN(value)` — a brand-new
 * listing with no reviews should show no rating row at all, not "0.00".
 */
export const RatingStar = forwardRef<HTMLSpanElement, RatingStarProps>(
  ({ value, count, size = 14, className, ...props }, ref) => {
    if (!Number.isFinite(value) || value <= 0) return null;
    return (
      <span
        ref={ref}
        className={cn("inline-flex items-center gap-1 text-sm text-fg", className)}
        {...props}
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12 .587l3.668 7.43 8.2 1.193-5.934 5.782 1.402 8.168L12 18.896l-7.336 3.864 1.402-8.168L.132 9.21l8.2-1.193z" />
        </svg>
        <span>{value.toFixed(2)}</span>
        {typeof count === "number" && count > 0 ? (
          <span className="text-fg-muted">({count})</span>
        ) : null}
      </span>
    );
  },
);
RatingStar.displayName = "RatingStar";
