import type { Metadata } from "next";
import { BrandLockup } from "@/components/brand/brand-lockup";
import { ForgotPasswordForm } from "@/features/auth/forgot-password-form";

export const metadata: Metadata = {
  title: "Reset your password — TeleSpy",
};

export default function ForgotPasswordPage() {
  return (
    <div className="w-full max-w-sm">
      <BrandLockup eyebrow className="mb-8 lg:hidden" />
      <h1 className="font-heading text-3xl font-semibold tracking-tight">
        Reset your password
      </h1>
      <p className="text-muted-foreground mt-2 text-sm">
        We&apos;ll email you a link to set a new one.
      </p>
      <ForgotPasswordForm className="mt-7" />
    </div>
  );
}
