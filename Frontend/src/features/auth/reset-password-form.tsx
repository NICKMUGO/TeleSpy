"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { ArrowLeft, CircleAlert, CircleCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  resetPasswordSchema,
  type ResetPasswordValues,
} from "@/features/auth/schemas";
import { ApiError } from "@/lib/api/client";
import { legalNotice, resetPassword, resetPasswordInfo } from "@/lib/api/auth";
import { cn } from "@/lib/utils";

// Landing page for the emailed /reset-password?token=… link. One link
// covers both a forgotten password and a new account's first password —
// accounts created by an Admin start with an unrevealed random password
// and this link is how the person gets in.
export function ResetPasswordForm({
  token,
  className,
}: {
  token: string | null;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  // Set once the backend says the token is unusable — at that point no
  // password will ever be accepted, so the form gives way to a way out.
  const [linkInvalid, setLinkInvalid] = useState(!token);
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
  });
  // A brand-new account accepts the Terms once, here, with its first
  // password (AuthController.ResetPassword). A later reset doesn't ask.
  const [terms, setTerms] = useState<{ terms: string; dpa: string } | null>(
    null,
  );
  const [accepted, setAccepted] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    resetPasswordInfo(token)
      .then(async (info) => {
        if (!info.data.first_setup) return;
        const legal = await legalNotice();
        if (!cancelled) {
          setTerms({
            terms: legal.data.terms_and_conditions,
            dpa: legal.data.dpa_notice,
          });
        }
      })
      .catch((error) => {
        if (
          !cancelled &&
          error instanceof ApiError &&
          error.errorType === "invalid_reset_token"
        ) {
          setLinkInvalid(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onSubmit(values: ResetPasswordValues) {
    if (!token) return;
    if (terms && !accepted) {
      setTermsError("Accept the terms to set up your account.");
      return;
    }
    try {
      await resetPassword(
        token,
        values.newPassword,
        terms ? accepted : undefined,
      );
      setDone(true);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.errorType === "invalid_reset_token"
      ) {
        setLinkInvalid(true);
        return;
      }
      if (error instanceof ApiError && error.errorType === "terms_required") {
        setTermsError(error.message);
        return;
      }
      // validation_error / password_reused both come back pinned to
      // new_password; anything else is a transport or server failure.
      form.setError("newPassword", {
        message:
          error instanceof ApiError
            ? error.message
            : "Couldn't set your password. Try again.",
      });
    }
  }

  if (done) {
    return (
      <div className={cn("flex flex-col gap-4", className)}>
        <Alert variant="success">
          <CircleCheck aria-hidden="true" />
          <AlertTitle className="font-normal">
            Your password is set. You can now sign in with it.
          </AlertTitle>
        </Alert>
        <Button asChild size="lg" className="h-11 w-full">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  if (linkInvalid) {
    return (
      <div className={cn("flex flex-col gap-4", className)}>
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>This link is invalid or has expired.</AlertTitle>
          <AlertDescription>
            Links work once and expire after 30 minutes. Request a new one with
            your work email.
          </AlertDescription>
        </Alert>
        <Button asChild size="lg" className="h-11 w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
        <Button asChild variant="outline" size="lg" className="h-11 w-full">
          <Link href="/login">
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            Back to sign in
          </Link>
        </Button>
      </div>
    );
  }

  const { errors } = form.formState;

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      noValidate
      className={cn("flex flex-col gap-4", className)}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          className="h-11"
          aria-invalid={!!errors.newPassword}
          aria-describedby={
            errors.newPassword ? "new-password-error" : "new-password-hint"
          }
          {...form.register("newPassword")}
        />
        {errors.newPassword ? (
          <p
            id="new-password-error"
            role="alert"
            className="text-destructive text-sm"
          >
            {errors.newPassword.message}
          </p>
        ) : (
          <p id="new-password-hint" className="text-muted-foreground text-xs">
            At least 8 characters, with an uppercase letter, a lowercase letter,
            a digit and a symbol.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm-password">Confirm new password</Label>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          className="h-11"
          aria-invalid={!!errors.confirmPassword}
          aria-describedby={
            errors.confirmPassword ? "confirm-password-error" : undefined
          }
          {...form.register("confirmPassword")}
        />
        {errors.confirmPassword ? (
          <p
            id="confirm-password-error"
            role="alert"
            className="text-destructive text-sm"
          >
            {errors.confirmPassword.message}
          </p>
        ) : null}
      </div>

      {terms ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Terms and data protection</p>
          <div
            className="border-border bg-muted/40 max-h-48 overflow-y-auto rounded-md border p-3 text-xs leading-relaxed whitespace-pre-wrap"
            tabIndex={0}
            aria-label="Terms and Conditions and Data Protection notice"
          >
            {terms.terms.trim()}
            {"\n\n"}
            {terms.dpa.trim()}
          </div>
          <div className="flex items-start gap-2.5">
            <Checkbox
              id="accept-terms"
              checked={accepted}
              onCheckedChange={(value) => {
                setAccepted(value === true);
                setTermsError(null);
              }}
              aria-invalid={!!termsError}
              aria-describedby={termsError ? "accept-terms-error" : undefined}
              className="mt-0.5"
            />
            <Label htmlFor="accept-terms" className="leading-snug font-normal">
              I accept the Terms and Conditions, including notifications, and
              the Data Protection notice.
            </Label>
          </div>
          {termsError ? (
            <p
              id="accept-terms-error"
              role="alert"
              className="text-destructive text-sm"
            >
              {termsError}
            </p>
          ) : null}
        </div>
      ) : null}

      <Button
        type="submit"
        size="lg"
        disabled={form.formState.isSubmitting}
        className="h-11 w-full"
      >
        {form.formState.isSubmitting
          ? "Saving…"
          : terms
            ? "Accept and set password"
            : "Set password"}
      </Button>

      <Button asChild variant="link" size="sm" className="mx-auto">
        <Link href="/login">Back to sign in</Link>
      </Button>
    </form>
  );
}
