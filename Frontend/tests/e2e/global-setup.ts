import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import type { FullConfig } from "@playwright/test";
import {
  ACCOUNT_EMAIL,
  ACCOUNT_PATH,
  AUTH_DIR,
  STATE_PATH,
  activeSessionKey,
  backendEnv,
  psql,
  redis,
} from "./session";

const SESSION_SECONDS = 60 * 60;

const base64url = (value: string | Buffer) =>
  Buffer.from(value).toString("base64url");

/** HS256 JWT with the claims Core/Jwt.cs issues. */
function signToken(secret: string, claims: Record<string, unknown>) {
  const head = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(claims));
  const signature = createHmac("sha256", secret)
    .update(`${head}.${body}`)
    .digest("base64url");
  return `${head}.${body}.${signature}`;
}

export default async function globalSetup(config: FullConfig) {
  const env = backendEnv();
  const row = psql(
    env,
    `select u.user_id, u.email, r.role_name, u.role_id, u.is_active,
            u.must_change_password, e.employee_id, e.full_name,
            coalesce(e.staff_number, ''), coalesce(e.department_id, ''),
            (select count(*) from tutorial_progress t where t.user_id = u.user_id)
       from users u
       join roles r on r.role_id = u.role_id
       join employees e on e.employee_id = u.employee_id
      where u.email = '${ACCOUNT_EMAIL.replace(/'/g, "''")}' and e.removed_at is null`,
  );
  if (!row) throw new Error(`e2e: no active account ${ACCOUNT_EMAIL}`);
  const [
    userId,
    email,
    role,
    roleId,
    isActive,
    mustChange,
    employeeId,
    fullName,
    staffNumber,
    departmentId,
    tourRows,
  ] = row.split("\t");
  if (roleId === "admin") {
    throw new Error(
      "e2e: refusing to sign in as the Admin — it would sign the real Admin out. Use a Manager.",
    );
  }

  // The session this token belongs to, registered the way a real sign-in
  // does (Services/Cache.cs SetActiveSessionAsync).
  const sid = randomBytes(16).toString("hex");
  redis(
    env,
    "SET",
    activeSessionKey(userId),
    JSON.stringify({
      Sid: sid,
      Device: "Playwright e2e",
      SignedInAtUtc: new Date().toISOString(),
    }),
    "EX",
    String(SESSION_SECONDS),
  );
  const now = Math.floor(Date.now() / 1000);
  const token = (type: string) =>
    signToken(env.JWT_SECRET_KEY, {
      sub: userId,
      jti: randomBytes(16).toString("hex"),
      type,
      role,
      role_id: roleId,
      ...(departmentId ? { department_id: departmentId } : {}),
      sid,
      nbf: now,
      iat: now,
      exp: now + SESSION_SECONDS,
    });
  const accessToken = token("access");

  // A first-time user gets the guided tour on top of every page; dismiss it
  // so the tests reach the page underneath (teardown undoes this).
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5299";
  const dismissed = await fetch(`${api}/tutorial/dismiss`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch((error: unknown) => {
    throw new Error(
      `e2e: the API at ${api} isn't reachable — start the backend first. (${String(error)})`,
    );
  });
  if (!dismissed.ok) {
    throw new Error(
      `e2e: the API refused the test session (${dismissed.status}). Is ${api} running with this .env?`,
    );
  }

  // What the app keeps in localStorage after a sign-in
  // (lib/auth/session-store.ts, zustand persist).
  const session = {
    state: {
      accessToken,
      refreshToken: token("refresh"),
      user: {
        id: userId,
        email,
        role,
        role_id: roleId,
        is_active: isActive === "t",
        must_change_password: mustChange === "t",
        employee_id: employeeId,
        full_name: fullName,
        staff_number: staffNumber || undefined,
        department_id: departmentId || undefined,
      },
    },
    version: 0,
  };
  const origin = config.projects[0]?.use.baseURL ?? "http://localhost:3000";
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(
    STATE_PATH,
    JSON.stringify({
      cookies: [],
      origins: [
        {
          origin,
          localStorage: [
            { name: "telespy-session", value: JSON.stringify(session) },
          ],
        },
      ],
    }),
  );
  writeFileSync(
    ACCOUNT_PATH,
    JSON.stringify({ userId, hadTourRow: Number(tourRows) > 0 }),
  );
}
