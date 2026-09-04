"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CommandPalette } from "@/components/layout/command-palette";
import { DisplaySettingsDialog } from "@/components/layout/display-settings-dialog";
import { PreferencesAnnouncer } from "@/components/layout/preferences-announcer";
import { ShortcutsHelpDialog } from "@/components/layout/shortcuts-help-dialog";
import { Topbar } from "@/components/layout/topbar";

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

export function AppShellChrome({ children }: { children: ReactNode }) {
  const [commandOpen, setCommandOpen] = useState(false);
  const [displaySettingsOpen, setDisplaySettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey;

      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
        return;
      }

      if (meta && event.key === ",") {
        event.preventDefault();
        setDisplaySettingsOpen(true);
        return;
      }

      if (event.key === "?" && !meta && !isTypingTarget(event.target)) {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <Topbar
        onOpenCommandPalette={() => setCommandOpen(true)}
        onOpenDisplaySettings={() => setDisplaySettingsOpen(true)}
        onOpenShortcutsHelp={() => setShortcutsOpen(true)}
      />
      <main
        id="main-content"
        tabIndex={-1}
        className="focus-visible:ring-ring flex flex-1 flex-col focus-visible:ring-2 focus-visible:outline-none"
      >
        {children}
      </main>

      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onOpenDisplaySettings={() => setDisplaySettingsOpen(true)}
        onOpenShortcutsHelp={() => setShortcutsOpen(true)}
      />
      <DisplaySettingsDialog
        open={displaySettingsOpen}
        onOpenChange={setDisplaySettingsOpen}
      />
      <ShortcutsHelpDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
      />
      <PreferencesAnnouncer />
    </>
  );
}
