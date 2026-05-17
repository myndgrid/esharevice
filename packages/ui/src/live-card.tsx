import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "./utils";
import type { ListingType } from "./type-badge";

export type LiveCardProps = HTMLAttributes<HTMLDivElement> & {
  /** Listing type — drives the verb in the activity sentence. */
  type: ListingType;
  /** Counterparty display name (whose avatar shows in the card). */
  who: string;
  /** Listing title or service description, e.g. "KitchenAid mixer". */
  what: string;
  /** Time-ago label, e.g. "12m ago". */
  when: string;
  /** Avatar slot — pass a configured <Avatar> or any 32×32 element. */
  avatar?: ReactNode;
  /** Optional neighbourhood / area label, e.g. "St. Lawrence". */
  where?: string;
};

/**
 * Horizontal-scroll activity card for the "Happening right now in Toronto"
 * rail on the landing page. Each card is a small horizontal snapshot of
 * a single recent transaction — visible only when there's actual activity
 * to surface.
 *
 * Visual: 1px border, 12px radius, avatar on the left, activity line + meta
 * on the right. Designed to fit ~280px wide in a horizontal carousel.
 */
const VERB: Record<ListingType, string> = {
  gift: "gifted",
  trade: "traded",
  rent: "rented",
  hire: "hired help for",
  sell: "sold",
};

export const LiveCard = forwardRef<HTMLDivElement, LiveCardProps>(
  ({ type, who, what, when, avatar, where, className, ...props }, ref) => (
    <article
      ref={ref}
      className={cn(
        "inline-flex w-[280px] shrink-0 items-center gap-3 rounded-xl border border-border bg-bg px-3 py-3",
        "transition-shadow hover:shadow-[0_4px_14px_-6px_oklch(0%_0_0_/_0.12)]",
        className,
      )}
      {...props}
    >
      {avatar ? <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full">{avatar}</div> : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-fg">
          <span className="font-semibold">{who}</span>{" "}
          <span className="text-fg-muted">{VERB[type]}</span>{" "}
          <span className="font-semibold">{what}</span>
        </p>
        <p className="mt-0.5 truncate text-xs text-fg-muted">
          {where ? `${where} · ` : ""}
          {when}
        </p>
      </div>
    </article>
  ),
);
LiveCard.displayName = "LiveCard";
