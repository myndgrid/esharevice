import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ListingCard } from "./listing-card";

describe("ListingCard", () => {
  it("renders title + provider + neighbourhood + type-aware meta", () => {
    render(
      <ListingCard
        title="KitchenAid Stand Mixer"
        type="rent"
        provider="Bastian"
        neighbourhood="St. Lawrence"
        meta="$40.00 / day"
      />,
    );
    expect(screen.getByText("KitchenAid Stand Mixer")).toBeTruthy();
    expect(screen.getByText("Bastian")).toBeTruthy();
    expect(screen.getByText("St. Lawrence")).toBeTruthy();
    expect(screen.getByText("$40.00 / day")).toBeTruthy();
  });

  it("falls back to a default meta line per type when meta is omitted", () => {
    render(<ListingCard title="A waffle iron" type="trade" />);
    expect(screen.getByText("Open to trades")).toBeTruthy();
  });

  it("renders TypeBadge for gift / trade / hire", () => {
    // "Hire" appears both as the badge label AND as the default meta text;
    // assert at-least-one rather than exact match.
    const { rerender } = render(<ListingCard title="x" type="gift" />);
    expect(screen.getAllByText("Free").length).toBeGreaterThanOrEqual(1);
    rerender(<ListingCard title="x" type="trade" />);
    expect(screen.getAllByText("Trade").length).toBeGreaterThanOrEqual(1);
    rerender(<ListingCard title="x" type="hire" />);
    expect(screen.getAllByText("Hire").length).toBeGreaterThanOrEqual(1);
  });

  it("Heart only renders when `saved` is a boolean; calls onSave on click", () => {
    const onSave = vi.fn();
    render(<ListingCard title="x" type="rent" saved={false} onSave={onSave} />);
    const heart = screen.getByRole("button", { name: /Save/ });
    fireEvent.click(heart);
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("does not render a Heart when `saved` is undefined", () => {
    render(<ListingCard title="x" type="rent" />);
    expect(screen.queryByRole("button", { name: /Save/i })).toBeNull();
  });

  it("shows the Neighbour-favourite pill when neighbourFavourite is true", () => {
    render(<ListingCard title="x" type="rent" neighbourFavourite />);
    expect(screen.getByText("Neighbour favourite")).toBeTruthy();
  });

  it("rating row hidden when rating is null/0", () => {
    const { container } = render(<ListingCard title="x" type="rent" rating={null} />);
    // RatingStar renders nothing for 0/null — there shouldn't be a star glyph.
    expect(container.querySelector("svg path[d^='M12 .587']")).toBeNull();
  });

  it("rating row visible with a numeric rating", () => {
    render(<ListingCard title="x" type="rent" rating={4.88} ratingCount={42} />);
    expect(screen.getByText("4.88")).toBeTruthy();
    expect(screen.getByText("(42)")).toBeTruthy();
  });
});
