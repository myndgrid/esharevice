"use client";

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "./utils";
import { Heart } from "./heart";
import { RatingStar } from "./rating-star";
import { TypeBadge, type ListingType } from "./type-badge";

export type ListingCardProps = HTMLAttributes<HTMLElement> & {
  /** Listing display name (service / item name). */
  title: string;
  /** Listing type — drives the type-aware meta line + the badge. */
  type: ListingType;
  /** Cover image URL. Falls back to a neutral placeholder when omitted. */
  imageUrl?: string | null;
  /** Photo `alt` text for screen readers. Defaults to title. */
  imageAlt?: string;
  /** Provider display name shown in the second meta row. */
  provider?: string;
  /** Neighbourhood / area label rendered between provider and rating. */
  neighbourhood?: string | null;
  /** Star rating (0-5). `null`/0 hides the rating row. */
  rating?: number | null;
  /** Review count behind the rating. */
  ratingCount?: number;
  /**
   * Type-specific meta. Caller is responsible for formatting (e.g. "$40/day"
   * for rent, "Wants: a waffle iron" for trade, "Free · Pickup only" for gift).
   * When omitted, falls back to a sensible default per type.
   */
  meta?: string;
  /** "Neighbour favourite" highlight pill on the photo. */
  neighbourFavourite?: boolean;
  /** Heart toggle state. Pass undefined to hide the heart. */
  saved?: boolean;
  /** Tap handler for the heart toggle. */
  onSave?: () => void;
  /** Render slot for the link wrapper (typically a Next.js <Link>). */
  href?: string;
  /** Render slot for an explicit <a>/<Link> wrapper. Overrides href. */
  linkRender?: (children: ReactNode) => ReactNode;
};

const DEFAULT_META: Record<ListingType, string> = {
  gift: "Free · Pickup only",
  trade: "Open to trades",
  rent: "Rent",
  hire: "Hire",
  sell: "For sale",
};

/**
 * Marketplace listing card for landing/search/saved gallery grids.
 *
 * Composes Heart + RatingStar + TypeBadge with a type-aware meta line. The
 * caller formats `meta` because pricing logic (e.g. "$40 / day" vs "$25 / hr"
 * vs "Wants: a waffle iron") is type + locale aware and lives upstream.
 *
 * Visual:
 *   - 4/5 portrait aspect cover image
 *   - Heart in the top-right of the cover (saved = amber fill)
 *   - "Neighbour favourite" pill in the top-left when set
 *   - 12px-radius card chrome, hover lifts slightly + tightens shadow
 *
 * Photo carousel dots are NOT in this primitive — they'd require image array
 * state + arrow controls. PR 7 (item detail) introduces a full gallery
 * component; here we render the single cover image.
 */
export const ListingCard = forwardRef<HTMLElement, ListingCardProps>(
  (
    {
      title,
      type,
      imageUrl,
      imageAlt,
      provider,
      neighbourhood,
      rating,
      ratingCount,
      meta,
      neighbourFavourite,
      saved,
      onSave,
      href,
      linkRender,
      className,
      ...props
    },
    ref,
  ) => {
    const showHeart = typeof saved === "boolean";
    const metaLine = meta ?? DEFAULT_META[type];
    const wrap = (content: ReactNode) => {
      if (linkRender) return linkRender(content);
      if (href) {
        return (
          <a
            href={href}
            className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-xl"
          >
            {content}
          </a>
        );
      }
      return content;
    };

    return (
      <article
        ref={ref}
        className={cn("group flex w-full flex-col gap-2", className)}
        {...props}
      >
        <div className="relative">
          {wrap(
            <div className="relative overflow-hidden rounded-xl bg-bg-soft">
              <div className="aspect-[4/5] w-full">
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={imageAlt ?? title}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.02]"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-fg-subtle">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </div>
                )}
              </div>
              {neighbourFavourite ? (
                <span
                  className="absolute left-3 top-3 inline-flex items-center rounded-full bg-bg/95 px-2.5 py-1 text-xs font-semibold text-fg shadow-[0_1px_4px_-2px_oklch(0%_0_0_/_0.2)] backdrop-blur"
                >
                  Neighbour favourite
                </span>
              ) : null}
            </div>,
          )}
          {showHeart ? (
            <Heart
              saved={!!saved}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSave?.();
              }}
              aria-label={saved ? "Saved" : "Save"}
              className="absolute right-3 top-3 bg-bg/90 backdrop-blur"
            />
          ) : null}
        </div>
        <div className="flex flex-col gap-0.5 px-0.5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 text-sm font-semibold text-fg">{title}</h3>
            <TypeBadge type={type} />
          </div>
          <p className="text-xs text-fg-muted">
            {provider ? <span>{provider}</span> : null}
            {provider && neighbourhood ? <span aria-hidden="true"> · </span> : null}
            {neighbourhood ? <span>{neighbourhood}</span> : null}
          </p>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-fg">{metaLine}</p>
            <RatingStar
              value={rating ?? 0}
              {...(typeof ratingCount === "number" ? { count: ratingCount } : {})}
            />
          </div>
        </div>
      </article>
    );
  },
);
ListingCard.displayName = "ListingCard";
