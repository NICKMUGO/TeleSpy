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

export async function verifyOtp(mfaToken: string, otp: string) {
  return apiRequest<
    ApiEnvelope<{
      access_token: string;
      refresh_token: string;
      user: CurrentUser;
      must_change_password: boolean;
    }>
  >("/auth/verify-otp", {
    method: "POST",
    body: { mfa_token: mfaToken, otp },
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
