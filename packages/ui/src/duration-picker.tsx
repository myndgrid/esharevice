import { forwardRef, useId, type HTMLAttributes } from "react";
import { cn } from "./utils";

/**
 * Common duration presets for hire bookings. Values are in MINUTES so
 * pricing math stays integer-safe ((rate / 60) * minutes). `custom`
 * surfaces a numeric input so consumers can take an arbitrary value.
 */
export const DURATION_PRESETS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 60, label: "1 h" },
  { minutes: 120, label: "2 h" },
  { minutes: 240, label: "4 h" },
  { minutes: 300, label: "Half day" },
  { minutes: 480, label: "Full day" },
];

export type DurationPickerProps = Omit<HTMLAttributes<HTMLDivElement>, "onChange"> & {
  /** Current duration in minutes. Undefined = nothing selected. */
  value?: number;
  /** Emits the new duration in minutes. */
  onChange?: ((minutes: number) => void) | undefined;
  /** Whether to render the "Custom" pill + numeric input. */
  allowCustom?: boolean;
  /** Minimum allowed minutes (used to clamp the custom input). Defaults to 30. */
  min?: number;
  /** Maximum allowed minutes (used to clamp the custom input). Defaults to 24*60. */
  max?: number;
};

/**
 * Pill row for selecting a hire-booking duration. Defaults to 2h since
 * that's the modal hire length per the redesign spec. Custom input is
 * a small numeric field measured in HOURS (so "1.5" works) which is
 * converted to minutes on emit.
 */
export const DurationPicker = forwardRef<HTMLDivElement, DurationPickerProps>(
  (
    { value, onChange, allowCustom = true, min = 30, max = 24 * 60, className, ...props },
    ref,
  ) => {
    const inputId = useId();
    const matchesPreset = DURATION_PRESETS.some((p) => p.minutes === value);
    const customActive = allowCustom && typeof value === "number" && !matchesPreset;

    return (
      <div
        ref={ref}
        role="radiogroup"
        aria-label="Booking duration"
        className={cn("flex flex-wrap items-center gap-2", className)}
        {...props}
      >
        {DURATION_PRESETS.map((p) => {
          const isActive = value === p.minutes;
          return (
            <button
              key={p.minutes}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => onChange?.(p.minutes)}
              className={cn(
                "inline-flex h-10 items-center rounded-full border px-4 text-sm font-medium",
                "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                isActive
                  ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-deep)]"
                  : "border-border bg-bg text-fg hover:border-border-strong",
              )}
            >
              {p.label}
            </button>
          );
        })}
        {allowCustom ? (
          <label
            htmlFor={inputId}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-full border px-3 text-sm",
              customActive
                ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-deep)]"
                : "border-border bg-bg text-fg",
            )}
          >
            <span>Custom</span>
            <input
              id={inputId}
              type="number"
              step={0.5}
              min={min / 60}
              max={max / 60}
              value={customActive ? (value! / 60).toString() : ""}
              placeholder="hrs"
              onChange={(e) => {
                const hrs = parseFloat(e.target.value);
                if (Number.isFinite(hrs) && hrs > 0) {
                  const minutes = Math.min(max, Math.max(min, Math.round(hrs * 60)));
                  onChange?.(minutes);
                }
              }}
              className="w-14 bg-transparent text-center outline-none placeholder:text-fg-subtle"
            />
          </label>
        ) : null}
      </div>
    );
  },
);
DurationPicker.displayName = "DurationPicker";
