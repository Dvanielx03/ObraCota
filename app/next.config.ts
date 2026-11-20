import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone", devIndicators: false, turbopack: {root: process.cwd()},
  async rewrites() {
    const upstream = process.env.API_INTERNAL_URL || "http://127.0.0.1:8080";
    return [{source: "/api/:path*", destination: upstream + "/api/:path*"}];
  },
};
export default config;
