import { forwardRef, useState, type HTMLAttributes } from "react";
import { cn } from "./utils";

export type PriceBreakdownProps = HTMLAttributes<HTMLDivElement> & {
  /** ISO currency code. Defaults to "CAD". */
  currency?: string;
  /** Subtotal in minor units (cents). */
  subtotal: number;
  /** Platform fee in minor units (cents). */
  platformFee: number;
  /** Stripe processing fee in minor units (cents). */
  stripeFee: number;
  /** Refundable deposit in minor units (cents). Hidden when undefined or 0. */
  deposit?: number;
  /** Final total the user pays now, in minor units (cents). */
  total: number;
  /** Render as a collapsed summary by default; toggles open on click. */
  collapsible?: boolean;
  /** Force-open the breakdown when collapsible is true. */
  defaultOpen?: boolean;
};

/**
 * Itemised fee disclosure used in the rent/hire/sell action panel,
 * booking flow checkout, and booking detail "Fee breakdown" section.
 * Math is supplied by the API — the component renders, never computes,
 * because Stripe + tax + platform-fee logic lives server-side.
 *
 * All money values are in MINOR units (cents) per the rest of the
 * codebase. Formatting is locale-aware via Intl.NumberFormat.
 */
export const PriceBreakdown = forwardRef<HTMLDivElement, PriceBreakdownProps>(
  (
    {
      currency = "CAD",
      subtotal,
      platformFee,
      stripeFee,
      deposit,
      total,
      collapsible = true,
      defaultOpen = false,
      className,
      ...props
    },
    ref,
  ) => {
    const [open, setOpen] = useState(defaultOpen);
    const fmt = (cents: number) =>
      new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);
    const showDeposit = typeof deposit === "number" && deposit > 0;

    const summary = (
      <div className="flex items-center justify-between">
        <span className="font-semibold text-fg">Total</span>
        <span className="font-semibold text-fg">{fmt(total)}</span>
      </div>
    );

    const details = (
      <dl className="space-y-1.5 text-sm">
        <Row label="Subtotal" value={fmt(subtotal)} />
        <Row label="Platform fee" value={fmt(platformFee)} muted />
        <Row label="Processing fee" value={fmt(stripeFee)} muted />
        {showDeposit ? <Row label="Deposit (refundable)" value={fmt(deposit!)} muted /> : null}
        <div className="mt-2 border-t border-border pt-2">
          <Row label="Total" value={fmt(total)} bold />
        </div>
      </dl>
    );

    if (!collapsible) {
      return (
        <div ref={ref} className={cn("rounded-lg border border-border p-3", className)} {...props}>
          {details}
        </div>
      );
    }

    return (
      <div ref={ref} className={cn("rounded-lg border border-border", className)} {...props}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-md"
        >
          {summary}
          <Chevron open={open} />
        </button>
        {open ? <div className="border-t border-border px-3 py-3">{details}</div> : null}
      </div>
    );
  },
);
PriceBreakdown.displayName = "PriceBreakdown";

function Row({ label, value, muted, bold }: { label: string; value: string; muted?: boolean; bold?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between",
        bold && "font-semibold text-fg",
        muted && "text-fg-muted",
      )}
    >
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("text-fg-muted transition-transform duration-150 ease-out", open && "rotate-180")}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
