"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionPanel, type DateRange, type ListingType } from "@esharevice/ui";

/**
 * Client wrapper around <ActionPanel>. Holds the per-type interactive
 * state (date range for rent, duration for hire, fulfilment for sell)
 * and turns CTA clicks into navigations to the booking/buy flow pages.
 *
 * The page itself stays server-rendered; only this island goes client.
 * Loading state is set via React's transition API so the UI flips to
 * "Sending…" between the click and the route change.
 */
export type ItemActionPanelProps = {
  itemId: string;
  type: ListingType;
  /** Provider's display name — used in fallback copy. */
  provider: string;
  /** Auth state — drives whether CTAs are real or login redirects. */
  authed: boolean;
  /** Listing's wants line — used for trade variant. */
  wants?: string | null;
  /** Listing's price in cents (rent / hire / sell). */
  priceCents?: number | null;
  /**
   * Listing's price unit — affects rent display ("day" / "week"). Currently
   * unused: rent always renders "/ day" until the multi-unit picker lands
   * in PR 9. Keeping the prop on the contract so callers don't churn.
   */
  priceUnit?: "hour" | "day" | "fixed" | null;
  /** Item condition — used for sell variant. */
  condition?: string | null;
  /** Gift / "Free · Pickup only · Available now" meta line. */
  giftMeta?: string;
};

function loginCallback(itemId: string): string {
  return `/login?callbackUrl=${encodeURIComponent(`/items/${itemId}`)}`;
}

export function ItemActionPanel({
  itemId,
  type,
  provider,
  authed,
  wants,
  priceCents,
  // priceUnit is accepted for forward compatibility but not consumed yet;
  // see the prop doc.
  priceUnit: _priceUnit,
  condition,
  giftMeta,
}: ItemActionPanelProps): React.ReactElement {
  const router = useRouter();
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [duration, setDuration] = useState<number>(120);
  const [fulfillment, setFulfillment] = useState<"pickup" | "shipping">("pickup");
  const [pending, startTransition] = useTransition();

  // Compute a live total for rent + hire so the UI surfaces the eventual cost
  // before the user navigates to the booking flow. Server-side math is the
  // authoritative figure on the booking page; this is a preview only.
  const rentNights = range?.from && range?.to
    ? Math.max(1, Math.ceil((range.to.getTime() - range.from.getTime()) / (1000 * 60 * 60 * 24)))
    : 0;
  const rentTotal =
    type === "rent" && priceCents !== null && priceCents !== undefined && rentNights > 0
      ? priceCents * rentNights
      : undefined;
  const hireTotal =
    type === "hire" && priceCents !== null && priceCents !== undefined
      ? Math.round((priceCents / 60) * duration)
      : undefined;

  const navigateIfAuthed = (path: string) => {
    if (!authed) {
      router.push(loginCallback(itemId));
      return;
    }
    startTransition(() => {
      router.push(path);
    });
  };

  const bookPath = (extras: Record<string, string> = {}) => {
    const sp = new URLSearchParams(extras);
    return `/items/${itemId}/book${sp.toString() ? `?${sp.toString()}` : ""}`;
  };

  switch (type) {
    case "gift":
      return (
        <ActionPanel
          payload={{
            type: "gift",
            ...(giftMeta ? { meta: giftMeta } : { meta: "Free · Pickup only · Available now" }),
            state: pending ? "submitting" : "idle",
            onRequest: () => navigateIfAuthed(bookPath()),
            onMessage: () => navigateIfAuthed(`/items/${itemId}#message`),
          }}
        />
      );
    case "trade":
      return (
        <ActionPanel
          payload={{
            type: "trade",
            wants: wants?.trim() || `${provider} hasn't filled this in yet.`,
            state: pending ? "submitting" : "idle",
            onPropose: () => navigateIfAuthed(`/items/${itemId}/propose`),
            onMessage: () => navigateIfAuthed(`/items/${itemId}#message`),
          }}
        />
      );
    case "rent": {
      return (
        <ActionPanel
          payload={{
            type: "rent",
            priceCents: priceCents ?? 0,
            unit: "day",
            ...(range ? { range } : {}),
            onRangeChange: setRange,
            disabledDates: [],
            ...(typeof rentTotal === "number" ? { totalCents: rentTotal } : {}),
            state: pending ? "submitting" : "idle",
            onRequest: () =>
              navigateIfAuthed(
                bookPath({
                  ...(range?.from ? { from: range.from.toISOString() } : {}),
                  ...(range?.to ? { to: range.to.toISOString() } : {}),
                }),
              ),
            onMessage: () => navigateIfAuthed(`/items/${itemId}#message`),
          }}
        />
      );
    }
    case "hire":
      return (
        <ActionPanel
          payload={{
            type: "hire",
            hourlyRateCents: priceCents ?? 0,
            durationMinutes: duration,
            onDurationChange: setDuration,
            ...(typeof hireTotal === "number" ? { totalCents: hireTotal } : {}),
            state: pending ? "submitting" : "idle",
            onRequest: () => navigateIfAuthed(bookPath({ duration: String(duration) })),
            onMessage: () => navigateIfAuthed(`/items/${itemId}#message`),
          }}
        />
      );
    case "sell":
      return (
        <ActionPanel
          payload={{
            type: "sell",
            priceCents: priceCents ?? 0,
            ...(condition ? { condition } : {}),
            fulfillment,
            onFulfillmentChange: setFulfillment,
            state: pending ? "submitting" : "idle",
            onBuy: () => navigateIfAuthed(`/items/${itemId}/buy?fulfillment=${fulfillment}`),
            onMakeOffer: () => navigateIfAuthed(`/items/${itemId}/buy?fulfillment=${fulfillment}&offer=1`),
            onMessage: () => navigateIfAuthed(`/items/${itemId}#message`),
          }}
        />
      );
  }
}
