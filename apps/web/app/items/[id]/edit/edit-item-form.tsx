"use client";

import Image from "next/image";
import { useActionState, useId, useRef, useState } from "react";
import { Button } from "@esharevice/ui";
import type { ExchangeItem } from "@esharevice/shared";
import { editItemAction, type EditItemFormState } from "./actions";

const INITIAL: EditItemFormState = { ok: false };
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_MIME = "image/jpeg,image/png,image/webp";

export function EditItemForm({ item }: { item: ExchangeItem }): React.ReactElement {
  const [state, formAction, pending] = useActionState(
    async (prev: EditItemFormState, formData: FormData) => editItemAction(item.id, prev, formData),
    INITIAL,
  );
  const idemKey = useId();
  const idempotencyKey = `web-edit-${idemKey}-${useStableSeed()}`;

  const fieldErrors = !state.ok ? state.fieldErrors ?? {} : {};
  const formError = !state.ok ? state.formError : undefined;

  return (
    <form action={formAction} className="grid gap-5">
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />

      <Field name="provider" label="Your name / handle" error={fieldErrors.provider} required>
        <input
          name="provider"
          maxLength={120}
          defaultValue={item.provider}
          className={inputCls}
          required
        />
      </Field>

      <Field name="service" label="What are you offering?" error={fieldErrors.service} required>
        <input
          name="service"
          maxLength={120}
          defaultValue={item.service}
          className={inputCls}
          required
        />
      </Field>

      <Field name="exchange" label="What would you trade for it?" error={fieldErrors.exchange} required>
        <input
          name="exchange"
          maxLength={240}
          defaultValue={item.exchange ?? ""}
          className={inputCls}
          required
        />
      </Field>

      <Field name="date" label="When can it happen?" error={fieldErrors.date} required>
        <input
          name="date"
          type="date"
          defaultValue={formatDateForInput(item.date)}
          className={inputCls}
          required
        />
      </Field>

      <Field name="description" label="More details" error={fieldErrors.description} required>
        <textarea
          name="description"
          maxLength={4000}
          rows={4}
          defaultValue={item.description}
          className={inputCls}
          required
        />
      </Field>

      <Field name="rate_type" label="Rate or quantity (optional)" error={fieldErrors.rate_type}>
        <input
          name="rate_type"
          maxLength={40}
          defaultValue={item.rate_type ?? ""}
          className={inputCls}
        />
      </Field>

      <ImagePicker currentUrl={item.img_url} />

      {formError && (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {formError}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <a
          href={`/items/${item.id}`}
          className="inline-flex h-11 items-center justify-center rounded-md border border-border bg-bg-subtle px-4 text-sm font-medium text-fg hover:bg-bg-elevated"
        >
          Cancel
        </a>
        <Button type="submit" variant="brand" size="md" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

const inputCls =
  "w-full rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-brand focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-bg";

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

function ImagePicker({ currentUrl }: { currentUrl: string | null }): React.ReactElement {
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
    setPreview(URL.createObjectURL(file));
  }

  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium text-fg">Photo</span>
      {currentUrl && !preview && (
        <Image
          src={currentUrl}
          alt="Current listing photo"
          width={1600}
          height={1200}
          sizes="(max-width: 768px) 100vw, 768px"
          className="mb-2 max-h-56 w-full rounded-md border border-border object-cover"
        />
      )}
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt="New image preview"
          className="mb-2 max-h-56 w-full rounded-md border border-border object-cover"
          onLoad={() => URL.revokeObjectURL(preview)}
        />
      )}
      <input
        ref={inputRef}
        name="image"
        type="file"
        accept={ACCEPTED_MIME}
        onChange={onChange}
        className="block w-full text-sm text-fg-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-bg-subtle file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-fg hover:file:bg-bg-elevated"
      />
      <span className="text-xs text-fg-subtle">
        Leave empty to keep the current photo. JPEG, PNG, or WebP up to 10 MB.
      </span>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * Date inputs accept `yyyy-mm-dd`. The API stores `date` as a free-form
 * string so users could have written "next Friday" — only echo into the
 * date input if the string parses as a valid Date.
 */
function formatDateForInput(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function useStableSeed(): string {
  const ref = useRef<string | null>(null);
  if (ref.current === null) ref.current = crypto.randomUUID();
  return ref.current;
}
