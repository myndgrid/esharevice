import Image from "next/image";
import Link from "next/link";
import { Card, CardContent } from "@esharevice/ui";
import type { ExchangeItem } from "@esharevice/shared";
import { api, ApiError } from "../lib/api";

export default async function HomePage(): Promise<React.ReactElement> {
  let items: ExchangeItem[] = [];
  let error: string | null = null;
  try {
    const page = await api.listExchangeItems({ limit: 20 });
    items = page.items;
  } catch (err) {
    error = err instanceof ApiError ? `${err.problem.title ?? "Request failed"} (${err.status})` : "Network error";
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
      <section className="mb-10 grid gap-3">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          e-Sharevice
        </h1>
        <p className="text-fg-muted">
          A community skill and item exchange. Browse what your neighbours are sharing, or list something yourself.
        </p>
      </section>

      {error ? (
        <Card>
          <CardContent>
            <p className="text-sm text-fg-muted">
              Couldn&apos;t load items: <span className="text-danger">{error}</span>
            </p>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent>
            <p className="text-sm text-fg-muted">
              No items yet. Sign in and post the first one.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, i) => (
            // First 3 cards are above the fold on most viewports — eager-load
            // their images + flag them as fetchPriority="high" so the browser
            // doesn't wait for layout to discover them. Lighthouse measures
            // LCP from the first painted hero card; lazy-loading made LCP
            // 2.8 s instead of <1.5 s.
            <ExchangeItemCard key={item.id} item={item} priority={i < 3} />
          ))}
        </div>
      )}
    </main>
  );
}

function ExchangeItemCard({
  item,
  priority,
}: {
  item: ExchangeItem;
  priority: boolean;
}): React.ReactElement {
  return (
    <Link
      href={`/items/${item.id}`}
      className="block rounded-lg outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      <Card>
        <CardContent>
          {item.img_url && (
            <div className="relative mb-3 aspect-[4/3] w-full overflow-hidden rounded-md">
              <Image
                src={item.img_url}
                alt={item.service}
                fill
                priority={priority}
                // Roughly: full viewport width on mobile, ~half on tablet,
                // ~third on desktop (matches the home-grid breakpoints).
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="object-cover"
              />
            </div>
          )}
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">{item.provider}</h2>
            {item.reserved && (
              <span className="rounded-full bg-bg-subtle px-2 py-0.5 text-xs text-fg-muted">
                reserved
              </span>
            )}
          </div>
          <p className="mb-1 text-sm font-medium text-fg">{item.service}</p>
          <p className="mb-3 line-clamp-3 text-sm text-fg-muted">{item.description}</p>
          <p className="text-xs text-fg-subtle">
            Exchange: <span className="text-fg-muted">{item.exchange}</span>
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
