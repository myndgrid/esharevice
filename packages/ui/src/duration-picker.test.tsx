import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DurationPicker, DURATION_PRESETS } from "./duration-picker";

describe("DurationPicker", () => {
  it("renders one radio per preset + a custom slot by default", () => {
    render(<DurationPicker />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(DURATION_PRESETS.length);
  });

  it("highlights the preset matching value (e.g. 120 → 2 h)", () => {
    render(<DurationPicker value={120} />);
    const twoHours = screen.getByRole("radio", { name: "2 h" });
    expect(twoHours.getAttribute("aria-checked")).toBe("true");
  });

  it("fires onChange with the preset minutes on click", () => {
    const onChange = vi.fn();
    render(<DurationPicker onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "4 h" }));
    expect(onChange).toHaveBeenCalledWith(240);
  });

  it("custom input clamps within [min, max]", () => {
    const onChange = vi.fn();
    render(<DurationPicker onChange={onChange} min={60} max={300} />);
    const input = screen.getByPlaceholderText("hrs") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "6" } });
    // 6h = 360 min, clamped to max=300
    expect(onChange).toHaveBeenLastCalledWith(300);

    fireEvent.change(input, { target: { value: "0.5" } });
    // 30 min, clamped to min=60
    expect(onChange).toHaveBeenLastCalledWith(60);
  });

  it("custom hidden when allowCustom={false}", () => {
    render(<DurationPicker allowCustom={false} />);
    expect(screen.queryByPlaceholderText("hrs")).toBeNull();
  });
});
