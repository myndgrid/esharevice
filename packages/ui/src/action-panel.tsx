"use client";

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "./utils";
import { Button } from "./button";
import { DateRangePicker, type DateRange } from "./date-range-picker";
import { DurationPicker } from "./duration-picker";
import type { ListingType } from "./type-badge";

/**
 * The polymorphic action panel on item-detail pages. Renders a sticky
 * bordered card on desktop right column, inline above the description
 * on mobile. The concrete renderer is picked by `item.listing_type`.
 *
 * Each renderer is also exposed individually as `ActionPanel.Gift`,
 * `ActionPanel.Trade`, etc. — useful when the parent already knows the
 * type and wants to skip the dispatch. Per the redesign spec line 580:
 * "every concrete renderer MUST handle its own loading and error
 * variants. The polymorph itself is dumb — switch on type, render the
 * subcomponent."
 *
 * The dispatcher takes a discriminated union (`payload`) keyed by `type`.
 * Loading/error states live on each renderer's `state` prop.
 */
type ActionPanelState = "idle" | "submitting" | "error";

type Common = {
  className?: string;
  /** Disabled / submitting / errored state. */
  state?: ActionPanelState;
  /** Inline error message rendered above the CTAs when state = "error". */
  errorMessage?: string;
  /** Secondary "Message" action — same on every variant. */
  onMessage?: () => void;
};

export type GiftPanelProps = Common & {
  /** Single-line meta, e.g. "Free · Pickup only · Available now". */
  meta?: string;
  onRequest?: () => void;
};

export type TradePanelProps = Common & {
  /** Description of what the provider wants in trade. */
  wants: string;
  /** Whether the provider is open to other offers beyond their wishlist. */
  openToOffers?: boolean;
  onPropose?: () => void;
};

export type RentPanelProps = Common & {
  /** Price per unit, in MINOR units (cents). */
  priceCents: number;
  currency?: string;
  /** Unit suffix shown after the price, e.g. "day". */
  unit?: "day" | "week" | "month";
  range?: DateRange;
  onRangeChange?: (r: DateRange | undefined) => void;
  disabledDates?: Date[];
  /** Live total in MINOR units. Caller computes (price × nights + deposit etc.). */
  totalCents?: number;
  /** Slot for an inline `<PriceBreakdown>` or "How fees work" link. */
  feeBreakdown?: ReactNode;
  onRequest?: () => void;
};

export type HirePanelProps = Common & {
  /** Hourly rate in MINOR units (cents). */
  hourlyRateCents: number;
  currency?: string;
  durationMinutes?: number;
  onDurationChange?: (minutes: number) => void;
  totalCents?: number;
  feeBreakdown?: ReactNode;
  onRequest?: () => void;
};

export type SellPanelProps = Common & {
  /** Price in MINOR units (cents). */
  priceCents: number;
  currency?: string;
  /** Item condition label, e.g. "Like new". Omit to hide. */
  condition?: string;
  fulfillment?: "pickup" | "shipping";
  onFulfillmentChange?: (f: "pickup" | "shipping") => void;
  onBuy?: () => void;
  onMakeOffer?: () => void;
};

export type ActionPanelPayload =
  | ({ type: "gift" } & GiftPanelProps)
  | ({ type: "trade" } & TradePanelProps)
  | ({ type: "rent" } & RentPanelProps)
  | ({ type: "hire" } & HirePanelProps)
  | ({ type: "sell" } & SellPanelProps);

export type ActionPanelProps = HTMLAttributes<HTMLDivElement> & {
  payload: ActionPanelPayload;
};

function fmtMoney(cents: number | undefined, currency = "CAD"): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);
}

function Card({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <aside
      className={cn(
        "rounded-2xl border border-border bg-bg p-5 shadow-[0_1px_4px_-2px_oklch(0%_0_0_/_0.06)]",
        className,
      )}
      {...rest}
    >
      {children}
    </aside>
  );
}

function StateBlock({
  state,
  errorMessage,
}: {
  state?: ActionPanelState | undefined;
  errorMessage?: string | undefined;
}) {
  if (state !== "error" || !errorMessage) return null;
  return (
    <p role="alert" className="text-sm text-[var(--danger)]">
      {errorMessage}
    </p>
  );
}

