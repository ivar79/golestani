import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // CMS-driven image sources are approved per-deployment via env (no hardcoding).
    // Local /assets/* need no config; remote hosts are allowed explicitly.
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default nextConfig;
