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

// Consumes the one-time token from the emailed link — the same link serves
// a forgotten password and a brand-new account's first password (see
// EmployeesController.Create, which issues it on creation). 400
// invalid_reset_token when expired/used; 422 for a weak or reused password.
export async function resetPassword(
  token: string,
  newPassword: string,
  acceptTerms?: boolean,
) {
  return apiRequest<ApiEnvelope<null>>("/auth/reset-password", {
    method: "POST",
    body: { token, new_password: newPassword, accept_terms: acceptTerms },
    unauthenticated: true,
  });
}

/** Is this link an account's first setup? Then the Terms must be accepted
 * along with the password (once, never on a later reset). */
export async function resetPasswordInfo(token: string) {
  return apiRequest<ApiEnvelope<{ first_setup: boolean }>>(
    "/auth/reset-password/info",
    { method: "POST", body: { token }, unauthenticated: true },
  );
}

/** The Terms and Conditions and the Data Protection notice, as text. */
export async function legalNotice() {
  return apiRequest<
    ApiEnvelope<{
      terms_and_conditions: string;
      dpa_notice: string;
      dpa_policy_version: string;
    }>
  >("/auth/legal-notice", { unauthenticated: true });
}
