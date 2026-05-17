import Link from "next/link";
import { Button } from "@esharevice/ui";

/**
 * Placeholder for the Propose-a-trade flow. The real implementation
 * (counter-offer entry, message thread bootstrap, trade-acceptance ribbon)
 * lands with PR 9.
 */
export default async function ProposeTradePlaceholder({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 py-12 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Propose a trade</h1>
      <p className="mt-3 text-sm text-fg-muted">
        The structured trade-proposal flow (counter-offer entry, accept / decline
        ribbon, automatic message thread bootstrap) lands in PR 9. Until then,
        message the provider directly to negotiate.
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
