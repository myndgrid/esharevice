import type { MetadataRoute } from "next";

/**
 * Web App Manifest. Served from /manifest.webmanifest at the URL root via
 * Next 15's file-based manifest route. The `theme_color` matches the
 * light-mode `<meta name="theme-color">` already set in app/layout.tsx
 * so the OS title bar reads consistently on first paint.
 *
 * `display: "standalone"` is the install contract — Chrome only offers
 * Add-to-Home-Screen for sites that ask for it explicitly via this
 * field. iOS Safari ignores this and uses its own heuristics + the
 * `apple-touch-icon` link in <head>.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "e-Sharevice",
    short_name: "e-Sharevice",
    description: "A community skill and item exchange.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#fefefe",
    categories: ["social", "lifestyle", "shopping"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
