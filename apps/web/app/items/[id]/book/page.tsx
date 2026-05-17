import Link from "next/link";
import { Button } from "@esharevice/ui";

/**
 * Placeholder for the booking flow (rent / hire / gift). Replaced by the
 * real Stripe Payment Element checkout in PR 9.
 */
export default async function BookingFlowPlaceholder({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 py-12 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Booking flow coming soon</h1>
      <p className="mt-3 text-sm text-fg-muted">
        Date selection, fee disclosure, and Stripe checkout for rent &amp; hire
        bookings land in PR 9 of the marketplace rebuild. Until then, message the
        provider to coordinate directly.
      </p>
      <div className="mt-6 flex gap-3">
        <Link href={`/items/${id}`}>
          <Button variant="ghost" size="md">Back to listing</Button>
        </Link>
        <Link href={`/items/${id}#message`}>
          <Button variant="brand" size="md">Message provider</Button>
        </Link>
      </div>
    </main>
  );
}
