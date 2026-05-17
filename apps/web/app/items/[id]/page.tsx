import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Avatar,
  Button,
  RatingStar,
  StatusPill,
  TrustSignalsRow,
  TypeBadge,
} from "@esharevice/ui";
import { api, ApiError } from "../../../lib/api";
import { auth } from "../../../lib/auth";
import { SaveButton } from "./save-button";
import { startConversationAction } from "./message-owner-action";
import { ItemActionPanel } from "./item-action-panel";

/**
 * Item detail page — PR 7 of the redesign plan.
 *
 * Layout per the master plan:
 *   - Photo gallery hero (single image for now; PR 12-era image array
 *     unlocks the 2-column gallery grid).
 *   - Title row + RatingStar + provider + neighbourhood
 *   - Two-column desktop layout: description + specs + host card on the left,
 *     sticky <ActionPanel> on the right. Stacks vertically on mobile with
 *     the ActionPanel inline above the description.
 *   - Specs grid is type-aware — only renders fields the listing actually has.
 *   - Inline <details> "How fees work" accordion for rent/hire.
 *
 * The action CTAs (Request to book / Buy now / Propose a trade) navigate to
 * the booking flow pages (placeholders in PR 7; real implementations in PRs 9
 * and 10).
 */

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ image_error?: string }>;
};

