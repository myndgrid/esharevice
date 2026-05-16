import { notFound, redirect } from "next/navigation";
import { Card, CardContent } from "@esharevice/ui";
import { api, ApiError } from "../../../../lib/api";
import { requireAuth } from "../../../../lib/auth";
import { EditItemForm } from "./edit-item-form";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function EditItemPage({ params }: Props): Promise<React.ReactElement> {
  const { id } = await params;
  await requireAuth(`/items/${id}/edit`);

  // Fetch the item + the viewer's profile in parallel so we can verify
  // ownership before rendering the form.
  const [itemResult, me] = await Promise.all([
    api.getExchangeItem(id).catch((err) => ({ __error: err as unknown })),
    api.me(),
  ]);

  if ("__error" in itemResult) {
    const err = itemResult.__error;
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  const item = itemResult;

  // Non-owners can't reach the edit form. The API would reject the PUT
  // with a 403 anyway, but bouncing them at the page level avoids
  // rendering a useless form full of someone else's data.
  if (me.id !== item.user_id) {
    redirect(`/items/${id}`);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <header className="mb-6 grid gap-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Edit listing</h1>
        <p className="text-sm text-fg-muted">
          Update the details. Replacing the photo is optional — leave the picker empty to keep the
          current one.
        </p>
      </header>
      <Card>
        <CardContent>
          <EditItemForm item={item} />
        </CardContent>
      </Card>
    </main>
  );
}
