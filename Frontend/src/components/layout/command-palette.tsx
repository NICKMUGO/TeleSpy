"use client";

import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  GraduationCap,
  Keyboard,
  Laptop,
  Moon,
  Settings,
  Sun,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { ALL_NAV_ITEMS, isNavItemVisible } from "@/components/layout/nav-items";
import { useSession } from "@/lib/auth/session-store";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenDisplaySettings: () => void;
  onOpenShortcutsHelp: () => void;
  onOpenTutorial: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  onOpenDisplaySettings,
  onOpenShortcutsHelp,
  onOpenTutorial,
}: CommandPaletteProps) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const role = useSession((state) => state.user?.role) ?? "Employee";

  function runAndClose(action: () => void) {
    action();
    onOpenChange(false);
  }

  const navItems = ALL_NAV_ITEMS.filter((item) => isNavItemVisible(item, role));

  const themeOptions: {
    label: string;
    icon: LucideIcon;
    value: "light" | "dark" | "system";
  }[] = [
    { label: "Switch to light theme", icon: Sun, value: "light" },
    { label: "Switch to dark theme", icon: Moon, value: "dark" },
    { label: "Match system theme", icon: Laptop, value: "system" },
  ];

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Jump to a page or run a quick action"
    >
      <CommandInput placeholder="Jump to a page or run a command..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigate">
          {navItems.map((item) => (
            <CommandItem
              key={item.href}
              value={item.title}
              onSelect={() => runAndClose(() => router.push(item.href))}
            >
              <item.icon aria-hidden="true" />
              <span>{item.title}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Quick actions">
          <CommandItem
            value="Upload CDR file"
            onSelect={() => runAndClose(() => router.push("/ingestion"))}
          >
            <Upload aria-hidden="true" />
            <span>Upload CDR file</span>
          </CommandItem>
          <CommandItem
            value="Jump to employee"
            onSelect={() => runAndClose(() => router.push("/employees"))}
          >
            <Users aria-hidden="true" />
            <span>Jump to employee</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Theme">
          {themeOptions.map((option) => (
            <CommandItem
              key={option.value}
              value={option.label}
              onSelect={() => runAndClose(() => setTheme(option.value))}
            >
              <option.icon aria-hidden="true" />
              <span>{option.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Help">
          <CommandItem
            value="Open display settings"
            onSelect={() => runAndClose(onOpenDisplaySettings)}
          >
            <Settings aria-hidden="true" />
            <span>Display settings</span>
          </CommandItem>
          <CommandItem
            value="Open keyboard shortcuts"
            onSelect={() => runAndClose(onOpenShortcutsHelp)}
          >
            <Keyboard aria-hidden="true" />
            <span>Keyboard shortcuts</span>
          </CommandItem>
          <CommandItem
            value="Open guided tour"
            onSelect={() => runAndClose(onOpenTutorial)}
          >
            <GraduationCap aria-hidden="true" />
            <span>Open guided tour</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
