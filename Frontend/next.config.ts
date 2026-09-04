import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Deployed as a container behind the Nginx edge tier (not Vercel) — see
  // architecture table in the project brief.
  output: "standalone",
};

export default nextConfig;
