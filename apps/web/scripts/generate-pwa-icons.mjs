#!/usr/bin/env node
/**
 * Generate the PWA + Apple icon PNGs + the legacy multi-resolution
 * favicon.ico from the canonical SVG logo.
 *
 *   app/favicon.ico                — 16/32/48 PNG bundled in ICO (legacy
 *                                    browsers + sites that hardcode /favicon.ico)
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
import toIco from "to-ico";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "..", "public");
const appDir = resolve(here, "..", "app");

// Brand logo — two overlapping circles. Inlined so the script has no
// runtime filesystem read of the SVG (avoids cwd issues + makes diffs
// against the brand explicit).
const LOGO_SVG = `<svg width="120" height="120" viewBox="-68.75 -43.75 137.5 87.5" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" role="img">
  <circle cx="25" cy="0" r="42" fill="rgb(14, 165, 233)" stroke="rgb(14, 165, 233)" stroke-width="3.5" />
  <circle cx="-25" cy="0" r="42" fill="rgb(245, 158, 11)" />
</svg>`;

/**
 * Render the logo SVG onto a square tile.
 *
 * `logoScale` is the fraction of the tile width the LOGO bounds occupy.
 *   - Standard icons: 0.80 — logo fills nicely but with breathing room.
 *   - Maskable: 0.70 — logo stays inside the 80% safe zone after masking.
 *   - Apple: 0.80 — iOS adds its own rounded mask + drop shadow.
 *
 * `background` controls the tile fill. Pass `null` for a fully transparent
 * tile — used for the standard PWA icons + the favicon so the logo reads
 * as just-two-circles on dark browser tabs / dark home screens, instead
 * of sitting inside a visible white square. The maskable variant still
 * needs a solid fill because Android masks the entire canvas; without
 * one, the masked area would show as the launcher's default background.
 */
async function makeTile(size, logoScale, outPath, { background = null } = {}) {
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
      background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: logoPng, gravity: "center" }])
    .png()
    .toBuffer();

  await writeFile(outPath, tile);
  const bg = background ? `bg ${background.r},${background.g},${background.b}` : "transparent";
  console.log(`  wrote ${outPath} (${size}×${size}, logo ${Math.round(logoScale * 100)}%, ${bg})`);
}

/**
 * Generate the raw square-tile PNG bytes at a given size (no file write).
 * Used for the favicon.ico assembly; the tile is fully transparent so the
 * favicon reads as just-two-circles on dark browser tabs.
 */
async function renderTilePng(size, logoScale) {
  const logoSize = Math.round(size * logoScale);
  const logoPng = await sharp(Buffer.from(LOGO_SVG), { density: 1024 })
    .resize({
      width: logoSize,
      height: logoSize,
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: logoPng, gravity: "center" }])
    .png()
    .toBuffer();
}

async function main() {
  await mkdir(publicDir, { recursive: true });
  console.log("Generating PWA icons…");
  await makeTile(192, 0.8, resolve(publicDir, "icon-192.png"));
  await makeTile(512, 0.8, resolve(publicDir, "icon-512.png"));
  // Maskable icons MUST fill the canvas — the OS mask uses the full
  // pixel area. Transparent here would show launcher background.
  // White matches the brand light-mode background and reads clean
  // through circle/squircle/rounded-square masks.
  await makeTile(512, 0.7, resolve(publicDir, "icon-maskable-512.png"), {
    background: { r: 255, g: 255, b: 255, alpha: 1 },
  });
  await makeTile(180, 0.8, resolve(publicDir, "apple-touch-icon.png"));

  console.log("Generating favicon.ico…");
  // Multi-resolution ICO so legacy clients (some Outlook/Office contexts,
  // older Windows shell) get a crisp small icon, while modern browsers
  // that ignore the ICO and use the SVG `icon.svg` get the vector.
  const [px16, px32, px48] = await Promise.all([
    renderTilePng(16, 0.9),
    renderTilePng(32, 0.85),
    renderTilePng(48, 0.85),
  ]);
  const ico = await toIco([px16, px32, px48]);
  await writeFile(resolve(appDir, "favicon.ico"), ico);
  console.log(`  wrote ${resolve(appDir, "favicon.ico")} (16/32/48 multi-res)`);

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
