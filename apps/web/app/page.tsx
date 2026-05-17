import Link from "next/link";
import { Suspense } from "react";
import {
  BecomeBand,
  Button,
  CategoryStrip,
  HoodTile,
  ListingCard,
  LiveCard,
  SearchPill,
  type CategoryStripItem,
  type ListingType,
  type SearchPillSegment,
} from "@esharevice/ui";
import type { ExchangeItem } from "@esharevice/shared";
import { api, ApiError } from "../lib/api";

/**
 * Marketplace landing — PR 6 of the redesign plan.
 *
 * Layout follows the master plan's "Direct adoption of the marketplace
 * mockup" spec: hero search → CategoryStrip → ListingTypeChips →
 * 5-col card grid → BecomeBand → How-It-Works → Happening-now rail →
 * Neighbourhood tiles → footer.
 *
 * State model: filter chips are server-routed via the `?type=` query.
 * Each chip is a Next <Link> that pushes a new URL; the server re-fetches
 * the list filtered by `listing_type`. No client-side JS needed for the
 * filter — SEO-friendly, every state is a real URL, works without scripts.
 */

export const dynamic = "force-dynamic";

const CHIPS: ReadonlyArray<{ value: "all" | ListingType; label: string }> = [
  { value: "all", label: "All" },
  { value: "gift", label: "Free" },
  { value: "trade", label: "Trade" },
  { value: "rent", label: "Rent" },
  { value: "hire", label: "Hire" },
  { value: "sell", label: "For sale" },
];

const CATEGORY_STRIP: CategoryStripItem[] = [
  { slug: "all", label: "All", icon: <CategoryIcon name="grid" /> },
  { slug: "tools-hand", label: "Hand tools", icon: <CategoryIcon name="wrench" /> },
  { slug: "tools-power", label: "Power tools", icon: <CategoryIcon name="drill" /> },
  { slug: "kitchen", label: "Kitchen", icon: <CategoryIcon name="kitchen" /> },
  { slug: "outdoor", label: "Outdoor", icon: <CategoryIcon name="tree" /> },
  { slug: "sports", label: "Sports", icon: <CategoryIcon name="bike" /> },
  { slug: "services-home", label: "Home services", icon: <CategoryIcon name="hammer" /> },
  { slug: "services-tutoring", label: "Tutoring", icon: <CategoryIcon name="book" /> },
  { slug: "electronics", label: "Electronics", icon: <CategoryIcon name="laptop" /> },
  { slug: "furniture", label: "Furniture", icon: <CategoryIcon name="chair" /> },
];

const HOODS = [
  { slug: "st-lawrence", name: "St. Lawrence", count: 128 },
  { slug: "corktown", name: "Corktown", count: 94 },
  { slug: "distillery", name: "Distillery", count: 61 },
  { slug: "west-don-lands", name: "West Don Lands", count: 47 },
  { slug: "moss-park", name: "Moss Park", count: 38 },
  { slug: "regent-park", name: "Regent Park", count: 31 },
];

// Placeholder activity rail until /v1/activity/recent ships (post-PR 9
// when there's real booking + listing activity to surface).
const LIVE_ACTIVITY: ReadonlyArray<{
  who: string;
  type: ListingType;
  what: string;
  when: string;
  where: string;
}> = [
  { who: "Bastian", type: "rent", what: "a KitchenAid mixer", when: "12m ago", where: "St. Lawrence" },
  { who: "Lily", type: "trade", what: "a ski jacket", when: "1h ago", where: "Corktown" },
  { who: "Marco", type: "hire", what: "a Saturday dog walker", when: "2h ago", where: "Distillery" },
  { who: "Aisha", type: "sell", what: "a road bike", when: "3h ago", where: "West Don Lands" },
  { who: "Jordan", type: "gift", what: "moving boxes (12 of them)", when: "5h ago", where: "Moss Park" },
];

const TYPE_SET = new Set<ListingType>(["gift", "trade", "rent", "hire", "sell"]);

function isListingType(value: string | undefined): value is ListingType {
  return value !== undefined && TYPE_SET.has(value as ListingType);
}

function formatMeta(item: ExchangeItem): string {
  const cad = (cents: number) =>
    new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
  switch (item.listing_type) {
    case "gift":
      return "Free · Pickup only";
    case "trade":
      return item.wants ? `Wants: ${item.wants}` : "Open to trades";
    case "rent":
      return item.price_cents !== null && item.price_unit
        ? `${cad(item.price_cents)} / ${item.price_unit}`
        : "Rent";
    case "hire":
      return item.price_cents !== null
        ? `${cad(item.price_cents)} / hr`
        : "Hire";
    case "sell":
      return item.price_cents !== null ? cad(item.price_cents) : "For sale";
  }
}

