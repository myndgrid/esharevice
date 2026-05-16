import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, Card, CardContent } from "@esharevice/ui";
import { api, ApiError } from "../../../lib/api";
import { auth } from "../../../lib/auth";
import { ReserveButton } from "./reserve-button";
import { SaveButton } from "./save-button";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ image_error?: string }>;
};

export default async function ItemDetailPage({ params, searchParams }: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const { image_error } = await searchParams;

  // Fetch the item + (if authenticated) the viewer's profile + their save
  // state in parallel. /v1/me + /save only run when a session is present;
  // anonymous viewers skip both round-trips.
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
  // `<base>/<hash>/<width>.webp` — swap the trailing `/800.webp` for `/1600.webp`
  // to display the full-resolution variant in the detail view.
  const fullImageUrl = item.img_url ? item.img_url.replace(/\/800\.webp$/, "/1600.webp") : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      {image_error && (
        <div
          role="alert"
          className="mb-6 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          The item was posted, but the photo couldn&apos;t be uploaded: {image_error}. You can edit the listing and try again.
        </div>
      )}

      <Card>
        <CardContent>
          {fullImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={fullImageUrl}
              alt={item.service}
              className="mb-5 max-h-[60vh] w-full rounded-md border border-border object-cover"
              loading="eager"
            />
          )}

          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{item.service}</h1>
            {item.reserved && (
              <span className="rounded-full bg-bg-subtle px-2 py-0.5 text-xs text-fg-muted">reserved</span>
            )}
          </div>

          <p className="mb-1 text-sm text-fg-muted">by {item.provider}</p>
          <p className="mb-4 whitespace-pre-line text-sm text-fg">{item.description}</p>

          <dl className="mb-6 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <Pair label="Exchange for" value={item.exchange} />
            <Pair label="Date" value={formatDate(item.date)} />
            {item.rate_type && <Pair label="Rate / quantity" value={item.rate_type} />}
            <Pair label="Listed" value={new Date(item.created_at).toLocaleDateString()} />
          </dl>

          <div className="flex flex-wrap items-center gap-2">
            <Link href="/">
              <Button variant="secondary" size="sm">Back</Button>
            </Link>
            {!session && (
              <Link href={`/api/auth/login?return_to=${encodeURIComponent(`/items/${item.id}`)}`} prefetch={false}>
                <Button variant="primary" size="sm">Sign in to reserve</Button>
              </Link>
            )}
            {session && isOwner && (
              <span className="text-xs text-fg-subtle">You posted this item.</span>
            )}
            {session && !isOwner && !item.reserved && <ReserveButton itemId={item.id} />}
            {session && !isOwner && item.reserved && (
              <span className="text-xs text-fg-muted">
                {me && item.reserved_by === me.id ? "You reserved this." : "Already reserved."}
              </span>
            )}
            {session && <SaveButton itemId={item.id} initialSaved={initialSaved} />}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

function Pair({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs uppercase tracking-wide text-fg-subtle">{label}</dt>
      <dd className="text-sm text-fg">{value}</dd>
    </div>
  );
}

function formatDate(raw: string): string {
  // The API stores `date` as a free-form string ("2026-05-30", "next Friday", etc.).
  // If it parses as ISO, render a friendly form; otherwise echo the raw string.
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
