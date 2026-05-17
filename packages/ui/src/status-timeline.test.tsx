import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusTimeline, stepIndex, BOOKING_STEPS } from "./status-timeline";

describe("stepIndex()", () => {
  it("returns the canonical index for each forward step", () => {
    expect(stepIndex("requested")).toBe(0);
    expect(stepIndex("confirmed")).toBe(1);
    expect(stepIndex("active")).toBe(2);
    expect(stepIndex("returned")).toBe(3);
    expect(stepIndex("completed")).toBe(4);
  });

  it("returns -1 for the terminal-negative branches", () => {
    expect(stepIndex("cancelled")).toBe(-1);
    expect(stepIndex("declined")).toBe(-1);
  });

  it("BOOKING_STEPS is the immutable forward path", () => {
    expect([...BOOKING_STEPS]).toEqual([
      "requested",
      "confirmed",
      "active",
      "returned",
      "completed",
    ]);
  });
});

describe("StatusTimeline rendering", () => {
  it("collapses to a single red cell on cancelled", () => {
    render(<StatusTimeline status="cancelled" />);
    expect(screen.getByRole("status").textContent).toContain("cancelled");
  });

  it("collapses to a single red cell on declined", () => {
    render(<StatusTimeline status="declined" />);
    expect(screen.getByRole("status").textContent).toContain("declined");
  });

  it("renders all 5 steps as a list when forward-active", () => {
    render(<StatusTimeline status="active" />);
    const list = screen.getByRole("list");
    expect(list).toBeTruthy();
    // 5 <li> children, one per step.
    expect(list.querySelectorAll("li")).toHaveLength(5);
  });

  it("marks the current step with aria-current=step", () => {
    render(<StatusTimeline status="confirmed" />);
    const current = screen.getByRole("listitem", { current: "step" });
    expect(current.textContent).toContain("Confirmed");
  });
});