function chipHref(value: "all" | ListingType): string {
  return value === "all" ? "/" : `/?type=${value}`;
}

type HomePageProps = {
  searchParams: Promise<{ type?: string }>;
};

export default async function HomePage({ searchParams }: HomePageProps): Promise<React.ReactElement> {
  const params = await searchParams;
  const filter = isListingType(params.type) ? params.type : undefined;

  let items: ExchangeItem[] = [];
  let error: string | null = null;
  try {
    const page = await api.listExchangeItems({
      limit: 20,
      ...(filter ? { listing_type: filter } : {}),
    });
    items = page.items;
  } catch (err) {
    error =
      err instanceof ApiError
        ? `${err.problem.title ?? "Request failed"} (${err.status})`
        : "Network error";
  }

  const heroSegments: SearchPillSegment[] = [
    { key: "what", label: "What", placeholder: "Search anything" },
    { key: "where", label: "Where", value: "Toronto" },
    { key: "when", label: "When", placeholder: "Any time" },
  ];

  return (
    <main>
      {/* Hero */}
      <section className="mx-auto max-w-5xl px-4 pt-10 pb-8 sm:pt-16 sm:pb-12">
        <h1 className="text-balance text-center text-3xl font-semibold tracking-tight text-fg sm:text-5xl">
          Your neighbours have what you need
          <br className="hidden sm:block" />{" "}
          <span className="relative inline-block">
            this weekend
            <span aria-hidden="true" className="absolute inset-x-0 -bottom-1 h-1 bg-[var(--brand)] opacity-70" />
          </span>
          .
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-center text-base text-fg-muted sm:text-lg">
          Trade, rent, or borrow from the people on your street. Free for gift &amp; trade — small fee on
          paid bookings. Built for Toronto.
        </p>
        <div className="mt-8 flex justify-center">
          <SearchPill segments={heroSegments} className="hidden sm:inline-flex" />
        </div>
      </section>

      {/* Sticky category + chip rail */}
      <div className="sticky top-14 z-30 border-b border-border bg-bg/95 backdrop-blur">
        <div className="mx-auto max-w-6xl">
          <CategoryStrip items={CATEGORY_STRIP} active="all" />
          <nav
            aria-label="Filter by listing type"
            className="flex w-full items-center gap-2 overflow-x-auto px-4 py-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {CHIPS.map((chip) => {
              const isActive = filter ? chip.value === filter : chip.value === "all";
              return (
                <Link
                  key={chip.value}
                  href={chipHref(chip.value)}
                  className={
                    "inline-flex h-9 shrink-0 items-center rounded-full border px-4 text-sm font-medium transition-colors " +
                    (isActive
                      ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-deep)]"
                      : "border-border bg-bg text-fg hover:border-border-strong hover:bg-bg-subtle")
                  }
                >
                  {chip.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Gallery */}
      <section className="mx-auto max-w-6xl px-4 py-8">
        {error ? (
          <div className="rounded-lg border border-border bg-bg-subtle p-6 text-sm text-fg-muted">
            Couldn&apos;t load listings — {error}.{" "}
            <Link href="/" className="underline text-brand">
              Retry
            </Link>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-border bg-bg-subtle p-10 text-center text-sm text-fg-muted">
            No listings yet for this filter. Try{" "}
            <Link href="/" className="underline text-brand">
              clearing filters
            </Link>{" "}
            or be the first to list something —{" "}
            <Link href="/items/new" className="underline text-brand">
              add a listing
            </Link>
            .
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {items.map((item) => (
              <ListingCard
                key={item.id}
                title={item.service}
                type={item.listing_type}
                imageUrl={item.img_url}
                provider={item.provider}
                neighbourhood={item.neighbourhood}
                rating={item.rating}
                meta={formatMeta(item)}
                neighbourFavourite={item.neighbour_favourite}
                href={`/items/${item.id}`}
              />
            ))}
          </div>
        )}
      </section>

      {/* Become-a-provider band */}
      <section className="mx-auto max-w-6xl px-4 py-12">
        <BecomeBand
          title="Become a provider"
          description="List the tools, kitchen gear, or services your neighbours already use. Free to start — earn within the week."
          cta={
            <Link href="/items/new">
              <Button variant="brand" size="lg" className="w-full sm:w-auto">
                Get started
              </Button>
            </Link>
          }
        />
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="text-2xl font-semibold tracking-tight text-fg">How it works</h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          <HowStep
            step="1"
            title="List it"
            body="Snap a photo, set a price (or mark it free), tag a category. Takes 90 seconds."
          />
          <HowStep
            step="2"
            title="Get requests"
            body="Neighbours nearby see your listing in their feed. They tap Request — you decide."
          />
          <HowStep
            step="3"
            title="Trade, rent, or sell"
            body="Stripe handles the money. Funds land in your bank in 2-7 days, after the booking ends."
          />
        </div>
      </section>

      {/* Happening right now */}
      <section className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="text-2xl font-semibold tracking-tight text-fg">Happening right now in Toronto</h2>
        <div className="mt-6 flex gap-3 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {LIVE_ACTIVITY.map((a, i) => (
            <LiveCard
              key={i}
              who={a.who}
              type={a.type}
              what={a.what}
              when={a.when}
              where={a.where}
              avatar={<AvatarSeed seed={a.who} />}
            />
          ))}
        </div>
      </section>

      {/* Neighbourhood tiles */}
      <section className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="text-2xl font-semibold tracking-tight text-fg">Browse by neighbourhood</h2>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {HOODS.map((h) => (
            <HoodTile
              key={h.slug}
              href={`/?hood=${h.slug}`}
              name={h.name}
              count={h.count}
              thumb={<div aria-hidden="true" className="h-full w-full rounded-lg bg-bg-soft" />}
            />
          ))}
        </div>
      </section>

      {/* Footer */}
      <Suspense fallback={null}>
        <footer className="mt-16 border-t border-border bg-bg-subtle">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-4 py-12 sm:grid-cols-3">
            <FooterCol
              title="Marketplace"
              links={[
                { label: "Browse", href: "/" },
                { label: "List something", href: "/items/new" },
                { label: "How fees work", href: "/?fees=1" },
              ]}
            />
            <FooterCol
              title="Toronto"
              links={[
                { label: "St. Lawrence", href: "/?hood=st-lawrence" },
                { label: "Corktown", href: "/?hood=corktown" },
                { label: "Distillery", href: "/?hood=distillery" },
              ]}
            />
            <FooterCol
              title="About"
              links={[
                { label: "Privacy", href: "/?legal=privacy" },
                { label: "Terms", href: "/?legal=terms" },
                { label: "Contact", href: "mailto:hello@esharevice.com" },
              ]}
            />
          </div>
          <div className="border-t border-border px-4 py-4 text-center text-xs text-fg-muted">
            © {new Date().getFullYear()} e-Sharevice · Toronto, Canada
          </div>
        </footer>
      </Suspense>
    </main>
  );
}

