#!/usr/bin/env node
// Completes the standalone build. `output: "standalone"` (next.config.ts)
// writes a self-contained server to .next/standalone/, but Next.js leaves
// two folders out on purpose, expecting a CDN or the deploy step to serve
// them:
//   public/        -> .next/standalone/public        (sw.js, offline.html…)
//   .next/static/  -> .next/standalone/.next/static  (the JS/CSS bundles)
// Without them the app loads with no styles or scripts, and the installed
// app (PWA) loses its service worker and offline page. Copying them here,
// as the last step of `pnpm build`, means .next/standalone is ready to run
// (`node .next/standalone/server.js`) however it's deployed — Docker, CI
// or by hand.
//
// Plain Node ESM, no dependencies, so it works on Linux, macOS and Windows.

import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");

if (!existsSync(path.join(standalone, "server.js"))) {
  console.error(
    'No standalone build at .next/standalone — run `next build` first (and keep output: "standalone" in next.config.ts).',
  );
  process.exit(1);
}

for (const [from, to] of [
  ["public", "public"],
  [path.join(".next", "static"), path.join(".next", "static")],
]) {
  const source = path.join(root, from);
  const target = path.join(standalone, to);
  if (!existsSync(source)) continue;
  // Start clean so files deleted from the source don't linger.
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });
  console.log(`Copied ${from}/ into .next/standalone/${to}/`);
}
