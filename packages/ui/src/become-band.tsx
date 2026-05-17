import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "./utils";

export type BecomeBandProps = HTMLAttributes<HTMLElement> & {
  /** Headline, e.g. "Become a provider". */
  title: string;
  /** Supporting line under the headline. */
  description: string;
  /** Call-to-action button or link. Render whatever you want here. */
  cta?: ReactNode;
};

/**
 * The full-bleed "Become a provider" call-to-action band that sits between
 * the listing grid and the "Happening right now" rail on the landing page.
 *
 * Visual identity: sky→amber duo-gradient at low opacity so the foreground
 * text stays readable on top, with a soft brand-coloured ring. Composes
 * a content slot (left) + CTA slot (right) — on mobile it stacks vertically
 * with the CTA full-width.
 */
export const BecomeBand = forwardRef<HTMLElement, BecomeBandProps>(
  ({ title, description, cta, className, ...props }, ref) => (
    <section
      ref={ref}
      className={cn(
        "relative isolate overflow-hidden rounded-2xl border border-border px-6 py-8 sm:px-10 sm:py-10",
        "bg-[var(--bg-elevated)]",
        // Layer the duo gradient under the content via a pseudo-fill so the
        // text can stay solid + readable.
        "before:absolute before:inset-0 before:-z-10 before:opacity-[0.18]",
        "before:bg-[linear-gradient(135deg,var(--brand)_0%,var(--brand-soft)_45%,var(--accent-soft)_75%,var(--accent)_100%)]",
        className,
      )}
      {...props}
    >
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
        <div className="max-w-2xl">
          <h2 className="text-xl font-semibold leading-tight text-fg sm:text-2xl">{title}</h2>
          <p className="mt-1 text-sm text-fg-muted sm:text-base">{description}</p>
        </div>
        {cta ? <div className="w-full sm:w-auto">{cta}</div> : null}
      </div>
    </section>
  ),
);
BecomeBand.displayName = "BecomeBand";
