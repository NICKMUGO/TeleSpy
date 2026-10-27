"use client";

import { Search } from "lucide-react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { UserMenu } from "@/components/layout/user-menu";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

interface TopbarProps {
  onOpenCommandPalette: () => void;
  onOpenDisplaySettings: () => void;
  onOpenShortcutsHelp: () => void;
  onOpenTutorial: () => void;
}

export function Topbar({
  onOpenCommandPalette,
  onOpenDisplaySettings,
  onOpenShortcutsHelp,
  onOpenTutorial,
}: TopbarProps) {
  return (
    // Pinned and frosted, like an iOS navigation bar: content scrolls
    // under it and shows through as a soft blur.
    <header className="border-border-subtle bg-background/70 sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b px-3 backdrop-blur-xl backdrop-saturate-150 sm:gap-3 sm:px-4">
      {/* Phones use the tab bar's "More" instead. */}
      <SidebarTrigger className="max-md:hidden" />
      <Separator
        orientation="vertical"
        className="h-5 data-vertical:self-center max-md:hidden"
      />
      <div className="min-w-0 flex-1">
        <Breadcrumbs />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenCommandPalette}
          className="text-muted-foreground hidden gap-2 sm:flex"
        >
          <Search aria-hidden="true" className="size-4" />
          <span>Search</span>
          <span className="flex gap-0.5">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onOpenCommandPalette}
          className="sm:hidden"
          aria-label="Search people, extensions and pages"
        >
          <Search aria-hidden="true" />
        </Button>

        <UserMenu
          onOpenDisplaySettings={onOpenDisplaySettings}
          onOpenShortcutsHelp={onOpenShortcutsHelp}
          onOpenTutorial={onOpenTutorial}
        />
      </div>
    </header>
  );
}
