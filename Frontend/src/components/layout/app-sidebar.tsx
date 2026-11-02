"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gauge, Headset, Inbox } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-lockup";
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
import {
  NAV_SECTIONS,
  isNavItemVisible,
  type NavSection,
} from "@/components/layout/nav-items";
import { useTicketAccess } from "@/lib/api/hooks";
import { useSession } from "@/lib/auth/session-store";

function matches(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Active unless a more specific link also matches — /tickets/team is
 * Team tickets, not Ticket desk too. */
function isItemActive(pathname: string, href: string, allHrefs: string[]) {
  return (
    matches(pathname, href) &&
    !allHrefs.some(
      (other) => other.length > href.length && matches(pathname, other),
    )
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const role = useSession((state) => state.user?.role) ?? "Employee";
  const ticketAccess = useTicketAccess().data?.data;

  // Tickets depend on the department, not the role, so this section is
  // built from GET /tickets/me rather than NAV_SECTIONS. Anyone can raise
  // a ticket; the desk's page is its ticket desk, everyone else's is
  // "My tickets". The SLA report is the whole organisation's, for everyone.
  const ticketItems = [
    ...(ticketAccess
      ? [
          {
            title:
              ticketAccess.on_desk || ticketAccess.is_admin
                ? "Ticket desk"
                : "My tickets",
            href: "/tickets",
            icon: Headset,
          },
        ]
      : []),
    ...(ticketAccess?.handles_tickets
      ? [{ title: "Team tickets", href: "/tickets/team", icon: Inbox }]
      : []),
    ...(ticketAccess
      ? [{ title: "SLA report", href: "/tickets/sla", icon: Gauge }]
      : []),
  ];
  const sections: NavSection[] =
    ticketItems.length > 0
      ? [
          NAV_SECTIONS[0],
          { title: "Tickets", items: ticketItems },
          ...NAV_SECTIONS.slice(1),
        ]
      : NAV_SECTIONS;
  const allHrefs = sections.flatMap((section) =>
    section.items.map((item) => item.href),
  );

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
            <BrandMark className="size-6 rounded-sm" />
            <span className="truncate group-data-[collapsible=icon]:hidden">
              TeleSpy
            </span>
          </Link>
        </SidebarHeader>

        <SidebarContent>
          {sections.map((section, index) => {
            const visibleItems = section.items.filter((item) =>
              isNavItemVisible(item, role),
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
                      const active = isItemActive(
                        pathname,
                        item.href,
                        allHrefs,
                      );
                      return (
                        <SidebarMenuItem key={item.href}>
                          <SidebarMenuButton
                            asChild
                            isActive={active}
                            tooltip={item.title}
                          >
                            <Link href={item.href} data-tour-nav={item.href}>
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
