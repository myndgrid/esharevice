import Link from "next/link";
import { Button } from "@esharevice/ui";

/**
 * Placeholder for the Buy-now flow (sell listings). Replaced by the real
 * Stripe checkout + shipping/pickup options in PR 10.
 */
export default async function BuyFlowPlaceholder({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 py-12 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Buy now coming soon</h1>
      <p className="mt-3 text-sm text-fg-muted">
        Single-page checkout with shipping or pickup, Stripe Payment Element,
        and order tracking lands in PR 10. Until then, message the seller to
        arrange the sale directly.
      </p>
      <div className="mt-6 flex gap-3">
        <Link href={`/items/${id}`}>
          <Button variant="ghost" size="md">Back to listing</Button>
        </Link>
        <Link href={`/items/${id}#message`}>
          <Button variant="brand" size="md">Message seller</Button>
        </Link>
      </div>
    </main>
  );
}
