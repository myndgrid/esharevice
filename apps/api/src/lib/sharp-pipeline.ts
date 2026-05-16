import { createHash } from "node:crypto";
import sharp from "sharp";
import { IMAGE_VARIANTS, type ImageVariantWidth } from "./image-url.js";
import { putObject, objectExists } from "./r2.js";

/**
 * Hard limits at the binary level — anything bigger is rejected BEFORE
 * sharp decodes. sharp itself is allocation-bounded but a hostile 100 MB
 * input still does measurable work.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/** Allowed input MIME types — restricts what sharp will accept. */
export const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type ProcessedImage = {
  /** sha256 hex of the raw upload — also the R2 key prefix. */
  hash: string;
  /** Width → byte count of the resized .webp body. Useful for tests/logs. */
  variantBytes: Record<ImageVariantWidth, number>;
};

/**
 * Decode → autoOrient (handle EXIF rotation) → resize to each variant width
 * → encode as webp(quality 82). Upload each variant to R2 keyed by
 * `${sha256_of_original}/${width}.webp`.
 *
 * Idempotent at the storage layer: if a variant key already exists in R2,
 * we skip the upload. The hash is computed from the ORIGINAL bytes so any
 * change to the source image produces a fresh hash + fresh keys.
 *
 * Defensive choices:
 * - `failOn: "error"` — sharp throws on truncated/malformed inputs rather
 *   than producing a "best effort" image.
 * - `withoutEnlargement: true` — never upscale; a 320×240 upload stays at
 *   320×240 even though we requested width 400.
 * - `rotate()` before resize — EXIF orientation flags get baked in.
 */
export async function processAndUpload(input: Buffer): Promise<ProcessedImage> {
  const hash = createHash("sha256").update(input).digest("hex");

  const variantBytes: Partial<Record<ImageVariantWidth, number>> = {};
  for (const width of IMAGE_VARIANTS) {
    const key = `${hash}/${width}.webp`;

    // Skip re-encode + re-upload when the same content was uploaded before.
    if (await objectExists(key)) {
      variantBytes[width] = 0;
      continue;
    }

    const body = await sharp(input, { failOn: "error" })
      .rotate() // apply EXIF orientation
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

    await putObject(key, body, "image/webp");
    variantBytes[width] = body.byteLength;
  }

  return { hash, variantBytes: variantBytes as Record<ImageVariantWidth, number> };
}
