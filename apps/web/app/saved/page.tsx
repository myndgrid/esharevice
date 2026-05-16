import { Card, CardContent } from "@esharevice/ui";
import { requireAuth } from "../../lib/auth";

export const dynamic = "force-dynamic";

export default async function SavedPage(): Promise<React.ReactElement> {
  await requireAuth("/saved");

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <header className="mb-6 grid gap-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Saved</h1>
        <p className="text-sm text-fg-muted">
          Items you&apos;ve bookmarked for later. Coming soon — the bookmark button lands in the next slice.
        </p>
      </header>
      <Card>
        <CardContent>
          <p className="text-sm text-fg-muted">No saved items yet.</p>
        </CardContent>
      </Card>
    </main>
  );
}
