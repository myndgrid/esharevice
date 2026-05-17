import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActionPanel } from "./action-panel";

describe("ActionPanel dispatcher", () => {
  it("renders the Gift variant for type: 'gift' (no price, request-this CTA)", () => {
    render(
      <ActionPanel
        payload={{ type: "gift", meta: "Pickup only · Available now", onRequest: vi.fn() }}
      />,
    );
    expect(screen.getByText(/Free/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Request this/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Message/i })).toBeTruthy();
  });

  it("renders the Trade variant with the wanted-thing prose", () => {
    render(
      <ActionPanel
        payload={{
          type: "trade",
          wants: "A waffle iron in good condition",
          openToOffers: true,
          onPropose: vi.fn(),
        }}
      />,
    );
    expect(screen.getByText("A waffle iron in good condition")).toBeTruthy();
    expect(screen.getByText(/Open to other offers/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Propose a trade/i })).toBeTruthy();
  });

  it("renders the Rent variant with price + unit + Request to book CTA", () => {
    render(
      <ActionPanel
        payload={{
          type: "rent",
          priceCents: 4000,
          currency: "CAD",
          unit: "day",
          onRequest: vi.fn(),
        }}
      />,
    );
    expect(screen.getByText(/(CA)?\$40\.00/)).toBeTruthy();
    expect(screen.getByText(/\/ day/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Request to book/i })).toBeTruthy();
  });

  it("disables the rent CTA until a range is picked", () => {
    render(
      <ActionPanel
        payload={{
          type: "rent",
          priceCents: 4000,
          onRequest: vi.fn(),
        }}
      />,
    );
    const button = screen.getByRole("button", { name: /Request to book/i });
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("renders the Hire variant with hourly rate + duration picker", () => {
    render(
      <ActionPanel
        payload={{
          type: "hire",
          hourlyRateCents: 2500,
          durationMinutes: 120,
          onRequest: vi.fn(),
        }}
      />,
    );
    expect(screen.getByText(/(CA)?\$25\.00/)).toBeTruthy();
    expect(screen.getByText(/\/ hr/)).toBeTruthy();
    // DurationPicker presets render as radio buttons
    expect(screen.getByRole("radio", { name: "2 h" }).getAttribute("aria-checked")).toBe("true");
  });

  it("renders the Sell variant with Buy now + Make offer + condition badge", () => {
    render(
      <ActionPanel
        payload={{
          type: "sell",
          priceCents: 20000,
          condition: "Like new",
          fulfillment: "pickup",
          onBuy: vi.fn(),
          onMakeOffer: vi.fn(),
        }}
      />,
    );
    expect(screen.getByText("Like new")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Buy now/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Make offer/i })).toBeTruthy();
  });

  it("submitting state disables all CTAs and shows the loading label", () => {
    render(
      <ActionPanel payload={{ type: "gift", state: "submitting", onRequest: vi.fn() }} />,
    );
    const cta = screen.getByRole("button", { name: /Sending/i });
    expect(cta.hasAttribute("disabled")).toBe(true);
  });

  it("error state surfaces the message in role=alert", () => {
    render(
      <ActionPanel
        payload={{
          type: "rent",
          priceCents: 1000,
          state: "error",
          errorMessage: "Stripe is unhappy",
          onRequest: vi.fn(),
        }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe("Stripe is unhappy");
  });

  it("fires the primary handler on click", () => {
    const onRequest = vi.fn();
    render(<ActionPanel payload={{ type: "gift", onRequest }} />);
    fireEvent.click(screen.getByRole("button", { name: /Request this/i }));
    expect(onRequest).toHaveBeenCalledOnce();
  });
});
