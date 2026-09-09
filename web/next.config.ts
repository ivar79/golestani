import type { NextConfig } from "next";
const nextConfig:NextConfig = {
  images: { remotePatterns: [{ protocol:"https",hostname:"**" },{ protocol:"http",hostname:"localhost",port:"8020" },{ protocol:"http",hostname:"127.0.0.1",port:"8020" }] },
  async headers() {
    return [{ source:"/:path*", headers:[
      {key:"X-Content-Type-Options",value:"nosniff"},
      {key:"X-Frame-Options",value:"DENY"},
      {key:"Referrer-Policy",value:"strict-origin-when-cross-origin"},
      {key:"Permissions-Policy",value:"camera=(), microphone=(), geolocation=(self)"},
    ] }];
  },
};
export default nextConfig;
