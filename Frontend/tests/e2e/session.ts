// Shared by the e2e global setup/teardown: a real signed-in session for the
// tests, without the emailed sign-in code a browser login would need.
//
// It signs an access token with the API's own JWT secret and registers the
// session id in Redis exactly as AuthController's verify-otp does, so
// CurrentUserMiddleware accepts it like any other sign-in. Local only: it
// reads BackendDotNet/.env and needs `psql` and `redis-cli` on the PATH.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export const AUTH_DIR = path.resolve("tests/e2e/.auth");
export const STATE_PATH = path.join(AUTH_DIR, "session.json");
export const ACCOUNT_PATH = path.join(AUTH_DIR, "account.json");

/** A seeded placeholder Manager outside the customer service desk, so the
 * tests see the organisation dashboard and the full sidebar. Never an
 * Admin: there is only one, and a new session would sign the real person
 * out. Override with E2E_ACCOUNT_EMAIL. */
export const ACCOUNT_EMAIL =
  process.env.E2E_ACCOUNT_EMAIL ?? "ops.manager@telespy.local";

export function backendEnv(): Record<string, string> {
  const file =
    process.env.E2E_BACKEND_ENV ?? path.resolve("../BackendDotNet/.env");
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.includes("=") && !line.trimStart().startsWith("#"))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      }),
  );
}

export function psql(env: Record<string, string>, query: string): string {
  return execFileSync(
    "psql",
    [env.DATABASE_URL, "-At", "-F", "\t", "-c", query],
    {
      encoding: "utf8",
    },
  ).trim();
}

export function redis(env: Record<string, string>, ...args: string[]): string {
  return execFileSync("redis-cli", ["-u", env.REDIS_URL, ...args], {
    encoding: "utf8",
  }).trim();
}

export const activeSessionKey = (userId: string) =>
  `telespy:active_session:${userId}`;
