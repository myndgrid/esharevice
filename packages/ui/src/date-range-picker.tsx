"use client";

import { forwardRef, type HTMLAttributes } from "react";
import { DayPicker, type DateRange } from "react-day-picker";
import { cn } from "./utils";

export type { DateRange };

export type DateRangePickerProps = Omit<HTMLAttributes<HTMLDivElement>, "onChange"> & {
  /** Currently-selected range, or undefined when nothing is picked. */
  value?: DateRange | undefined;
  /** Emits the new range. Both ends may be undefined while the user picks. */
  onChange?: ((range: DateRange | undefined) => void) | undefined;
  /**
   * Dates the user cannot pick (the provider has bookings on them). The
   * caller computes this set from the bookings table; the picker doesn't
   * fetch anything itself.
   */
  disabledDates?: Date[] | undefined;
  /** Earliest selectable date (defaults to today). */
  fromDate?: Date | undefined;
  /** Latest selectable date (defaults to 365 days from today). */
  toDate?: Date | undefined;
  /** Number of months to render. 2 on desktop, 1 on mobile. Default 2. */
  numberOfMonths?: 1 | 2 | undefined;
};

/**
 * Calendar wrapper for picking a rent-booking date range. Wraps
 * react-day-picker v10's DayPicker in `mode="range"` and applies
 * marketplace tokens via the `modifiersClassNames` API.
 *
 * Consumers must import `react-day-picker/style.css` once globally (see
 * apps/web/app/globals.css). The wrapper adds the brand-coloured overrides
 * on top of that base via inline class names.
 *
 * Tagged `"use client"` so it can be dropped directly into Server
 * Components without the consumer needing the boundary annotation.
 */
export const DateRangePicker = forwardRef<HTMLDivElement, DateRangePickerProps>(
  (
    {
      value,
      onChange,
      disabledDates,
      fromDate,
      toDate,
      numberOfMonths = 2,
      className,
      ...props
    },
    ref,
  ) => {
    const today = startOfToday();
    const min = fromDate ?? today;
    const max = toDate ?? addDays(today, 365);
    const disabledList = [
      { before: min },
      { after: max },
      ...(disabledDates ?? []).map((d) => ({ from: d, to: d })),
    ];

    return (
      <div
        ref={ref}
        className={cn("rounded-lg border border-border bg-bg p-2", className)}
        {...props}
      >
        <DayPicker
          mode="range"
          required={false}
          selected={value}
          onSelect={onChange ?? (() => {})}
          numberOfMonths={numberOfMonths}
          disabled={disabledList}
          showOutsideDays
          classNames={{
            months: "flex flex-col gap-4 sm:flex-row sm:gap-6",
            month: "space-y-2",
            month_caption: "flex items-center justify-between px-2",
            caption_label: "text-sm font-semibold text-fg",
            nav: "flex items-center gap-1",
            button_previous:
              "h-7 w-7 inline-flex items-center justify-center rounded-md border border-border bg-bg text-fg hover:bg-bg-subtle",
            button_next:
              "h-7 w-7 inline-flex items-center justify-center rounded-md border border-border bg-bg text-fg hover:bg-bg-subtle",
            weekday: "w-9 h-9 text-xs font-medium text-fg-muted",
            day: "p-0",
            day_button:
              "inline-flex h-9 w-9 items-center justify-center rounded-md text-sm text-fg hover:bg-bg-subtle aria-selected:bg-[var(--brand)] aria-selected:text-brand-fg",
            today: "font-semibold underline",
            outside: "text-fg-subtle",
            disabled: "text-fg-subtle line-through pointer-events-none",
            range_middle: "rounded-none !bg-[var(--brand-soft)] !text-[var(--brand-deep)]",
            range_start: "rounded-l-md",
            range_end: "rounded-r-md",
          }}
        />
      </div>
    );
  },
);
DateRangePicker.displayName = "DateRangePicker";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
