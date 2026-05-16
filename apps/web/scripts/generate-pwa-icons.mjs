#!/usr/bin/env node
/**
 * Generate the PWA + Apple icon PNGs from the canonical SVG logo.
 *
 *   public/icon-192.png            — Android home screen, install prompt
 *   public/icon-512.png            — Android splash, larger contexts
 *   public/icon-maskable-512.png   — Android adaptive icon (logo at 70% so it stays
 *                                    inside the safe zone after the OS masks it)
 *   public/apple-touch-icon.png    — iOS home screen (180×180, white tile background)
 *
 * Run with `pnpm gen:icons` from apps/web. The logo's wide aspect ratio
 * is preserved; the script centres it on a square white tile so the icon
 * reads cleanly on any OS background and through any mask shape.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "..", "public");

// Brand logo — two overlapping circles. Inlined so the script has no
// runtime filesystem read of the SVG (avoids cwd issues + makes diffs
// against the brand explicit).
const LOGO_SVG = `<svg width="120" height="120" viewBox="-68.75 -43.75 137.5 87.5" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" role="img">
  <circle cx="25" cy="0" r="42" fill="rgb(14, 165, 233)" stroke="rgb(14, 165, 233)" stroke-width="3.5" />
  <circle cx="-25" cy="0" r="42" fill="rgb(245, 158, 11)" />
</svg>`;

/**
 * Render the logo SVG onto a white square tile.
 *
 * `logoScale` is the fraction of the tile width the LOGO bounds occupy.
 *   - Standard icons: 0.80 — logo fills nicely but with breathing room.
 *   - Maskable: 0.70 — logo stays inside the 80% safe zone after masking.
 *   - Apple: 0.80 — iOS adds its own rounded mask + drop shadow.
 */
async function makeTile(size, logoScale, outPath) {
  const logoSize = Math.round(size * logoScale);
  const logoPng = await sharp(Buffer.from(LOGO_SVG), { density: 1024 })
    .resize({ width: logoSize, height: logoSize, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();

  const tile = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: logoPng, gravity: "center" }])
    .png()
    .toBuffer();

  await writeFile(outPath, tile);
  console.log(`  wrote ${outPath} (${size}×${size}, logo ${Math.round(logoScale * 100)}%)`);
}

async function main() {
  await mkdir(publicDir, { recursive: true });
  console.log("Generating PWA icons…");
  await makeTile(192, 0.8, resolve(publicDir, "icon-192.png"));
  await makeTile(512, 0.8, resolve(publicDir, "icon-512.png"));
  await makeTile(512, 0.7, resolve(publicDir, "icon-maskable-512.png"));
  await makeTile(180, 0.8, resolve(publicDir, "apple-touch-icon.png"));
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
