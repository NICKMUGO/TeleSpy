import { apiRequest } from "@/lib/api/client";
import type { ApiEnvelope, CurrentUser } from "@/lib/api/types";

// Two-step login: password -> mfa_token, then OTP -> access/refresh tokens.
// Both mfa_token and otp travel in the JSON body (BackendDotNet's
// VerifyOtpRequest/MfaTokenRequest, read via RequestBody.ReadJsonSilentAsync)
// — not as a Bearer header, despite mfa_token itself being a JWT. Easy to
// get backwards; confirmed against AuthController.cs directly.

export async function login(email: string, password: string) {
  return apiRequest<
    ApiEnvelope<{ mfa_token: string; expires_in_minutes: number }>
  >("/auth/login", {
    method: "POST",
    body: { email, password },
    unauthenticated: true,
  });
}

// forceNewSession is only ever true on a resubmit: the first attempt came
// back 409 "active_session_exists" (this account is signed in elsewhere),
// the person was shown that and chose "sign in here anyway" — see
// AuthController.VerifyOtp, which otherwise refuses to mint a session over
// an existing one rather than silently ending it.
export async function verifyOtp(
  mfaToken: string,
  otp: string,
  forceNewSession = false,
) {
  return apiRequest<
    ApiEnvelope<{
      access_token: string;
      refresh_token: string;
      user: CurrentUser;
      must_change_password: boolean;
    }>
  >("/auth/verify-otp", {
    method: "POST",
    body: { mfa_token: mfaToken, otp, force_new_session: forceNewSession },
    unauthenticated: true,
  });
}

export async function resendOtp(mfaToken: string) {
  return apiRequest<ApiEnvelope<{ expires_in_minutes: number }>>(
    "/auth/resend-otp",
    {
      method: "POST",
      body: { mfa_token: mfaToken },
      unauthenticated: true,
    },
  );
}

export async function logout() {
  return apiRequest<ApiEnvelope<null>>("/auth/logout", { method: "POST" });
}

// Always 200 with the same message whether or not the address exists —
// the backend deliberately doesn't confirm account existence here, so the
// UI must not branch on the response either.
export async function forgotPassword(email: string) {
  return apiRequest<ApiEnvelope<null>>("/auth/forgot-password", {
    method: "POST",
    body: { email },
    unauthenticated: true,
  });
}
