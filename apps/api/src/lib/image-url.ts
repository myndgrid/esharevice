/**
 * Compose the public image URL from an R2 object key.
 * Week 4 will wire the real R2 upload + sharp pipeline. Until then this
 * just normalises whatever legacy data exists so the API response shape is stable.
 */
export function imgUrlFromKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const base = process.env.R2_PUBLIC_URL ?? "";
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/${key}`;
}
