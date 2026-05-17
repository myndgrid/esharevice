"use client";

import { useActionState, useId, useRef, useState } from "react";
import { Button } from "@esharevice/ui";
import { createItemAction, type CreateItemFormState } from "./actions";

const INITIAL: CreateItemFormState = { ok: false };

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_MIME = "image/jpeg,image/png,image/webp";

export function CreateItemForm(): React.ReactElement {
  const [state, formAction, pending] = useActionState(createItemAction, INITIAL);
  // One idempotency key per form mount. A user clicking "submit" twice in a
  // row reuses the same key — the API replays the cached response on the
  // second hit. A FRESH form (after a hard reload) gets a fresh key.
  const idemKey = useId();
  const idempotencyKey = `web-create-${idemKey}-${useStableSeed()}`;

  const fieldErrors = !state.ok ? state.fieldErrors ?? {} : {};
  const formError = !state.ok ? state.formError : undefined;

  return (
    <form action={formAction} className="grid gap-5">
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />

      <Field name="provider" label="Your name / handle" error={fieldErrors.provider} required>
        <input
          name="provider"
          maxLength={120}
          className="w-full rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm text-fg outline-none focus:border-brand focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-bg"
          required
        />
      </Field>

      <Field name="service" label="What are you offering?" error={fieldErrors.service} required>
        <input
          name="service"
          maxLength={120}
          placeholder="e.g. Sourdough starter • Carpentry hour • Box of apples"
          className="w-full rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-brand focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-bg"
          required
        />
      </Field>

      <Field name="exchange" label="What would you trade for it?" error={fieldErrors.exchange} required>
        <input
          name="exchange"
          maxLength={240}
          placeholder="e.g. A few free-range eggs • Help moving a sofa"
          className="w-full rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-brand focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-bg"
          required
        />
      </Field>

      <Field name="date" label="When can it happen?" error={fieldErrors.date} required>
        <input
          name="date"
          type="date"
          className="w-full rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm text-fg outline-none focus:border-brand focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-bg"
          required
        />
      </Field>

      <Field name="description" label="More details" error={fieldErrors.description} required>
        <textarea
          name="description"
          maxLength={4000}
          rows={4}
          className="w-full rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm text-fg outline-none focus:border-brand focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-bg"
          required
        />
      </Field>

      <Field name="rate_type" label="Rate or quantity (optional)" error={fieldErrors.rate_type}>
        <input
          name="rate_type"
          maxLength={40}
          placeholder="e.g. per hour • per dozen • one-off"
          className="w-full rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-brand focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-bg"
        />
      </Field>

      <ImagePicker />

      {formError && (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {formError}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button type="submit" variant="brand" size="md" disabled={pending}>
          {pending ? "Posting…" : "Post item"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  error,
  required,
  children,
}: {
  name: string;
  label: string;
  error: string[] | undefined;
  required?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label htmlFor={name} className="grid gap-1.5">
      <span className="text-sm font-medium text-fg">
        {label}
        {required && <span aria-hidden className="ml-0.5 text-danger">*</span>}
      </span>
      {children}
      {error && error.length > 0 && (
        <span role="alert" className="text-xs text-danger">
          {error[0]}
        </span>
      )}
    </label>
  );
}

function ImagePicker(): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setError(null);
    if (!file) {
      setPreview(null);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Image is larger than 10 MB — pick a smaller one.");
      e.target.value = "";
      setPreview(null);
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError(`Unsupported file type ${file.type || "(unknown)"} — JPEG, PNG, or WebP only.`);
      e.target.value = "";
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
  }

  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium text-fg">Photo (optional)</span>
      <input
        ref={inputRef}
        name="image"
        type="file"
        accept={ACCEPTED_MIME}
        onChange={onChange}
        className="block w-full text-sm text-fg-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-bg-subtle file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-fg hover:file:bg-bg-elevated"
      />
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt="Selected image preview"
          className="mt-2 max-h-56 w-full rounded-md border border-border object-cover"
          onLoad={() => preview && URL.revokeObjectURL(preview)}
        />
      )}
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * Stable random seed that survives re-renders within a single form mount but
 * regenerates after a hard navigation. Combined with useId() to produce an
 * idempotency key unique per form instance.
 */
function useStableSeed(): string {
  const ref = useRef<string | null>(null);
  if (ref.current === null) {
    ref.current = crypto.randomUUID();
  }
  return ref.current;
}
