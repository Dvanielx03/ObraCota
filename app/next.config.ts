import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone", devIndicators: false, turbopack: {root: process.cwd()},
  // A second build next to a running server (a test battery against another backend) goes to its own folder, e.g.
  // NEXT_DIST_DIR=.next/bateria; `next start` needs the same variable.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The /api rewrite cuts at 30 s by default; a verified IFC preview may take longer (engine 150 s < backend 180 s < proxy 240 s).
  experimental: {proxyTimeout: 240_000},
  async rewrites() {
    const upstream = process.env.API_INTERNAL_URL || "http://127.0.0.1:8080";
    return { fallback: [{source: "/api/:path*", destination: upstream + "/api/:path*"}] };
  },
};
export default config;
