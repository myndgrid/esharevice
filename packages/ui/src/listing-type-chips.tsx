import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "./utils";
import type { ListingType } from "./type-badge";

export type ListingTypeChipValue = "all" | ListingType;

export type ListingTypeChipsProps = HTMLAttributes<HTMLDivElement> & {
  /** Currently-selected chip. Defaults to "all". */
  value?: ListingTypeChipValue;
  /** Emits the new chip value on tap. */
  onChange?: (value: ListingTypeChipValue) => void;
};

const CHIPS: ReadonlyArray<{ value: ListingTypeChipValue; label: string }> = [
  { value: "all", label: "All" },
  { value: "gift", label: "Free" },
  { value: "trade", label: "Trade" },
  { value: "rent", label: "Rent" },
  { value: "hire", label: "Hire" },
  { value: "sell", label: "For sale" },
];

/**
 * The single-select listing-type filter row that lives directly below the
 * CategoryStrip on landing + saved + search. Sticky-paired with the strip
 * (both pin together).
 *
 * Visual: pill chips, neutral by default, brand-soft fill + brand-deep
 * text + brand-2px ring when selected. Keyboard nav is left/right arrow
 * (radiogroup semantics).
 */
export const ListingTypeChips = forwardRef<HTMLDivElement, ListingTypeChipsProps>(
  ({ value = "all", onChange, className, ...props }, ref) => (
    <div
      ref={ref}
      role="radiogroup"
      aria-label="Filter by listing type"
      className={cn(
        "flex w-full items-center gap-2 overflow-x-auto px-4 py-3",
        "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
      {...props}
    >
      {CHIPS.map((chip) => {
        const isActive = chip.value === value;
        return (
          <button
            key={chip.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange?.(chip.value)}
            className={cn(
              "inline-flex h-9 shrink-0 items-center rounded-full px-4 text-sm font-medium",
              "border transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
              isActive
                ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-deep)]"
                : "border-border bg-bg text-fg hover:border-border-strong hover:bg-bg-subtle",
            )}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  ),
);
ListingTypeChips.displayName = "ListingTypeChips";