function GiftPanel({ meta, onRequest, onMessage, state, errorMessage, className }: GiftPanelProps) {
  const busy = state === "submitting";
  return (
    <Card className={className} data-type="gift">
      <h3 className="text-lg font-semibold text-fg">Free</h3>
      {meta ? <p className="mt-1 text-sm text-fg-muted">{meta}</p> : null}
      <div className="mt-4 space-y-2">
        <StateBlock state={state} errorMessage={errorMessage} />
        <Button onClick={onRequest} disabled={busy} className="w-full">
          {busy ? "Sending…" : "Request this"}
        </Button>
        <Button variant="ghost" onClick={onMessage} disabled={busy} className="w-full">
          Message
        </Button>
      </div>
    </Card>
  );
}

function TradePanel({ wants, openToOffers, onPropose, onMessage, state, errorMessage, className }: TradePanelProps) {
  const busy = state === "submitting";
  return (
    <Card className={className} data-type="trade">
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className="mt-1.5 inline-block h-2 w-2 rounded-full bg-[var(--brand)]" />
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">Wants</h3>
          <p className="mt-0.5 text-base text-fg">{wants}</p>
          {openToOffers ? (
            <p className="mt-1 text-xs text-fg-muted">Open to other offers</p>
          ) : null}
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <StateBlock state={state} errorMessage={errorMessage} />
        <Button onClick={onPropose} disabled={busy} className="w-full">
          {busy ? "Sending…" : "Propose a trade"}
        </Button>
        <Button variant="ghost" onClick={onMessage} disabled={busy} className="w-full">
          Message
        </Button>
      </div>
    </Card>
  );
}

function RentPanel({
  priceCents,
  currency = "CAD",
  unit = "day",
  range,
  onRangeChange,
  disabledDates,
  totalCents,
  feeBreakdown,
  onRequest,
  onMessage,
  state,
  errorMessage,
  className,
}: RentPanelProps) {
  const busy = state === "submitting";
  const canRequest = !!range?.from && !!range?.to && !busy;
  return (
    <Card className={className} data-type="rent">
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold text-fg">{fmtMoney(priceCents, currency)}</span>
        <span className="text-sm text-fg-muted">/ {unit}</span>
      </div>
      <div className="mt-4">
        <DateRangePicker
          value={range}
          onChange={onRangeChange}
          disabledDates={disabledDates}
          numberOfMonths={1}
        />
      </div>
      {typeof totalCents === "number" ? (
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-fg-muted">Total</span>
          <span className="font-semibold text-fg">{fmtMoney(totalCents, currency)}</span>
        </div>
      ) : null}
      {feeBreakdown ? <div className="mt-3">{feeBreakdown}</div> : null}
      <div className="mt-4 space-y-2">
        <StateBlock state={state} errorMessage={errorMessage} />
        <Button onClick={onRequest} disabled={!canRequest} className="w-full">
          {busy ? "Sending…" : "Request to book"}
        </Button>
        <Button variant="ghost" onClick={onMessage} disabled={busy} className="w-full">
          Message
        </Button>
      </div>
    </Card>
  );
}

function HirePanel({
  hourlyRateCents,
  currency = "CAD",
  durationMinutes = 120,
  onDurationChange,
  totalCents,
  feeBreakdown,
  onRequest,
  onMessage,
  state,
  errorMessage,
  className,
}: HirePanelProps) {
  const busy = state === "submitting";
  return (
    <Card className={className} data-type="hire">
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold text-fg">{fmtMoney(hourlyRateCents, currency)}</span>
        <span className="text-sm text-fg-muted">/ hr</span>
      </div>
      <div className="mt-4">
        <DurationPicker value={durationMinutes} onChange={onDurationChange} />
      </div>
      {typeof totalCents === "number" ? (
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-fg-muted">Total</span>
          <span className="font-semibold text-fg">{fmtMoney(totalCents, currency)}</span>
        </div>
      ) : null}
      {feeBreakdown ? <div className="mt-3">{feeBreakdown}</div> : null}
      <div className="mt-4 space-y-2">
        <StateBlock state={state} errorMessage={errorMessage} />
        <Button onClick={onRequest} disabled={busy} className="w-full">
          {busy ? "Sending…" : "Request to book"}
        </Button>
        <Button variant="ghost" onClick={onMessage} disabled={busy} className="w-full">
          Message
        </Button>
      </div>
    </Card>
  );
}

