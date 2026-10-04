import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { AuthGuard } from "@/components/auth/auth-guard";
import { AppShellChrome } from "@/components/layout/app-shell-chrome";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

// Route-group layout (applies to every page under (app)/), not a single leaf
// route, so it can't use the LayoutProps<'/path'> codegen helper — that only
// covers layouts tied to one specific path.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <AuthGuard>
      <SidebarProvider defaultOpen={sidebarOpen}>
        <AppSidebar />
        <SidebarInset>
          <AppShellChrome>{children}</AppShellChrome>
        </SidebarInset>
      </SidebarProvider>
    </AuthGuard>
  );
}