function HowStep({ step, title, body }: { step: string; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg p-6">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--brand-soft)] text-sm font-semibold text-[var(--brand-deep)]">
        {step}
      </span>
      <h3 className="mt-3 text-lg font-semibold text-fg">{title}</h3>
      <p className="mt-1 text-sm text-fg-muted">{body}</p>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: Array<{ label: string; href: string }> }) {
  return (
    <div>
      <p className="text-sm font-semibold text-fg">{title}</p>
      <ul className="mt-3 space-y-2">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="text-sm text-fg-muted hover:text-fg">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AvatarSeed({ seed }: { seed: string }) {
  const initial = seed.charAt(0).toUpperCase();
  return (
    <div
      className="flex h-full w-full items-center justify-center bg-[var(--brand-soft)] text-sm font-semibold text-[var(--brand-deep)]"
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}

function CategoryIcon({ name }: { name: string }) {
  // Inline minimal SVG glyphs for the category strip. Keeping these here
  // rather than importing an icon lib because the set is tiny + stable.
  const common = {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "grid":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      );
    case "wrench":
      return (
        <svg {...common}>
          <path d="M14 7l3-3a4 4 0 1 1-5 5l-7 7-3-3 7-7a4 4 0 1 1 5-5l-3 3 3 3z" />
        </svg>
      );
    case "drill":
      return (
        <svg {...common}>
          <rect x="3" y="9" width="12" height="6" rx="1" />
          <path d="M15 12h4" />
          <path d="M19 9l3 3-3 3" />
        </svg>
      );
    case "kitchen":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
        </svg>
      );
    case "tree":
      return (
        <svg {...common}>
          <path d="M12 3L4 17h16L12 3z" />
          <path d="M12 17v4" />
        </svg>
      );
    case "bike":
      return (
        <svg {...common}>
          <circle cx="6" cy="17" r="3" />
          <circle cx="18" cy="17" r="3" />
          <path d="M6 17l4-8h5l3 8" />
        </svg>
      );
    case "hammer":
      return (
        <svg {...common}>
          <path d="M3 21l8-8" />
          <path d="M9 7l5-5 7 7-5 5z" />
        </svg>
      );
    case "book":
      return (
        <svg {...common}>
          <path d="M4 4h10a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z" />
          <path d="M18 8v12" />
        </svg>
      );
    case "laptop":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="12" rx="1" />
          <path d="M2 19h20" />
        </svg>
      );
    case "chair":
      return (
        <svg {...common}>
          <path d="M6 4h12v8H6z" />
          <path d="M6 12v8" />
          <path d="M18 12v8" />
        </svg>
      );
    default:
      return null;
  }
}