function SellPanel({
  priceCents,
  currency = "CAD",
  condition,
  fulfillment = "pickup",
  onFulfillmentChange,
  onBuy,
  onMakeOffer,
  onMessage,
  state,
  errorMessage,
  className,
}: SellPanelProps) {
  const busy = state === "submitting";
  return (
    <Card className={className} data-type="sell">
      <div className="flex items-center justify-between gap-3">
        <span className="text-2xl font-semibold text-fg">{fmtMoney(priceCents, currency)}</span>
        {condition ? (
          <span className="inline-flex items-center rounded-full bg-bg-subtle px-2.5 py-0.5 text-xs font-medium text-fg-muted">
            {condition}
          </span>
        ) : null}
      </div>
      <div className="mt-4" role="radiogroup" aria-label="Fulfilment">
        {(["pickup", "shipping"] as const).map((opt) => {
          const isActive = fulfillment === opt;
          return (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => onFulfillmentChange?.(opt)}
              className={cn(
                "flex w-full items-center justify-between border-b border-border py-2 text-sm last:border-0",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-md",
              )}
            >
              <span className="capitalize text-fg">{opt === "pickup" ? "Local pickup" : "Shipping"}</span>
              <span
                aria-hidden="true"
                className={cn(
                  "inline-block h-4 w-4 rounded-full border-2",
                  isActive ? "border-[var(--brand)] bg-[var(--brand)]" : "border-border bg-bg",
                )}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-4 space-y-2">
        <StateBlock state={state} errorMessage={errorMessage} />
        <Button onClick={onBuy} disabled={busy} className="w-full">
          {busy ? "Processing…" : "Buy now"}
        </Button>
        <Button variant="ghost" onClick={onMakeOffer} disabled={busy} className="w-full">
          Make offer
        </Button>
        {onMessage ? (
          <Button variant="link" onClick={onMessage} disabled={busy} className="w-full">
            Message
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * Dispatcher — picks the right concrete renderer from `payload.type`.
 * The TS discriminated-union keeps consumers honest: passing `type: "rent"`
 * forces the rest of the payload to match `RentPanelProps`.
 */
export const ActionPanel = forwardRef<HTMLDivElement, ActionPanelProps>(
  ({ payload, className, ...props }, ref) => {
    let body: ReactNode;
    switch (payload.type) {
      case "gift":
        body = <GiftPanel {...payload} />;
        break;
      case "trade":
        body = <TradePanel {...payload} />;
        break;
      case "rent":
        body = <RentPanel {...payload} />;
        break;
      case "hire":
        body = <HirePanel {...payload} />;
        break;
      case "sell":
        body = <SellPanel {...payload} />;
        break;
      default: {
        // Exhaustiveness check — if a future listing_type lands without a
        // renderer, this throws at compile-time. Runtime falls through to
        // a neutral placeholder so prod doesn't blow up on a stale image.
        const _unreachable: never = payload;
        void _unreachable;
        body = (
          <Card data-type="unknown" className={className}>
            <p className="text-sm text-fg-muted">Unsupported listing type.</p>
          </Card>
        );
      }
    }
    return (
      <div ref={ref} className={className} {...props}>
        {body}
      </div>
    );
  },
) as ActionPanelComponent;
ActionPanel.displayName = "ActionPanel";

// Attach the per-type renderers for direct use (`<ActionPanel.Rent ... />`).
type ActionPanelComponent = ReturnType<typeof forwardRef<HTMLDivElement, ActionPanelProps>> & {
  Gift: typeof GiftPanel;
  Trade: typeof TradePanel;
  Rent: typeof RentPanel;
  Hire: typeof HirePanel;
  Sell: typeof SellPanel;
};
ActionPanel.Gift = GiftPanel;
ActionPanel.Trade = TradePanel;
ActionPanel.Rent = RentPanel;
ActionPanel.Hire = HirePanel;
ActionPanel.Sell = SellPanel;

export { GiftPanel, TradePanel, RentPanel, HirePanel, SellPanel };

// Re-export ListingType so consumers can derive from this module alone.
export type { ListingType };
