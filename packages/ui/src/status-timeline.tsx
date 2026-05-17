import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "./utils";
import type { BookingStatus } from "./status-pill";

/**
 * Lifecycle step order — visible on the timeline regardless of current
 * status. `cancelled` / `declined` are terminal-negative branches that
 * collapse the timeline into a single "Cancelled" cell rather than
 * walking the whole path. Export the array so consumers (filters,
 * server-side state machines) can reuse the canonical order.
 */
export const BOOKING_STEPS = ["requested", "confirmed", "active", "returned", "completed"] as const;
export type BookingStep = (typeof BOOKING_STEPS)[number];

export type StatusTimelineProps = HTMLAttributes<HTMLOListElement> & {
  status: BookingStatus;
};

/** Index of the current step on the timeline, or -1 for terminal-negative. */
export function stepIndex(status: BookingStatus): number {
  if (status === "cancelled" || status === "declined") return -1;
  return BOOKING_STEPS.indexOf(status as BookingStep);
}

const STEP_LABEL: Record<BookingStep, string> = {
  requested: "Requested",
  confirmed: "Confirmed",
  active: "Active",
  returned: "Returned",
  completed: "Completed",
};

/**
 * Horizontal progress bar through the booking lifecycle. Each step is a
 * dot + label; the line between two completed steps is brand-coloured,
 * the line into the *current* step is brand-coloured, the line *after*
 * the current step is neutral. Cancelled / declined collapse into a
 * single red cell so the user immediately understands the booking is
 * terminal-negative rather than mid-flight.
 */
export const StatusTimeline = forwardRef<HTMLOListElement, StatusTimelineProps>(
  ({ status, className, ...props }, ref) => {
    if (status === "cancelled" || status === "declined") {
      return (
        <ol
          ref={ref}
          role="status"
          aria-live="polite"
          className={cn(
            "flex items-center gap-2 rounded-lg border border-[var(--danger)] bg-bg px-3 py-2 text-sm",
            "text-[var(--danger)]",
            className,
          )}
          {...props}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <span className="font-medium capitalize">{status}</span>
        </ol>
      );
    }

    const current = stepIndex(status);
    return (
      <ol
        ref={ref}
        role="list"
        aria-label="Booking progress"
        className={cn("flex w-full items-center", className)}
        {...props}
      >
        {BOOKING_STEPS.map((step, i) => {
          const isComplete = i < current;
          const isCurrent = i === current;
          const isFirst = i === 0;
          return (
            <li
              key={step}
              className={cn("flex flex-1 items-center", isFirst ? "flex-none" : "flex-1")}
              aria-current={isCurrent ? "step" : undefined}
            >
              {!isFirst ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-0.5 flex-1",
                    isComplete || isCurrent ? "bg-[var(--brand)]" : "bg-border",
                  )}
                />
              ) : null}
              <span
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold",
                  isComplete && "bg-[var(--brand)] text-brand-fg",
                  isCurrent && "border-2 border-[var(--brand)] bg-bg text-[var(--brand-deep)]",
                  !isComplete && !isCurrent && "border border-border bg-bg text-fg-muted",
                )}
              >
                {isComplete ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={cn(
                  "ml-2 hidden whitespace-nowrap text-xs sm:inline",
                  isCurrent ? "font-semibold text-fg" : "text-fg-muted",
                )}
              >
                {STEP_LABEL[step]}
              </span>
            </li>
          );
        })}
      </ol>
    );
  },
);
StatusTimeline.displayName = "StatusTimeline";
