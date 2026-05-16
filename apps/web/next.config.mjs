import withPWAInit from "@ducanh2912/next-pwa";

/**
 * PWA wrapper. Generates a service worker at /sw.js that:
 *   - Precaches the built JS/CSS shell (the immutable /_next/static/* output)
 *   - Network-first for HTML so navigations always try the server first
 *   - Skipped entirely in dev (no SW noise during HMR)
 *
 * `register: true` injects the registration script into our document so
 * we don't have to hand-wire a useEffect in a client component.
 * `skipWaiting: true` activates new SW versions immediately on next load
 * so a deploy lands on the user's next refresh rather than the one after.
 */
const withPWA = withPWAInit({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
  // Don't try to precache the manifest endpoint itself — it's a tiny
  // dynamic route and the SW would otherwise log a build warning.
  buildExcludes: [/middleware-manifest\.json$/],
  // Our own override goes BEFORE the plugin's defaults. extendDefaultRuntimeCaching
  // keeps the (sensible) defaults for static assets + page navigations.
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    runtimeCaching: [
      // NEVER cache same-origin /api/* requests. The SSE proxy at
      // /api/messages/:id/events is a long-running stream that wouldn't
      // complete inside NetworkFirst's 10s timeout — the SW would either
      // kill the connection or cache an empty body. Auth callbacks +
      // logout endpoints also have side effects that must always hit
      // the server. Letting the default /api/ NetworkFirst catch these
      // is the worst kind of bug: works locally, breaks in production.
      {
        urlPattern: ({ url, sameOrigin }) =>
          sameOrigin && url.pathname.startsWith("/api/"),
        handler: "NetworkOnly",
      },
    ],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@esharevice/ui", "@esharevice/shared"],
  typedRoutes: true,
  // VPS deploy: we host our own images. CDN/R2 origin gets added in week 4.
  images: {
    remotePatterns: [
      // R2 custom domain — long-cached webp variants from the upload pipeline.
      { protocol: "https", hostname: "cdn.esharevice.com" },
    ],
    // Custom global loader rewrites srcset URLs to the closest pre-built
    // variant (400/800/1600.webp). Setting this globally is what lets RSC
    // pages pass `<Image src=... />` without the loader= prop crossing the
    // function-prop RSC boundary.
    loader: "custom",
    loaderFile: "./lib/r2-image-loader.ts",
  },
  experimental: {
    // Default is 1 MB, which trips on the image-upload form action since our
    // server-side cap is 10 MB. Set this slightly above the API's MAX_UPLOAD_BYTES
    // so the action handler — not Next's body-size guard — is the thing that
    // produces the 413 if a user really does ship something oversized.
    serverActions: {
      bodySizeLimit: "11mb",
    },
  },
};

export default withPWA(nextConfig);
