import { env } from "../env.js";

/**
 * Image variant widths the upload pipeline materialises.
 * Stored as `${img_key}/${width}.webp` in R2 and exposed at
 * `${CDN_BASE_URL}/${img_key}/${width}.webp` to the browser.
 *
 * 1600w — full-page / lightbox.
 *  800w — card / list view (default `img_url`).
 *  400w — thumbnail / message previews.
 */
export const IMAGE_VARIANTS = [1600, 800, 400] as const;
export type ImageVariantWidth = (typeof IMAGE_VARIANTS)[number];

/**
 * Default variant width returned as `img_url` to API clients.
 * Frontend can string-replace `/800.webp` → `/1600.webp` etc. to opt into
 * larger / smaller variants; the contract is documented in the v1 API
 * feature doc.
 */
export const DEFAULT_VARIANT_WIDTH: ImageVariantWidth = 800;

/**
 * Compose the public image URL from an R2 object key. Returns null when
 * R2 hasn't been configured yet (so the API stays usable in dev/test
 * before the bucket + creds are provisioned).
 */
export function imgUrlFromKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const base = env.CDN_BASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/${key}/${DEFAULT_VARIANT_WIDTH}.webp`;
}

/**
 * Compose the public URL for a specific variant width. Used by clients that
 * want to override the default — `imgUrlVariant(key, 1600)`.
 */
export function imgUrlVariant(
  key: string | null | undefined,
  width: ImageVariantWidth,
): string | null {
  if (!key) return null;
  const base = env.CDN_BASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/${key}/${width}.webp`;
}
