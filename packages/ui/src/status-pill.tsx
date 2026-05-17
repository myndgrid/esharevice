import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "./utils";

export type BookingStatus =
  | "requested"
  | "confirmed"
  | "active"
  | "returned"
  | "completed"
  | "cancelled"
  | "declined";

export type StatusPillProps = HTMLAttributes<HTMLSpanElement> & {
  status: BookingStatus;
};

const STATUS_LABEL: Record<BookingStatus, string> = {
  requested: "Requested",
  confirmed: "Confirmed",
  active: "Active",
  returned: "Returned",
  completed: "Completed",
  cancelled: "Cancelled",
  declined: "Declined",
};

const STATUS_STYLE: Record<BookingStatus, string> = {
  // The colour grammar mirrors the redesign spec:
  //   requested → neutral grey (no commitment yet)
  //   confirmed → brand blue (provider said yes)
  //   active    → green (transaction in progress)
  //   returned  → amber-soft (handoff window, review pending)
  //   completed → grey outline (closed)
  //   cancelled / declined → red outline (terminal negative)
  requested: "bg-bg-subtle text-fg-muted",
  confirmed: "bg-[var(--brand-soft)] text-[var(--brand-deep)]",
  active: "bg-[oklch(95%_0.04_145)] text-[oklch(35%_0.12_145)]",
  returned: "bg-[var(--accent-soft)] text-[var(--accent-fg)]",
  completed: "border border-border text-fg-muted",
  cancelled: "border border-[var(--danger)] text-[var(--danger)]",
  declined: "border border-[var(--danger)] text-[var(--danger)]",
};

/**
 * Booking lifecycle status pill. The label set is closed — adding a new
 * status requires editing both this enum + the StatusTimeline step order.
 */
export const StatusPill = forwardRef<HTMLSpanElement, StatusPillProps>(
  ({ status, className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        STATUS_STYLE[status],
        className,
      )}
      {...props}
    >
      {STATUS_LABEL[status]}
    </span>
  ),
);
StatusPill.displayName = "StatusPill";
