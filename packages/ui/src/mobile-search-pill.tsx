import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./utils";

export type MobileSearchPillProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Top-line summary (e.g. the active category or "Anywhere"). */
  primary?: string;
  /** Second-line summary (e.g. "Any week · Add guests"). */
  secondary?: string;
};

/**
 * Compact one-row search bar that's sticky-pinned at the top of mobile
 * surfaces (landing, search results, saved). Tapping it opens the full
 * search experience (handled by the consumer — this primitive is just
 * a chrome trigger).
 */
export const MobileSearchPill = forwardRef<HTMLButtonElement, MobileSearchPillProps>(
  ({ primary = "Search anything", secondary = "Anytime · Any type", className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(
        "inline-flex h-14 w-full items-center gap-3 rounded-full border border-border bg-bg px-4",
        "shadow-[0_2px_10px_-4px_oklch(0%_0_0_/_0.08)] transition-colors active:bg-bg-subtle",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        className,
      )}
      aria-label="Open search"
      {...props}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <span className="flex flex-1 flex-col items-start truncate text-left">
        <span className="truncate text-sm font-semibold text-fg">{primary}</span>
        <span className="truncate text-xs text-fg-muted">{secondary}</span>
      </span>
    </button>
  ),
);
MobileSearchPill.displayName = "MobileSearchPill";
