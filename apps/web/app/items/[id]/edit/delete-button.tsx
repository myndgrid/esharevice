"use client";

import { useState, useTransition } from "react";
import { Button } from "@esharevice/ui";
import { deleteAction } from "./delete-action";

/**
 * Destructive action with a confirmation. Two clicks needed:
 *   1. The first click flips the button to a confirmation state ("Really
 *      delete?") + reveals a Cancel button. No network call yet.
 *   2. The second click on the confirm button fires the server action,
 *      which archives the item + redirects to the home page.
 *
 * Inline confirm (rather than browser `confirm()` dialog) keeps the
 * experience consistent with our design tokens and is more accessible
 * (focusable, keyboard-navigable, screen-reader-readable).
 */
export function DeleteButton({ itemId }: { itemId: string }): React.ReactElement {
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await deleteAction(itemId, { ok: true });
      // Successful deletion redirects server-side; we only reach this branch on
      // a non-redirecting failure.
      if (!result.ok) {
        setError(result.error);
        setArmed(false);
      }
    });
  }

  if (!armed) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setArmed(true)}
        className="text-danger hover:bg-danger/10"
      >
        Delete listing
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-danger">Really delete? This can&apos;t be undone here.</span>
      <Button
        type="button"
        variant="danger"
        size="sm"
        onClick={onConfirm}
        disabled={pending}
      >
        {pending ? "Deleting…" : "Confirm delete"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setArmed(false)}
        disabled={pending}
      >
        Cancel
      </Button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
