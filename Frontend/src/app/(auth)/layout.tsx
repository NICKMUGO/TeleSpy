import type { ReactNode } from "react";

// Route-group layout (applies to every page under (auth)/) — see the note
// in (app)/layout.tsx for why this can't use the LayoutProps<'/path'> helper.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="bg-muted focus-visible:ring-ring flex min-h-svh flex-1 items-center justify-center px-4 py-12 focus-visible:ring-2 focus-visible:outline-none"
    >
      {children}
    </main>
  );
}
