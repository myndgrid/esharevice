import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PriceBreakdown } from "./price-breakdown";

describe("PriceBreakdown", () => {
  const baseProps = {
    currency: "CAD",
    subtotal: 4000, // $40
    platformFee: 480, // $4.80
    stripeFee: 146, // $1.46
    total: 4626, // $46.26
  };

  it("formats values as a currency amount (CAD)", () => {
    // jsdom (Node ICU) renders CAD via en-CA as "$40.00"; real browsers
    // can render "CA$40.00". Match the numeric part either way.
    render(<PriceBreakdown {...baseProps} collapsible={false} />);
    expect(screen.getByText(/(CA)?\$40\.00/)).toBeTruthy();
    expect(screen.getByText(/(CA)?\$4\.80/)).toBeTruthy();
    expect(screen.getByText(/(CA)?\$1\.46/)).toBeTruthy();
    expect(screen.getAllByText(/(CA)?\$46\.26/).length).toBeGreaterThanOrEqual(1);
  });

  it("hides the deposit row when undefined or zero", () => {
    const { container } = render(<PriceBreakdown {...baseProps} collapsible={false} />);
    expect(container.textContent).not.toMatch(/Deposit/);
    const { container: withZeroDeposit } = render(
      <PriceBreakdown {...baseProps} deposit={0} collapsible={false} />,
    );
    expect(withZeroDeposit.textContent).not.toMatch(/Deposit/);
  });

  it("shows the deposit row when > 0", () => {
    render(<PriceBreakdown {...baseProps} deposit={2500} collapsible={false} />);
    expect(screen.getByText(/Deposit/)).toBeTruthy();
    expect(screen.getByText(/(CA)?\$25\.00/)).toBeTruthy();
  });

  it("renders a collapsed summary that toggles open on click", () => {
    render(<PriceBreakdown {...baseProps} collapsible={true} />);
    // Subtotal/platform/stripe rows are hidden in the collapsed state.
    expect(screen.queryByText("Subtotal")).toBeNull();
    expect(screen.getByRole("button", { expanded: false })).toBeTruthy();

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Subtotal")).toBeTruthy();
    expect(screen.getByRole("button", { expanded: true })).toBeTruthy();
  });

  it("respects defaultOpen when collapsible", () => {
    render(<PriceBreakdown {...baseProps} collapsible defaultOpen />);
    expect(screen.getByText("Subtotal")).toBeTruthy();
  });

  it("renders details directly when collapsible=false", () => {
    render(<PriceBreakdown {...baseProps} collapsible={false} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Subtotal")).toBeTruthy();
  });
});
