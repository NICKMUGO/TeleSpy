"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Headset,
  Inbox,
  House,
  MoreHorizontal,
  Settings,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { useTicketAccess } from "@/lib/api/hooks";
import { useSession } from "@/lib/auth/session-store";
import { cn } from "@/lib/utils";

interface Tab {
  title: string;
  href: string;
  icon: LucideIcon;
}

/** Phones only: an iOS-style tab bar along the bottom with the pages each
 * role uses most. "More" opens the full menu (the sidebar's phone sheet),
 * so every page stays reachable. */
export function MobileTabBar() {
  const pathname = usePathname();
  const role = useSession((state) => state.user?.role) ?? "Employee";
  const access = useTicketAccess().data?.data;
  const { setOpenMobile } = useSidebar();

  // A team that's sent tickets lands on its queue; everyone else on the
  // tickets they raised (anyone can raise one). The other page stays under
  // More.
  // Always there, even before access has loaded, so the tab never goes
  // missing.
  const tickets: Tab =
    access?.handles_tickets && !access.on_desk
      ? { title: "Tickets", href: "/tickets/team", icon: Inbox }
      : { title: "Tickets", href: "/tickets", icon: Headset };

  const tabs: Tab[] =
    role === "Admin" || role === "Manager"
      ? [
          { title: "Home", href: "/dashboard", icon: House },
          // SIMs is under More.
          tickets,
          { title: "Staff", href: "/employees", icon: Users },
          {
            title: "Alerts",
            href: "/analytics/anomalies",
            icon: TriangleAlert,
          },
        ]
      : [
          { title: "Home", href: "/dashboard", icon: House },
          tickets,
          { title: "Settings", href: "/settings", icon: Settings },
        ];

  const active = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      aria-label="Tabs"
      data-tab-bar
      className="border-border-subtle bg-background/80 fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 md:hidden"
    >
      <ul
        className="grid"
        style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, 1fr)` }}
      >
        {tabs.map((tab) => {
          const on = active(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium transition-[color,scale] duration-200 active:scale-95",
                  on ? "text-primary" : "text-muted-foreground",
                )}
              >
                <tab.icon
                  aria-hidden="true"
                  className="size-6"
                  style={{ strokeWidth: on ? 2.25 : 1.75 }}
                />
                {tab.title}
              </Link>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => setOpenMobile(true)}
            className="text-muted-foreground flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium transition-[scale] duration-200 active:scale-95"
          >
            <MoreHorizontal aria-hidden="true" className="size-6" />
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}
