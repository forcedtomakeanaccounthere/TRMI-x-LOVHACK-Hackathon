import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@linkroom/shared"],
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  // Dev only: keep Next's badge off the huddle corner at the bottom left of rooms.
  devIndicators: { position: "bottom-right" },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
