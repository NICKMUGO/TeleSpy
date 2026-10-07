"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  GraduationCap,
  Keyboard,
  Laptop,
  Moon,
  Phone,
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
  CommandShortcut,
} from "@/components/ui/command";
import { toast } from "sonner";
import { useDirectory } from "@/lib/api/hooks";
import { ALL_NAV_ITEMS, isNavItemVisible } from "@/components/layout/nav-items";
import { useSession } from "@/lib/auth/session-store";

// How many directory matches to list at once — the search narrows as you
// type, so a short list is enough.
const MAX_DIRECTORY_RESULTS = 8;

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
  const [search, setSearch] = useState("");
  const directory = useDirectory(open);

  // People whose name or extension contains what's typed. Extensions that
  // start with it come first, so typing "23" leads with 230-239.
  const query = search.trim().toLowerCase();
  const people = useMemo(() => {
    if (!query) return [];
    return (directory.data?.data ?? [])
      .filter(
        (person) =>
          person.extension_code.includes(query) ||
          person.full_name.toLowerCase().includes(query),
      )
      .sort(
        (a, b) =>
          Number(b.extension_code.startsWith(query)) -
          Number(a.extension_code.startsWith(query)),
      )
      .slice(0, MAX_DIRECTORY_RESULTS);
  }, [query, directory.data]);

  function handleOpenChange(next: boolean) {
    if (!next) setSearch("");
    onOpenChange(next);
  }

  async function copyExtension(name: string, extension: string) {
    try {
      await navigator.clipboard.writeText(extension);
      toast.success(`${name} is on extension ${extension} — copied.`);
    } catch {
      // Clipboard blocked (permissions, insecure origin) — still answer
      // the lookup.
      toast.success(`${name} is on extension ${extension}.`);
    }
  }

  function runAndClose(action: () => void) {
    action();
    handleOpenChange(false);
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
      onOpenChange={handleOpenChange}
      title="Search"
      description="Look up a person or extension, jump to a page, or run a quick action"
    >
      <CommandInput
        placeholder="Search a name or extension, or jump to a page..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>
          {query && directory.isLoading
            ? "Searching the directory…"
            : "No person, extension or page matches."}
        </CommandEmpty>

        {people.length > 0 ? (
          <>
            <CommandGroup heading="People and extensions">
              {people.map((person) => (
                <CommandItem
                  key={person.id}
                  // Name and extension both, so the list's own matching
                  // keeps the row whichever one was typed.
                  value={`${person.full_name} ${person.extension_code}`}
                  onSelect={() =>
                    runAndClose(() =>
                      copyExtension(person.full_name, person.extension_code),
                    )
                  }
                >
                  <Phone aria-hidden="true" />
                  <span>{person.full_name}</span>
                  {person.department ? (
                    <span className="text-muted-foreground">
                      {person.department}
                    </span>
                  ) : null}
                  <CommandShortcut className="font-mono text-sm tracking-normal">
                    <span className="sr-only">extension </span>
                    {person.extension_code}
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        ) : null}

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
