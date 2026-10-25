import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["three"],
  // the two public toys live as plain pages in /public
  async rewrites() {
    return [
      { source: "/heat-check", destination: "/heat-check.html" },
      { source: "/hot-potato", destination: "/hot-potato.html" },
    ];
  },
};

export default nextConfig;
