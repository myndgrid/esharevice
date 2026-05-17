"use client";

import { useActionState } from "react";
import { Button } from "@esharevice/ui";
import { reserveAction, type ReserveActionState } from "./reserve-action";

const INITIAL: ReserveActionState = { ok: true };

export function ReserveButton({ itemId }: { itemId: string }): React.ReactElement {
  // useActionState's reducer signature is (state, _formData) => state. We bind
  // the item id at creation time so the action handler has a stable input.
  const [state, formAction, pending] = useActionState<ReserveActionState, FormData>(
    async (prev) => reserveAction(itemId, prev),
    INITIAL,
  );

  return (
    <form action={formAction} className="contents">
      <Button type="submit" variant="brand" size="sm" disabled={pending}>
        {pending ? "Reserving…" : "Reserve"}
      </Button>
      {state && !state.ok && (
        <span role="alert" className="ml-2 text-xs text-danger">
          {state.error}
        </span>
      )}
    </form>
  );
}
