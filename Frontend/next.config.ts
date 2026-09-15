import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Deployed as a container behind the Nginx edge tier (not Vercel) — see
  // architecture table in the project brief.
  output: "standalone",
  // Next.js 16 auto-generates AGENTS.md/CLAUDE.md on every `next dev` —
  // removed once already (Phase 3, DECISIONS.md) per the project owner's
  // request to keep the repo free of AI-tooling fingerprints. Disabled at
  // the source this time so it stops coming back.
  agentRules: false,
};

export default nextConfig;
