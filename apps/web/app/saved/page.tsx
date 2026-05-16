import Image from "next/image";
import Link from "next/link";
import { Card, CardContent } from "@esharevice/ui";
import type { ExchangeItem } from "@esharevice/shared";
import { api, ApiError } from "../../lib/api";
import { requireAuth } from "../../lib/auth";

export const dynamic = "force-dynamic";

export default async function SavedPage(): Promise<React.ReactElement> {
  await requireAuth("/saved");

  let items: ExchangeItem[] = [];
  let error: string | null = null;
  try {
    const page = await api.listSavedItems({ limit: 50 });
    items = page.items;
  } catch (err) {
    error =
      err instanceof ApiError
        ? `${err.problem.title ?? "Request failed"} (${err.status})`
        : "Network error";
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
      <header className="mb-6 grid gap-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Saved</h1>
        <p className="text-sm text-fg-muted">
          Items you&apos;ve bookmarked for later. Tap an item to view details or remove it from saved.
        </p>
      </header>

      {error ? (
        <Card>
          <CardContent>
            <p className="text-sm text-fg-muted">
              Couldn&apos;t load saves: <span className="text-danger">{error}</span>
            </p>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent>
            <p className="text-sm text-fg-muted">
              No saved items yet. Tap the bookmark on any item&apos;s detail page to save it for later.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <SavedItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </main>
  );
}

function SavedItemCard({ item }: { item: ExchangeItem }): React.ReactElement {
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
