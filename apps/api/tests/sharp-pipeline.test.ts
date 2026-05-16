import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import sharp from "sharp";

// Mock R2 BEFORE importing the pipeline so the singleton client never tries to
// connect to a real bucket.
const puts: Array<{ key: string; body: Buffer; contentType: string }> = [];
const existing = new Set<string>();
vi.mock("../src/lib/r2.js", () => ({
  putObject: vi.fn(async (key: string, body: Buffer, contentType: string) => {
    puts.push({ key, body, contentType });
    existing.add(key);
  }),
  objectExists: vi.fn(async (key: string) => existing.has(key)),
  getR2: vi.fn(() => {
    throw new Error("R2 client should not be created in this test");
  }),
}));

import { processAndUpload } from "../src/lib/sharp-pipeline.js";
import { IMAGE_VARIANTS } from "../src/lib/image-url.js";

// Build a synthetic PNG once and reuse — fast and deterministic.
async function makePng(width = 2000, height = 1200): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 120, g: 60, b: 200 },
    },
  })
    .png()
    .toBuffer();
}

describe("processAndUpload", () => {
  beforeEach(() => {
    puts.length = 0;
    existing.clear();
  });

  it("materialises one .webp variant per width and keys them by sha256(content)/<width>.webp", async () => {
    const input = await makePng();
    const expectedHash = createHash("sha256").update(input).digest("hex");

    const result = await processAndUpload(input);

    expect(result.hash).toBe(expectedHash);

    // Every variant width got exactly one PutObject.
    expect(puts).toHaveLength(IMAGE_VARIANTS.length);
    for (const width of IMAGE_VARIANTS) {
      const put = puts.find((p) => p.key === `${expectedHash}/${width}.webp`);
      expect(put, `missing variant ${width}`).toBeDefined();
      expect(put!.contentType).toBe("image/webp");
      expect(put!.body.byteLength).toBeGreaterThan(0);
    }
  });

  it("resizes each variant to the requested width (no upscale)", async () => {
    const input = await makePng(2000, 1200);
    await processAndUpload(input);

    for (const put of puts) {
      const meta = await sharp(put.body).metadata();
      const requested = Number(put.key.split("/")[1]!.replace(".webp", ""));
      // sharp resizes by width; height is auto. width should match requested.
      expect(meta.width).toBe(requested);
      expect(meta.format).toBe("webp");
    }
  });

  it("does not upscale a small input — variants stay at the original width", async () => {
    const small = await makePng(320, 240); // smaller than all variant targets
    await processAndUpload(small);

    for (const put of puts) {
      const meta = await sharp(put.body).metadata();
      expect(meta.width).toBe(320); // withoutEnlargement clamps it
    }
  });

  it("skips re-upload when the same content was already stored", async () => {
    const input = await makePng();
    const hash = createHash("sha256").update(input).digest("hex");

    // Pre-seed the dedup set with all variant keys.
    for (const width of IMAGE_VARIANTS) existing.add(`${hash}/${width}.webp`);

    const result = await processAndUpload(input);

    expect(result.hash).toBe(hash);
    expect(puts).toHaveLength(0); // every variant already existed
  });

  it("throws on malformed inputs", async () => {
    const garbage = Buffer.from("not an image, just text");
    await expect(processAndUpload(garbage)).rejects.toThrow();
    expect(puts).toHaveLength(0); // nothing uploaded on failure
  });
});
