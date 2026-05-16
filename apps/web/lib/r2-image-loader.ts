/**
 * Custom `next/image` loader for R2-backed exchange-item photos.
 *
 * Wired in `next.config.mjs` via `images.loaderFile` so every `<Image>`
 * picks it up globally — this avoids the "Functions cannot be passed
 * directly to Client Components" RSC-boundary error you get if you try
 * to pass a `loader={...}` prop from a server component.
 *
 * The upload pipeline materialises three .webp variants per image at
 *
 *   ${CDN_BASE_URL}/<img_key>/400.webp
 *   ${CDN_BASE_URL}/<img_key>/800.webp
 *   ${CDN_BASE_URL}/<img_key>/1600.webp
 *
 * The API hands the web a URL pointing at the 800w default (see
 * `apps/api/src/lib/image-url.ts` — DEFAULT_VARIANT_WIDTH). Next requests
 * specific widths via this loader as it builds the srcset; we map each
 * requested width to the smallest pre-materialised variant >= the request
 * and rewrite the path segment. Anything that doesn't end in a known
 * variant suffix is passed through unmodified (e.g. blob: URLs would
 * never reach this loader because they bypass next/image, but defensive).
 *
 * `quality` is intentionally ignored — the variants are pre-encoded at
 * fixed quality during the upload, and Next defaults to passing
 * `quality=75` even when we don't ask for it.
 *
 * `images.loaderFile` requires a default export of the function — both
 * forms are exported so client-component callers who want explicit
 * imports still work.
 */
const VARIANT_SUFFIX = /\/(?:400|800|1600)\.webp$/;

type LoaderProps = { src: string; width: number; quality?: number };

export function r2ImageLoader({ src, width }: LoaderProps): string {
  const variant = pickVariant(width);
  // If the src already ends in /<one of our variants>.webp, swap it.
  // Otherwise pass through — the URL didn't come from our pipeline and
  // we can't know which variant is appropriate. Next/image will still
  // load it; we just won't get cross-resolution srcset goodness.
  if (VARIANT_SUFFIX.test(src)) {
    return src.replace(VARIANT_SUFFIX, `/${variant}.webp`);
  }
  return src;
}

/** Snap to the smallest pre-built variant width that's >= the requested width. */
function pickVariant(width: number): 400 | 800 | 1600 {
  if (width <= 400) return 400;
  if (width <= 800) return 800;
  return 1600;
}

export default r2ImageLoader;
