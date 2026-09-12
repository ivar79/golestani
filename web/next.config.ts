import type { NextConfig } from "next";

const MARTIN_URL = process.env.MARTIN_URL || "http://127.0.0.1:3000";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "localhost", port: "8020" },
      { protocol: "http", hostname: "127.0.0.1", port: "8020" },
    ],
  },
  async rewrites() {
    return [
      {
        source: "/tiles/catalog",
        destination: `${MARTIN_URL}/catalog`,
      },
      {
        source: "/tiles/basemap/:path*",
        destination: `${MARTIN_URL}/basemap/:path*`,
      },
      {
        source: "/tiles/font/:path*",
        destination: `${MARTIN_URL}/font/:path*`,
      },
      {
        source: "/tiles/sprite/:path*",
        destination: `${MARTIN_URL}/sprite/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
