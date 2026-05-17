"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./utils";
import type { ListingType } from "./type-badge";

export type TypeWizardCardProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  /** Listing type this card selects. */
  type: ListingType;
  /** Display name (e.g. "Rent it out"). */
  title: string;
  /** Supporting one-line description. */
  description: string;
  /** Tiny example chip text ("e.g. lawn mower for the weekend"). */
  example?: string;
  /** Icon element (40–48px). */
  icon?: ReactNode;
  /** Selected state — drives the brand-coloured outline + ring. */
  selected?: boolean;
};

/**
 * The big-card type-selector tile used in step 1 of the listing wizard.
 * Renders as a real <button> with `aria-pressed` so the form's selection
 * model is just `useState<ListingType | undefined>`. Five of these in a
 * horizontal-scroll (mobile) / 5-up grid (desktop).
 */
export const TypeWizardCard = forwardRef<HTMLButtonElement, TypeWizardCardProps>(
  ({ type, title, description, example, icon, selected, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-pressed={!!selected}
      data-type={type}
      className={cn(
        "group relative inline-flex w-full max-w-xs flex-col items-start gap-3 rounded-2xl border bg-bg p-5 text-left",
        "transition-[box-shadow,border-color,transform] duration-150 ease-out",
        "hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-12px_oklch(0%_0_0_/_0.2)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        selected
          ? "border-[var(--brand)] ring-2 ring-[var(--brand)] ring-offset-2 ring-offset-bg"
          : "border-border hover:border-border-strong",
        className,
      )}
      {...props}
    >
      {icon ? (
        <div
          className={cn(
            "inline-flex h-12 w-12 items-center justify-center rounded-xl",
            selected ? "bg-[var(--brand-soft)] text-[var(--brand-deep)]" : "bg-bg-subtle text-fg",
          )}
        >
          {icon}
        </div>
      ) : null}
      <div>
        <h3 className="text-base font-semibold text-fg">{title}</h3>
        <p className="mt-1 text-sm text-fg-muted">{description}</p>
      </div>
      {example ? <span className="text-xs italic text-fg-subtle">{example}</span> : null}
    </button>
  ),
);
TypeWizardCard.displayName = "TypeWizardCard";
