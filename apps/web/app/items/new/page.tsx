import { Card, CardContent } from "@esharevice/ui";
import { requireAuth } from "../../../lib/auth";
import { CreateItemForm } from "./create-item-form";

export const dynamic = "force-dynamic";

export default async function NewItemPage(): Promise<React.ReactElement> {
  await requireAuth("/items/new");

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <header className="mb-6 grid gap-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">List a new item</h1>
        <p className="text-sm text-fg-muted">
          Describe what you&apos;re offering, what you&apos;d trade for, and add a photo. Neighbours will see it on the home page.
        </p>
      </header>
      <Card>
        <CardContent>
          <CreateItemForm />
        </CardContent>
      </Card>
    </main>
  );
}
