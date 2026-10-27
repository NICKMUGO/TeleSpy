import { existsSync, readFileSync, rmSync } from "node:fs";
import {
  ACCOUNT_PATH,
  AUTH_DIR,
  activeSessionKey,
  backendEnv,
  psql,
  redis,
} from "./session";

/** Ends the test session and puts the account back as it was. */
export default async function globalTeardown() {
  if (!existsSync(ACCOUNT_PATH)) return;
  const { userId, hadTourRow } = JSON.parse(
    readFileSync(ACCOUNT_PATH, "utf8"),
  ) as { userId: string; hadTourRow: boolean };
  const env = backendEnv();
  redis(env, "DEL", activeSessionKey(userId));
  // The dismiss in setup created this row; leave a pre-existing one alone.
  if (!hadTourRow) {
    psql(env, `delete from tutorial_progress where user_id = '${userId}'`);
  }
  rmSync(AUTH_DIR, { recursive: true, force: true });
}
