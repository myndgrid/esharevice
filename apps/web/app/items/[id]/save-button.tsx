"use client";

import { useState, useTransition } from "react";
import { Button } from "@esharevice/ui";
import { toggleSaveAction } from "./save-action";

/**
 * Bookmark toggle. The viewer's current save state arrives as an initial
 * prop (the detail page does an `api.isItemSaved` lookup server-side).
 * The button uses optimistic UI: clicking flips the visual immediately
 * while the server action runs; if it fails the optimistic flip rolls
 * back and the error message is shown.
 */
export function SaveButton({
  itemId,
  initialSaved,
}: {
  itemId: string;
  initialSaved: boolean;
}): React.ReactElement {
  const [saved, setSaved] = useState(initialSaved);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    // Optimistic flip — user sees the change instantly. If the server
    // action returns ok:false we revert in the catch branch.
    const prev = saved;
    const next = !saved;
    setSaved(next);
    startTransition(async () => {
      const result = await toggleSaveAction(itemId, prev);
      if (!result.ok) {
        setSaved(prev);
        setError(result.error);
      } else {
        setSaved(result.saved);
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        onClick={onClick}
        variant={saved ? "secondary" : "ghost"}
        size="sm"
        disabled={pending}
        aria-pressed={saved}
        aria-label={saved ? "Remove from saved" : "Save for later"}
      >
        <BookmarkIcon filled={saved} />
        <span>{saved ? "Saved" : "Save"}</span>
      </Button>
      {error && (
        <span role="alert" className="ml-2 text-xs text-danger">
          {error}
        </span>
      )}
    </>
  );
}

function BookmarkIcon({ filled }: { filled: boolean }): React.ReactElement {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 4h12v17l-6-3.5L6 21z" />
    </svg>
  );
}
