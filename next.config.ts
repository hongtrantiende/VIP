import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Performance: tree-shake large icon/component libraries
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "motion",
      "date-fns",

      "cmdk",
    ],
  },
  // Optimize images
  images: {
    formats: ["image/avif", "image/webp"],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  async redirects() {
    return [{ source: "/landing", destination: "/", permanent: true }];
  },
  async headers() {
    return [
      {
        source: "/wasm/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        // Cache static assets like fonts, images
        source: "/:path*.(woff2|woff|ttf|otf|png|jpg|jpeg|webp|avif|svg|ico)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
