import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from "react";
import { cn } from "./utils";

export type HoodTileProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  /** Neighbourhood display name. */
  name: string;
  /** Listings count rendered in the meta line ("12 listings"). */
  count?: number;
  /** Square thumbnail (64×64 recommended). Pass an <img> or any element. */
  thumb?: ReactNode;
};

/**
 * Neighbourhood discovery tile (64×64 thumb + name + count). Composes
 * vertically on the landing's "Browse by neighbourhood" grid.
 *
 * Renders as an <a> so the consumer wires href without extra plumbing.
 */
export const HoodTile = forwardRef<HTMLAnchorElement, HoodTileProps>(
  ({ name, count, thumb, className, children, ...props }, ref) => (
    <a
      ref={ref}
      className={cn(
        "group inline-flex items-center gap-3 rounded-xl border border-border bg-bg p-3",
        "transition-colors hover:bg-bg-subtle",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        className,
      )}
      {...props}
    >
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-bg-soft">{thumb}</div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-fg">{name}</p>
        {typeof count === "number" ? (
          <p className="text-xs text-fg-muted">{count.toLocaleString()} listing{count === 1 ? "" : "s"}</p>
        ) : null}
        {children}
      </div>
    </a>
  ),
);
HoodTile.displayName = "HoodTile";
