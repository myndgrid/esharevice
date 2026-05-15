/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@esharevice/ui", "@esharevice/shared"],
  typedRoutes: true,
  // VPS deploy: we host our own images. CDN/R2 origin gets added in week 4.
  images: {
    remotePatterns: [],
  },
};

export default nextConfig;
