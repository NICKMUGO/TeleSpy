import { toast } from "sonner";
import { useSession } from "@/lib/auth/session-store";
import type { ApiErrorBody } from "@/lib/api/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5299";

export class ApiError extends Error {
  status: number;
  errorType: string;
  field?: string;
  hint?: string;

  constructor(body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = body.status;
    this.errorType = body.error_type;
    this.field = body.field;
    this.hint = body.hint;
  }
}

// A 401 mid-request triggers a refresh; if several requests 401 at once,
// they all await the same in-flight refresh instead of each firing their
// own POST /auth/refresh.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = useSession.getState().refreshToken;
  if (!refreshToken) return null;

  if (!refreshPromise) {
    // The refresh token travels as the Bearer header, not a JSON body —
    // BackendDotNet's /auth/refresh reads Authorization directly and
    // requires it to be a refresh-type token (see AuthController.cs).
    refreshPromise = fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${refreshToken}` },
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const body = (await res.json()) as { data: { access_token: string } };
        return body.data.access_token;
      })
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Skip attaching Authorization — only /auth/login and /auth/verify-otp. */
  unauthenticated?: boolean;
}

function buildUrl(path: string, query?: RequestOptions["query"]) {
  // Joined as text, not `new URL(path, base)`: that drops any path on the
  // base (".../api" + "/auth/login" would become "/auth/login"). The base
  // may also be relative ("/api" in production, same origin behind Caddy).
  const origin =
    typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const url = new URL(`${API_BASE_URL.replace(/\/+$/, "")}${path}`, origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function rawRequest<T>(
  path: string,
  options: RequestOptions,
  accessToken: string | null,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (accessToken && !options.unauthenticated) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(buildUrl(path, options.query), {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) return undefined as T;

  const parsed = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      parsed ?? {
        error_type: "unknown_error",
        message: `Request failed with status ${response.status}.`,
        status: response.status,
      },
    );
  }
  return parsed as T;
}

/** The one place every API call goes through: attaches auth, retries once
 * after a token refresh on 401, and signs the session out if that refresh
 * also fails (expired/revoked refresh token). */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { accessToken } = useSession.getState();
  try {
    return await rawRequest<T>(path, options, accessToken);
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 401 &&
      !options.unauthenticated
    ) {
      const newAccessToken = await refreshAccessToken();
      if (newAccessToken) {
        useSession.getState().setAccessToken(newAccessToken);
        return rawRequest<T>(path, options, newAccessToken);
      }
      // One session per account, server-enforced (BackendDotNet's
      // CurrentUserMiddleware/AuthController): signing in anywhere else
      // invalidates this one. Refreshing can't recover from that (the
      // refresh token belongs to the same superseded session), so it's
      // worth telling the person why they're being dropped, not just
      // silently bouncing them to /login like a normal expiry.
      if (error.errorType === "session_superseded") {
        toast.error(
          "Signed out — this account was signed in from another location.",
        );
      }
      useSession.getState().clear();
    }
    throw error;
  }
}
