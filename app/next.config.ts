import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone", devIndicators: false, turbopack: {root: process.cwd()},
  // A second build next to a running server (a test battery against another backend) goes to its own folder, e.g.
  // NEXT_DIST_DIR=.next/bateria; `next start` needs the same variable.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // A verified IFC preview can queue for 60 s and run for 150 s. Keep time for the backend to store the result.
  experimental: {proxyTimeout: 240_000},
  async rewrites() {
    const upstream = process.env.API_INTERNAL_URL || "http://127.0.0.1:8080";
    return { fallback: [{source: "/api/:path*", destination: upstream + "/api/:path*"}] };
  },
};
export default config;
