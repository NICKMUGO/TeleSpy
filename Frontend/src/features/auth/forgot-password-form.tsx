"use client";

import { useState } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { ArrowLeft, MailCheck } from "lucide-react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  forgotPasswordSchema,
  type ForgotPasswordValues,
} from "@/features/auth/schemas";
import { forgotPassword } from "@/lib/api/auth";
import { cn } from "@/lib/utils";

export function ForgotPasswordForm({ className }: { className?: string }) {
  const [sent, setSent] = useState(false);
  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  // /auth/forgot-password answers 200 with the same message either way, so
  // account existence never leaks — the UI shows the same confirmation on
  // success and on a transport failure would be misleading, hence the
  // catch still resolves to the neutral state only after a real response.
  async function onSubmit(values: ForgotPasswordValues) {
    await forgotPassword(values.email).catch(() => undefined);
    setSent(true);
  }

  if (sent) {
    return (
      <div className={cn("flex flex-col gap-4", className)}>
        <Alert variant="success">
          <MailCheck aria-hidden="true" />
          <AlertTitle className="font-normal">
            If an account exists for that address, a reset link is on its way.
            The link expires in 30 minutes.
          </AlertTitle>
        </Alert>
        <Button asChild variant="outline" size="lg" className="h-11 w-full">
          <Link href="/login">
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            Back to sign in
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      noValidate
      className={cn("flex flex-col gap-4", className)}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reset-email">Work email</Label>
        <Input
          id="reset-email"
          type="email"
          autoComplete="username"
          placeholder="grace.wanjiru@kenya-airways.com"
          className="h-11"
          aria-invalid={!!form.formState.errors.email}
          aria-describedby={
            form.formState.errors.email ? "reset-email-error" : undefined
          }
          {...form.register("email")}
        />
        {form.formState.errors.email ? (
          <p
            id="reset-email-error"
            role="alert"
            className="text-destructive text-sm"
          >
            {form.formState.errors.email.message}
          </p>
        ) : null}
      </div>

      <Button
        type="submit"
        size="lg"
        disabled={form.formState.isSubmitting}
        className="h-11 w-full"
      >
        {form.formState.isSubmitting ? "Sending…" : "Send reset link"}
      </Button>

      <Button asChild variant="link" size="sm" className="mx-auto">
        <Link href="/login">Back to sign in</Link>
      </Button>
    </form>
  );
}
