import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "./utils";

export type CategoryStripItem = {
  /** Stable identifier (category slug). */
  slug: string;
  /** Human-readable label rendered under the icon. */
  label: string;
  /** Icon element (24×24 recommended). */
  icon?: ReactNode;
};

export type CategoryStripProps = HTMLAttributes<HTMLDivElement> & {
  items: CategoryStripItem[];
  /** Slug of the active item; if absent, no item is highlighted. */
  active?: string;
  /** Tap handler — emits the new slug. */
  onSelect?: (slug: string) => void;
};

/**
 * Horizontal-scrolling category nav (icon-over-label-with-underline), sticky
 * from `top: 82px` per the marketplace mockup. The active item gets a
 * 2px brand-coloured underline + brand-deep text colour.
 *
 * Behavioural notes:
 *   - Touch-scrollable; on desktop we expose horizontal mouse-wheel via
 *     `overflow-x-auto` (browsers auto-translate vertical wheel ticks).
 *   - `scrollbar-hidden` because the category bar in Airbnb's UX never
 *     shows a scrollbar; mobile shoves it under the chrome.
 *   - Each tab is a real <button> so keyboard tab-order works.
 */
export const CategoryStrip = forwardRef<HTMLDivElement, CategoryStripProps>(
  ({ items, active, onSelect, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative w-full",
        // border-b under the strip per the mockup
        "border-b border-border",
        className,
      )}
      {...props}
    >
      <div
        role="tablist"
        aria-label="Categories"
        className={cn(
          "scrollbar-none flex items-end gap-7 overflow-x-auto px-4 pb-2 pt-3",
          // Hide native scrollbar
          "[-ms-overflow-style:none] [scrollbar-width:none]",
          "[&::-webkit-scrollbar]:hidden",
        )}
      >
        {items.map((item) => {
          const isActive = item.slug === active;
          return (
            <button
              key={item.slug}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelect?.(item.slug)}
              className={cn(
                "group inline-flex shrink-0 flex-col items-center gap-1 pb-1 text-xs",
                "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-md",
                isActive
                  ? "text-[var(--brand-deep)] border-b-2 border-[var(--brand)] -mb-px"
                  : "text-fg-muted border-b-2 border-transparent hover:text-fg",
              )}
            >
              {item.icon ? <span className="h-6 w-6">{item.icon}</span> : null}
              <span className="whitespace-nowrap">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  ),
);
CategoryStrip.displayName = "CategoryStrip";
