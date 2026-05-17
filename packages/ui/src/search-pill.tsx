"use client";

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "./utils";

export type SearchPillSegment = {
  /** Stable key for the segment (used for React keys). */
  key: string;
  /** Top-label of the segment, e.g. "What" / "Where" / "When". */
  label: string;
  /** Value displayed under the label, or placeholder if empty. */
  value?: string;
  /** Placeholder shown when value is empty. */
  placeholder?: string;
  /** Click handler — segment becomes a button when set. */
  onClick?: () => void;
};

export type SearchPillProps = HTMLAttributes<HTMLDivElement> & {
  segments: SearchPillSegment[];
  /** Search action — rendered as a primary blue circle on the right. */
  onSearch?: () => void;
  /** Optional content rendered inside the search circle (default: magnifier). */
  searchIcon?: ReactNode;
};

/**
 * Hero split-pill search (Airbnb's `[What | Where | When | 🔎]` pattern).
 * Each segment is a clickable region — wire the onClick to open the
 * respective picker (category drawer / location autocomplete / date picker).
 *
 * The mini variant for the masthead lives in MobileSearchPill — same
 * primitive vocabulary but compressed to a single row with truncated values.
 */
export const SearchPill = forwardRef<HTMLDivElement, SearchPillProps>(
  ({ segments, onSearch, searchIcon, className, ...props }, ref) => (
    <div
      ref={ref}
      role="search"
      className={cn(
        "relative inline-flex h-16 max-w-full items-stretch overflow-hidden rounded-full",
        "border border-border bg-bg shadow-[0_4px_18px_-6px_oklch(0%_0_0_/_0.08)]",
        className,
      )}
      {...props}
    >
      {segments.map((seg, i) => (
        <SearchPillSegmentRow key={seg.key} segment={seg} isLast={i === segments.length - 1} />
      ))}
      <button
        type="button"
        onClick={onSearch}
        aria-label="Search"
        className={cn(
          "my-2 mr-2 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full",
          "bg-brand text-brand-fg transition-colors hover:bg-brand-h active:bg-brand-p",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        )}
      >
        {searchIcon ?? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        )}
      </button>
    </div>
  ),
);
SearchPill.displayName = "SearchPill";

function SearchPillSegmentRow({ segment, isLast }: { segment: SearchPillSegment; isLast: boolean }) {
  const content = (
    <span className="flex h-full flex-col justify-center px-6 text-left">
      <span className="text-xs font-semibold text-fg">{segment.label}</span>
      <span className={cn("mt-0.5 text-sm", segment.value ? "text-fg-muted" : "text-fg-subtle")}>
        {segment.value ?? segment.placeholder ?? ""}
      </span>
    </span>
  );
  return (
    <>
      {segment.onClick ? (
        <button
          type="button"
          onClick={segment.onClick}
          className="group inline-flex h-full items-stretch rounded-full transition-colors hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          {content}
        </button>
      ) : (
        <div className="inline-flex h-full items-stretch">{content}</div>
      )}
      {!isLast ? <span aria-hidden="true" className="my-3 w-px self-stretch bg-border" /> : null}
    </>
  );
}
