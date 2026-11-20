import type { NextConfig } from "next";
const config: NextConfig = { output: "standalone", devIndicators: false, turbopack: {root: process.cwd()} };
export default config;
