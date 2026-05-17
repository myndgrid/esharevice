"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./utils";

export type HeartProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  saved: boolean;
  size?: number;
};

/**
 * Save / unsave toggle. Renders an outline heart by default; flips to
 * an amber-filled heart when `saved` is true — one of the few accent-color
 * affordances in the marketplace's otherwise blue-primary palette (per the
 * redesign spec).
 *
 * The button itself is unstyled (transparent), so it composes inside cards,
 * detail headers, and floating glass pills without inheriting button chrome.
 * Always pair with a real `aria-label` like "Save" / "Saved" — the icon
 * alone is not accessible.
 */
export const Heart = forwardRef<HTMLButtonElement, HeartProps>(
  ({ saved, size = 24, className, "aria-pressed": pressed, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-pressed={pressed ?? saved}
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-transparent",
        "transition-transform duration-150 ease-out hover:scale-110 active:scale-95",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        className,
      )}
      {...props}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={saved ? "var(--accent)" : "none"}
        stroke={saved ? "var(--accent)" : "currentColor"}
        strokeWidth={saved ? 0 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </button>
  ),
);
Heart.displayName = "Heart";
