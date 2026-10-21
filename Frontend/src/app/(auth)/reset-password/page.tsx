import type { Metadata } from "next";
import { BrandLockup } from "@/components/brand/brand-lockup";
import { ResetPasswordForm } from "@/features/auth/reset-password-form";

export const metadata: Metadata = {
  title: "Set your password — TeleSpy",
  // The one-time token is in this page's URL; keep it out of the Referer
  // header of anything the page links to or loads.
  referrer: "no-referrer",
};

// Target of the emailed link (BackendDotNet's PasswordReset builds
// `{FRONTEND_ORIGINS[0]}/reset-password?token=…`), for both a forgotten
// password and a newly created account.
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  const value = typeof token === "string" && token.length > 0 ? token : null;

  return (
    <div className="w-full max-w-sm">
      <BrandLockup eyebrow className="mb-8 lg:hidden" />
      <h1 className="font-heading text-3xl font-semibold tracking-tight">
        Set your password
      </h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Choose a new password for your TeleSpy account.
      </p>
      <ResetPasswordForm token={value} className="mt-7" />
    </div>
  );
}
