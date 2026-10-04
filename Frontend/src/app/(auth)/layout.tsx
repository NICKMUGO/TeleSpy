import type { ReactNode } from "react";
import { SignInBrandPanel } from "@/features/auth/sign-in-brand-panel";

// Route-group layout (applies to every page under (auth)/) — see the note
// in (app)/layout.tsx for why this can't use the LayoutProps<'/path'> helper.
//
// Split screen: a fixed brand/explainer rail on the left, the form on the
// right. Below lg the rail drops out entirely and the form becomes the
// whole screen — the explainer is nice-to-have, signing in is not.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh">
      <SignInBrandPanel />
      <main
        id="main-content"
        tabIndex={-1}
        className="focus-visible:ring-ring flex flex-1 flex-col items-center justify-center px-6 py-12 focus-visible:ring-2 focus-visible:outline-none sm:px-10"
      >
        {children}
      </main>
    </div>
  );
}
