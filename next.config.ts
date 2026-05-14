import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Performance: tree-shake large icon/component libraries
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "motion",
      "date-fns",
      "cmdk",
    ],
    // Cache client-side navigations for faster page transitions
    staleTimes: {
      dynamic: 60,  // revalidate dynamic pages every 60s
      static: 300,   // cache static pages for 5min
    },
  },
  // Optimize images
  images: {
    formats: ["image/avif", "image/webp"],
    unoptimized: true,
  },
  // Enable gzip/brotli compression
  compress: true,
  // Reduce powered-by header info leak
  poweredByHeader: false,
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
        // Cache dict files aggressively (they change rarely)
        source: "/dict/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
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
