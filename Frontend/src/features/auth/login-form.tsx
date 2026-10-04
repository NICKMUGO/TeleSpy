"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { CircleAlert, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { cn } from "@/lib/utils";

// Two-step form: password -> MFA OTP (matches BackendDotNet's real
// /auth/login -> /auth/verify-otp flow, not a single-step stub). The
// mfa_token from step 1 is kept in component state only — it's short-lived
// (5 min) and single-purpose, no reason to put it in the persisted session
// store alongside the real access/refresh tokens.
export function LoginForm({ className }: { className?: string }) {
  const router = useRouter();
  const setSession = useSession((state) => state.setSession);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [resending, setResending] = useState(false);
  // Credential failures are surfaced once, at the top of the form, rather
  // than pinned to the password field: the backend deliberately doesn't say
  // which of the two was wrong, so blaming one field would be misleading.
  const [formError, setFormError] = useState<string | null>(null);
  // Set when /auth/verify-otp comes back 409 "active_session_exists" — the
  // account is already signed in elsewhere and needs an explicit choice
  // before this device takes over (see AuthController.VerifyOtp), the same
  // confirmation WhatsApp Web asks for before linking over an old session.
  const [sessionConflict, setSessionConflict] = useState<{
    message: string;
    hint?: string;
  } | null>(null);
  const [endingOtherSession, setEndingOtherSession] = useState(false);

  const passwordForm = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
  });
  const otpForm = useForm<OtpValues>({ resolver: zodResolver(otpSchema) });

  async function onPasswordSubmit(values: LoginValues) {
    setFormError(null);
    try {
      const response = await login(values.email, values.password);
      setMfaToken(response.data.mfa_token);
      setEmail(values.email);
      toast.success("Verification code sent to your email.");
    } catch (error) {
      setFormError(
        error instanceof ApiError
          ? error.message
          : "Sign-in failed. Check your connection and try again.",
      );
    }
  }

  async function completeLogin(otp: string, forceNewSession: boolean) {
    const response = await verifyOtp(mfaToken!, otp, forceNewSession);
    setSession({
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      user: response.data.user,
    });
    toast.success(
      forceNewSession ? "Signed in. The other device was signed out." : "Signed in.",
    );
    if (response.data.must_change_password) {
      router.push("/settings");
      toast.info("Your password must be changed before continuing.");
    } else {
      router.push("/dashboard");
    }
  }

  async function onOtpSubmit(values: OtpValues) {
    if (!mfaToken) return;
    setFormError(null);
    try {
      await completeLogin(values.otp, false);
    } catch (error) {
      if (error instanceof ApiError && error.errorType === "active_session_exists") {
        setSessionConflict({ message: error.message, hint: error.hint });
        return;
      }
      const message =
        error instanceof ApiError
          ? error.message
          : "Verification failed. Try again.";
      otpForm.setError("otp", { message });
    }
  }

  async function handleEndOtherSession() {
    setEndingOtherSession(true);
    try {
      await completeLogin(otpForm.getValues("otp"), true);
      setSessionConflict(null);
    } catch (error) {
      setSessionConflict(null);
      const message =
        error instanceof ApiError
          ? error.message
          : "Verification failed. Try again.";
      otpForm.setError("otp", { message });
    } finally {
      setEndingOtherSession(false);
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
        className={cn("flex flex-col gap-4", className)}
      >
        <p className="text-muted-foreground text-sm">
          Enter the 6-digit code sent to{" "}
          <span className="text-foreground font-medium">{email}</span>.
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
              className="font-tabular h-11 text-center text-lg tracking-[0.4em]"
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
          size="lg"
          disabled={otpForm.formState.isSubmitting}
          className="h-11 w-full"
        >
          {otpForm.formState.isSubmitting ? "Verifying…" : "Verify and sign in"}
        </Button>
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="link"
            size="sm"
            className="px-0"
            onClick={handleResend}
            disabled={resending}
          >
            {resending ? "Sending…" : "Resend code"}
          </Button>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="text-muted-foreground px-0"
            onClick={() => setMfaToken(null)}
          >
            Use a different account
          </Button>
        </div>

        <Dialog
          open={!!sessionConflict}
          onOpenChange={(open) => !open && setSessionConflict(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Already signed in elsewhere</DialogTitle>
              <DialogDescription>
                {sessionConflict?.message}
                {sessionConflict?.hint ? ` ${sessionConflict.hint}` : ""}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSessionConflict(null)}
                disabled={endingOtherSession}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleEndOtherSession}
                disabled={endingOtherSession}
              >
                {endingOtherSession ? "Signing in…" : "Sign in here"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </form>
    );
  }

  return (
    <form
      onSubmit={passwordForm.handleSubmit(onPasswordSubmit)}
      noValidate
      className={cn("flex flex-col gap-4", className)}
    >
      {formError ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle className="font-normal">{formError}</AlertTitle>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login-email">Work email</Label>
        <Input
          id="login-email"
          type="email"
          autoComplete="username"
          placeholder="grace.wanjiru@kenya-airways.com"
          className="h-11"
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
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="login-password">Password</Label>
          <Link
            href="/forgot-password"
            className="text-primary focus-visible:ring-ring rounded-sm text-sm hover:underline focus-visible:ring-2 focus-visible:outline-none"
          >
            Forgot password?
          </Link>
        </div>
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          className="h-11"
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

      {/* Presentational only for now: the refresh-token lifetime is fixed
       * server-side (JwtRefreshTokenExpiresDays) and /auth/login takes no
       * "remember me" flag, so this cannot yet change session length.
       * Disabled rather than silently inert — see the caption below. */}
      <div className="flex items-center gap-2.5">
        <Checkbox id="login-remember" disabled />
        <Label
          htmlFor="login-remember"
          className="text-muted-foreground font-normal"
        >
          Keep me signed in on this device
        </Label>
      </div>

      <Button
        type="submit"
        size="lg"
        disabled={passwordForm.formState.isSubmitting}
        className="mt-1 h-11 w-full"
      >
        {passwordForm.formState.isSubmitting ? "Signing in…" : "Sign in"}
      </Button>

      <div className="flex items-center gap-3">
        <span className="bg-border-subtle h-px flex-1" />
        <span className="text-muted-foreground text-xs">or</span>
        <span className="bg-border-subtle h-px flex-1" />
      </div>

      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled
        className="h-11 w-full"
        aria-describedby="login-sso-note"
      >
        <KeyRound aria-hidden="true" data-icon="inline-start" />
        Sign in with Kenya Airways SSO
      </Button>
      <p
        id="login-sso-note"
        className="text-muted-foreground -mt-2 text-center text-xs"
      >
        SSO is not enabled for this environment yet.
      </p>
    </form>
  );
}