export default async function ItemDetailPage({ params, searchParams }: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const { image_error } = await searchParams;

  const session = await auth();
  const [itemResult, meResult, saveResult] = await Promise.all([
    api.getExchangeItem(id).catch((err) => ({ __error: err as unknown })),
    session?.access_token ? api.me().catch(() => null) : Promise.resolve(null),
    session?.access_token
      ? api.isItemSaved(id).catch(() => ({ saved: false }))
      : Promise.resolve({ saved: false }),
  ]);

  if ("__error" in itemResult) {
    const err = itemResult.__error;
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  const item = itemResult;
  const me = meResult;
  const isOwner = Boolean(me && me.id === item.user_id);
  const initialSaved = Boolean(session && saveResult.saved);

  // The API returns `img_url` pointing at the 800w variant. The pattern is
  // `<base>/<hash>/<width>.webp` — swap the trailing `/800.webp` for
  // `/1600.webp` for the hero.
  const heroImage = item.img_url ? item.img_url.replace(/\/800\.webp$/, "/1600.webp") : null;

  const showFeesExplainer = item.listing_type === "rent" || item.listing_type === "hire";

  return (
    <main className="pb-24 md:pb-12">
      {image_error && (
        <div
          role="alert"
          className="mx-auto mt-4 max-w-5xl px-4"
        >
          <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            The item was posted, but the photo couldn&apos;t be uploaded: {image_error}. You can edit the listing and try again.
          </div>
        </div>
      )}

      {/* Photo hero */}
      <section className="relative">
        <div className="mx-auto max-w-6xl px-4 pt-4">
          <div className="relative overflow-hidden rounded-2xl bg-bg-soft">
            <div className="aspect-[4/3] md:aspect-[16/9]">
              {heroImage ? (
                <Image
                  src={heroImage}
                  alt={item.service}
                  width={1600}
                  height={900}
                  priority
                  sizes="(max-width: 1024px) 100vw, 1024px"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-fg-subtle">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                </div>
              )}
            </div>
            <Link
              href="/"
              aria-label="Back"
              className="absolute left-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-bg/95 text-fg shadow-[0_1px_4px_-2px_oklch(0%_0_0_/_0.2)] backdrop-blur transition-colors hover:bg-bg"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </Link>
            {session ? (
              <div className="absolute right-4 top-4">
                <SaveButton itemId={item.id} initialSaved={initialSaved} />
              </div>
            ) : null}
            {item.reserved ? (
              <span className="absolute bottom-4 left-4 inline-flex items-center rounded-full bg-bg/95 px-3 py-1 text-xs font-semibold text-fg shadow-[0_1px_4px_-2px_oklch(0%_0_0_/_0.2)] backdrop-blur">
                Reserved
              </span>
            ) : null}
          </div>
        </div>
      </section>

      {/* Title + provider + columns */}
      <section className="mx-auto max-w-6xl px-4 py-8">
        <div className="grid gap-10 md:grid-cols-[1fr_360px]">
          {/* Left column — content */}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <TypeBadge type={item.listing_type} always />
              {item.reserved ? <StatusPill status="active" /> : null}
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-fg sm:text-3xl">{item.service}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-fg-muted">
              <RatingStar value={item.rating ?? 0} />
              {item.neighbourhood ? <span>{item.neighbourhood}</span> : null}
              {typeof item.distance_km === "number" ? (
                <span>· {item.distance_km.toFixed(1)} km away</span>
              ) : null}
              <span>· Listed {new Date(item.created_at).toLocaleDateString()}</span>
            </div>

            {/* Mobile ActionPanel (above description). Desktop renders in the right column. */}
            <div className="mt-6 md:hidden">
              <ItemActionPanel
                itemId={item.id}
                type={item.listing_type}
                provider={item.provider}
                authed={!!session}
                wants={item.wants}
                priceCents={item.price_cents}
                priceUnit={item.price_unit}
                condition={item.condition}
              />
            </div>

            {/* Description */}
            <section className="mt-8">
              <h2 className="text-lg font-semibold text-fg">About this listing</h2>
              <p className="mt-2 whitespace-pre-line text-fg">{item.description}</p>
            </section>

            {/* Specs grid — type-aware, sparse */}
            <SpecsGrid item={item} />

            {/* Host card */}
            <section className="mt-8 rounded-2xl border border-border p-5">
              <div className="flex items-center gap-4">
                <Avatar size="lg" name={item.provider} />
                <div>
                  <p className="text-base font-semibold text-fg">{item.provider}</p>
                  <p className="text-xs text-fg-muted">
                    Member since {new Date(item.created_at).getFullYear()}
                  </p>
                </div>
              </div>
              <div className="mt-3">
                {/* Completed counts + Verified come from PR 12-era profile data;
                    until then the row renders nothing when rating is null. */}
                {typeof item.rating === "number" ? (
                  <TrustSignalsRow rating={item.rating} />
                ) : null}
              </div>
              {session && !isOwner ? (
                <form
                  action={startConversationAction.bind(null, item.id)}
                  className="mt-4"
                  id="message"
                >
                  <Button type="submit" variant="ghost" size="md">
                    Message {item.provider}
                  </Button>
                </form>
              ) : null}
            </section>

            {/* Inline "How fees work" accordion — rent / hire only */}
            {showFeesExplainer ? (
              <section className="mt-8">
                <details className="group rounded-lg border border-border">
                  <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-fg [&::-webkit-details-marker]:hidden">
                    How fees work
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className="transition-transform group-open:rotate-180"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </summary>
                  <div className="border-t border-border px-4 py-3 text-sm text-fg-muted">
                    <p>
                      Bookings on paid listings carry a 10–12% platform fee plus
                      Stripe&apos;s 2.9% + $0.30 CAD processing fee. The provider
                      receives the subtotal minus those two; you see the full
                      breakdown at checkout.
                    </p>
                    <p className="mt-2">
                      Funds release to the provider&apos;s payout account 2 business
                      days after the booking ends — Stripe&apos;s standard hold for
                      dispute coverage.
                    </p>
                  </div>
                </details>
              </section>
            ) : null}

            {/* Owner-only edit link */}
            {session && isOwner ? (
              <section className="mt-8 rounded-lg border border-border bg-bg-subtle p-4 text-sm">
                <p className="text-fg-muted">You posted this listing.</p>
                <Link href={`/items/${item.id}/edit`} className="mt-2 inline-block">
                  <Button variant="ghost" size="sm">
                    Edit listing
                  </Button>
                </Link>
              </section>
            ) : null}
          </div>

          {/* Right column — sticky ActionPanel (desktop only) */}
          <aside className="hidden md:block">
            <div className="sticky top-20">
              <ItemActionPanel
                itemId={item.id}
                type={item.listing_type}
                provider={item.provider}
                authed={!!session}
                wants={item.wants}
                priceCents={item.price_cents}
                priceUnit={item.price_unit}
                condition={item.condition}
              />
            </div>
          </aside>
        </div>
      </section>

      {/* Mobile sticky bottom CTA bar — single primary action */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur md:hidden">
        <MobileStickyCta item={item} authed={!!session} />
      </div>
    </main>
  );
}

function SpecsGrid({ item }: { item: { listing_type: string; condition: string | null; neighbourhood: string | null; available_from: string | null; available_to: string | null; price_unit: string | null; wants: string | null } }) {
  const rows: Array<{ label: string; value: string }> = [];
  if (item.condition) {
    rows.push({ label: "Condition", value: humanCondition(item.condition) });
  }
  if (item.neighbourhood) {
    rows.push({ label: "Pickup area", value: item.neighbourhood });
  }
  if (item.available_from || item.available_to) {
    rows.push({ label: "Available", value: formatAvailability(item.available_from, item.available_to) });
  }
  if (item.price_unit && (item.listing_type === "rent" || item.listing_type === "hire")) {
    rows.push({ label: "Priced by", value: `the ${item.price_unit}` });
  }
  if (item.listing_type === "trade" && item.wants) {
    rows.push({ label: "Wants in return", value: item.wants });
  }
  if (rows.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-fg">Details</h2>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className="grid gap-0.5">
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">{r.label}</dt>
            <dd className="text-sm text-fg">{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function MobileStickyCta({ item, authed }: { item: { id: string; listing_type: string; price_cents: number | null; price_unit: string | null }; authed: boolean }) {
  const label = primaryCtaLabel(item.listing_type);
  const href = authed
    ? primaryCtaHref(item.id, item.listing_type)
    : `/login?callbackUrl=${encodeURIComponent(`/items/${item.id}`)}`;
  const subline = subPriceLine(item);
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        {subline ? <p className="truncate text-sm text-fg">{subline}</p> : null}
        <p className="truncate text-xs text-fg-muted">on this listing</p>
      </div>
      <Link href={href} className="shrink-0">
        <Button variant="brand" size="md">
          {label}
        </Button>
      </Link>
    </div>
  );
}

function primaryCtaLabel(type: string): string {
  switch (type) {
    case "gift":
      return "Request this";
    case "trade":
      return "Propose a trade";
    case "rent":
    case "hire":
      return "Request to book";
    case "sell":
      return "Buy now";
    default:
      return "Continue";
  }
}

function primaryCtaHref(id: string, type: string): string {
  switch (type) {
    case "trade":
      return `/items/${id}/propose`;
    case "sell":
      return `/items/${id}/buy`;
    default:
      return `/items/${id}/book`;
  }
}

function subPriceLine(item: { listing_type: string; price_cents: number | null; price_unit: string | null }): string | null {
  if (item.price_cents === null) return item.listing_type === "gift" ? "Free" : null;
  const cad = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(item.price_cents / 100);
  if (item.listing_type === "rent" && item.price_unit) return `${cad} / ${item.price_unit}`;
  if (item.listing_type === "hire") return `${cad} / hr`;
  return cad;
}

function humanCondition(c: string): string {
  switch (c) {
    case "new":
      return "New";
    case "like_new":
      return "Like new";
    case "good":
      return "Good";
    case "fair":
      return "Fair";
    case "well_used":
      return "Well used";
    default:
      return c;
  }
}

function formatAvailability(from: string | null, to: string | null): string {
  const fmt = (raw: string) => new Date(raw).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (from && to) return `${fmt(from)} – ${fmt(to)}`;
  if (from) return `From ${fmt(from)}`;
  if (to) return `Until ${fmt(to)}`;
  return "";
}
