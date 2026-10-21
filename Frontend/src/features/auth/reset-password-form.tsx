"use client";

import { useState } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { ArrowLeft, CircleAlert, CircleCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  resetPasswordSchema,
  type ResetPasswordValues,
} from "@/features/auth/schemas";
import { ApiError } from "@/lib/api/client";
import { resetPassword } from "@/lib/api/auth";
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

  async function onSubmit(values: ResetPasswordValues) {
    if (!token) return;
    try {
      await resetPassword(token, values.newPassword);
      setDone(true);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.errorType === "invalid_reset_token"
      ) {
        setLinkInvalid(true);
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

      <Button
        type="submit"
        size="lg"
        disabled={form.formState.isSubmitting}
        className="h-11 w-full"
      >
        {form.formState.isSubmitting ? "Saving…" : "Set password"}
      </Button>

      <Button asChild variant="link" size="sm" className="mx-auto">
        <Link href="/login">Back to sign in</Link>
      </Button>
    </form>
  );
}
