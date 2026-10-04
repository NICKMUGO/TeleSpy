import type { Metadata } from "next";
import Link from "next/link";
import { BrandLockup } from "@/components/brand/brand-lockup";
import { LoginForm } from "@/features/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in — TeleSpy",
};

export default function LoginPage() {
  return (
    <div className="w-full max-w-sm">
      {/* The brand rail is lg-only, so the lockup has to reappear here on
       * the narrow layout — otherwise the phone screen is an unbranded
       * pair of text fields. */}
      <BrandLockup eyebrow className="mb-8 lg:hidden" />

      <h1 className="font-heading text-3xl font-semibold tracking-tight">
        Sign in
      </h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Use your Kenya Airways work account to continue.
      </p>

      <LoginForm className="mt-7" />

      <p className="text-muted-foreground mt-10 flex items-center justify-center gap-3 text-xs">
        <Link href="/privacy" className="hover:text-foreground hover:underline">
          Privacy
        </Link>
        <span aria-hidden="true">·</span>
        <Link href="/terms" className="hover:text-foreground hover:underline">
          Terms
        </Link>
        <span aria-hidden="true">·</span>
        <a
          href="mailto:servicedesk@kenya-airways.com"
          className="hover:text-foreground hover:underline"
        >
          Support
        </a>
      </p>
    </div>
  );
}
