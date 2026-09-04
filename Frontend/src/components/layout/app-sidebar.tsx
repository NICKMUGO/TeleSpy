"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { NAV_SECTIONS, isNavItemVisible } from "@/components/layout/nav-items";
import { mockCurrentUser } from "@/lib/auth/mock-user";

function isItemActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      {/* The whole sidebar surface (brand + nav items) is one landmark —
       * everything visible here needs to be inside some landmark, and the
       * brand link isn't meaningfully separate from the navigation below it. */}
      <nav aria-label="Primary" className="flex h-full flex-col">
        <SidebarHeader>
          <Link
            href="/dashboard"
            className="focus-visible:ring-sidebar-ring flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold tracking-tight outline-none focus-visible:ring-2"
          >
            <span
              aria-hidden="true"
              className="bg-sidebar-primary text-sidebar-primary-foreground flex size-6 shrink-0 items-center justify-center rounded-sm text-xs font-bold"
            >
              T
            </span>
            <span className="truncate group-data-[collapsible=icon]:hidden">
              TeleSpy
            </span>
          </Link>
        </SidebarHeader>

        <SidebarContent>
          {NAV_SECTIONS.map((section, index) => {
            const visibleItems = section.items.filter((item) =>
              isNavItemVisible(item, mockCurrentUser.role),
            );
            if (visibleItems.length === 0) return null;

            return (
              <SidebarGroup key={section.title ?? `section-${index}`}>
                {section.title ? (
                  <SidebarGroupLabel>{section.title}</SidebarGroupLabel>
                ) : null}
                <SidebarGroupContent>
                  <SidebarMenu>
                    {visibleItems.map((item) => {
                      const active = isItemActive(pathname, item.href);
                      return (
                        <SidebarMenuItem key={item.href}>
                          <SidebarMenuButton
                            asChild
                            isActive={active}
                            tooltip={item.title}
                          >
                            <Link href={item.href}>
                              <item.icon aria-hidden="true" />
                              <span>{item.title}</span>
                            </Link>
                          </SidebarMenuButton>
                          {active ? (
                            <span
                              aria-hidden="true"
                              className="bg-sidebar-primary pointer-events-none absolute inset-x-2 -bottom-0.5 h-0.5 rounded-full"
                            />
                          ) : null}
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            );
          })}
        </SidebarContent>
      </nav>
      <SidebarRail />
    </Sidebar>
  );
}
