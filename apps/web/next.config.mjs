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

export default nextConfig;
