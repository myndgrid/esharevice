import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "./utils";

export type ListingType = "gift" | "trade" | "rent" | "hire" | "sell";

export type TypeBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  type: ListingType;
  /**
   * Force rendering even for types that the marketplace's card layout
   * normally disambiguates by price (rent / sell). Defaults to false —
   * matching the spec line "only renders for types that need labelling".
   */
  always?: boolean;
};

const TYPE_LABEL: Record<ListingType, string> = {
  gift: "Free",
  trade: "Trade",
  rent: "Rent",
  hire: "Hire",
  sell: "For sale",
};

const TYPE_STYLE: Record<ListingType, string> = {
  // amber-soft fill, dark text — matches the "Free pill" callout from the
  // redesign mockup. Gift is the only one with chromatic emphasis because
  // free is the strongest psychological hook on a marketplace card.
  gift: "bg-[var(--accent-soft)] text-[var(--accent-fg)]",
  // sky-soft fill, deep brand text — Trade reads as "negotiable" but still
  // sits in the brand family so it doesn't compete with the primary CTA.
  trade: "bg-[var(--brand-soft)] text-[var(--brand-deep)]",
  // neutral chip — rent's chromatic signal is its price suffix ("/day"),
  // not the badge. always=true callers get a neutral pill.
  rent: "bg-bg-subtle text-fg",
  // amber-soft (services) so hire reads as "premium" without bleeding into
  // gift territory. Subtler than gift since hire IS paid.
  hire: "bg-[var(--accent-soft)] text-[var(--accent-fg)]",
  sell: "bg-bg-subtle text-fg",
};

/**
 * Compact pill that labels a listing's type on cards + detail rows.
 * Renders `null` for `rent` and `sell` unless `always` is passed, since
 * those types are usually self-labelled by their price suffix. The set
 * that always renders is `gift` (→ "Free"), `trade` (→ "Trade"), `hire`
 * (→ "Hire"). Use `always` when you want a status-pill-style row that
 * lists every type uniformly (e.g. filter chips).
 */
export const TypeBadge = forwardRef<HTMLSpanElement, TypeBadgeProps>(
  ({ type, always = false, className, ...props }, ref) => {
    if (!always && (type === "rent" || type === "sell")) return null;
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
          TYPE_STYLE[type],
          className,
        )}
        {...props}
      >
        {TYPE_LABEL[type]}
      </span>
    );
  },
);
TypeBadge.displayName = "TypeBadge";
