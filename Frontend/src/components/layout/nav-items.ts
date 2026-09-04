import {
  Activity,
  Building2,
  FingerprintPattern,
  LayoutDashboard,
  Lock,
  Settings,
  Smartphone,
  TrendingUp,
  TriangleAlert,
  Upload,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/auth/mock-user";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Undefined = visible to every role. UI convenience only — see mock-user.ts. */
  roles?: Role[];
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    items: [{ title: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    title: "SIM management",
    items: [
      { title: "SIM inventory", href: "/sims", icon: Smartphone },
      { title: "Employees", href: "/employees", icon: Users },
      { title: "Departments", href: "/departments", icon: Building2 },
    ],
  },
  {
    title: "Usage",
    items: [
      { title: "Usage events", href: "/usage", icon: Activity },
      {
        title: "CDR upload",
        href: "/ingestion",
        icon: Upload,
        roles: ["SuperAdmin", "Admin"],
      },
    ],
  },
  {
    title: "Analytics",
    items: [
      { title: "Anomalies", href: "/analytics/anomalies", icon: TriangleAlert },
      { title: "Forecasts", href: "/analytics/forecasts", icon: TrendingUp },
      {
        title: "Usage profiles",
        href: "/analytics/profiles",
        icon: FingerprintPattern,
      },
    ],
  },
  {
    items: [
      { title: "Budgets", href: "/budgets", icon: Wallet },
      {
        title: "Audit log",
        href: "/audit",
        icon: Lock,
        roles: ["SuperAdmin", "Auditor"],
      },
      { title: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap(
  (section) => section.items,
);

export function isNavItemVisible(item: NavItem, role: Role): boolean {
  return !item.roles || item.roles.includes(role);
}
