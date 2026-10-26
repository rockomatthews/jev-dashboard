import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["three"],
  // Hot Potato lives as a plain page in /public
  async rewrites() {
    return [
      { source: "/hot-potato", destination: "/hot-potato.html" },
    ];
  },
};

export default nextConfig;
