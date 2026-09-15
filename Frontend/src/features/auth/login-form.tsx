"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
  loginSchema,
  otpSchema,
  type LoginValues,
  type OtpValues,
} from "@/features/auth/schemas";
import { login, resendOtp, verifyOtp } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session-store";

// Two-step form: password -> MFA OTP (matches BackendDotNet's real
// /auth/login -> /auth/verify-otp flow, not a single-step stub). The
// mfa_token from step 1 is kept in component state only — it's short-lived
// (5 min) and single-purpose, no reason to put it in the persisted session
// store alongside the real access/refresh tokens.
export function LoginForm() {
  const router = useRouter();
  const setSession = useSession((state) => state.setSession);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [resending, setResending] = useState(false);

  const passwordForm = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
  });
  const otpForm = useForm<OtpValues>({ resolver: zodResolver(otpSchema) });

  async function onPasswordSubmit(values: LoginValues) {
    try {
      const response = await login(values.email, values.password);
      setMfaToken(response.data.mfa_token);
      setEmail(values.email);
      toast.success("Verification code sent to your email.");
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Sign-in failed. Try again.";
      passwordForm.setError("password", { message });
    }
  }

  async function onOtpSubmit(values: OtpValues) {
    if (!mfaToken) return;
    try {
      const response = await verifyOtp(mfaToken, values.otp);
      setSession({
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        user: response.data.user,
      });
      toast.success("Signed in.");
      if (response.data.must_change_password) {
        router.push("/settings");
        toast.info("Your password must be changed before continuing.");
      } else {
        router.push("/dashboard");
      }
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Verification failed. Try again.";
      otpForm.setError("otp", { message });
    }
  }

  async function handleResend() {
    if (!mfaToken) return;
    setResending(true);
    try {
      await resendOtp(mfaToken);
      toast.success("A new code was sent.");
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Couldn't resend the code.",
      );
    } finally {
      setResending(false);
    }
  }

  if (mfaToken) {
    return (
      <form
        onSubmit={otpForm.handleSubmit(onOtpSubmit)}
        noValidate
        className="flex flex-col gap-4"
      >
        <p className="text-muted-foreground text-sm">
          Enter the 6-digit code sent to{" "}
          <span className="font-medium">{email}</span>.
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="login-otp">Verification code</Label>
          <InputGroup>
            <InputGroupInput
              id="login-otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              className="font-mono tracking-[0.3em]"
              aria-invalid={!!otpForm.formState.errors.otp}
              aria-describedby={
                otpForm.formState.errors.otp ? "login-otp-error" : undefined
              }
              {...otpForm.register("otp")}
            />
          </InputGroup>
          {otpForm.formState.errors.otp ? (
            <p
              id="login-otp-error"
              role="alert"
              className="text-destructive text-sm"
            >
              {otpForm.formState.errors.otp.message}
            </p>
          ) : null}
        </div>

        <Button
          type="submit"
          disabled={otpForm.formState.isSubmitting}
          className="mt-2"
        >
          {otpForm.formState.isSubmitting ? "Verifying…" : "Verify and sign in"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleResend}
          disabled={resending}
        >
          {resending ? "Sending…" : "Resend code"}
        </Button>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setMfaToken(null)}
        >
          Use a different account
        </Button>
      </form>
    );
  }

  return (
    <form
      onSubmit={passwordForm.handleSubmit(onPasswordSubmit)}
      noValidate
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login-email">Work email</Label>
        <Input
          id="login-email"
          type="email"
          autoComplete="username"
          aria-invalid={!!passwordForm.formState.errors.email}
          aria-describedby={
            passwordForm.formState.errors.email
              ? "login-email-error"
              : undefined
          }
          {...passwordForm.register("email")}
        />
        {passwordForm.formState.errors.email ? (
          <p
            id="login-email-error"
            role="alert"
            className="text-destructive text-sm"
          >
            {passwordForm.formState.errors.email.message}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login-password">Password</Label>
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          aria-invalid={!!passwordForm.formState.errors.password}
          aria-describedby={
            passwordForm.formState.errors.password
              ? "login-password-error"
              : undefined
          }
          {...passwordForm.register("password")}
        />
        {passwordForm.formState.errors.password ? (
          <p
            id="login-password-error"
            role="alert"
            className="text-destructive text-sm"
          >
            {passwordForm.formState.errors.password.message}
          </p>
        ) : null}
      </div>

      <Button
        type="submit"
        disabled={passwordForm.formState.isSubmitting}
        className="mt-2"
      >
        {passwordForm.formState.isSubmitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
