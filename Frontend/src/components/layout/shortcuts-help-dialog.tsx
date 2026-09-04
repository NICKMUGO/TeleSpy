"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";

interface ShortcutsHelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SHORTCUTS: { keys: string[]; description: string }[] = [
  { keys: ["Ctrl", "K"], description: "Open the command palette" },
  { keys: ["Ctrl", "B"], description: "Toggle the sidebar" },
  { keys: ["Ctrl", ","], description: "Open display settings" },
  { keys: ["?"], description: "Open this shortcuts list" },
  { keys: ["Esc"], description: "Close any open dialog" },
];

export function ShortcutsHelpDialog({
  open,
  onOpenChange,
}: ShortcutsHelpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            On macOS, use Cmd instead of Ctrl.
          </DialogDescription>
        </DialogHeader>

        <ul className="flex flex-col gap-3">
          {SHORTCUTS.map((shortcut) => (
            <li
              key={shortcut.description}
              className="flex items-center justify-between gap-4 text-sm"
            >
              <span>{shortcut.description}</span>
              <span className="flex shrink-0 items-center gap-1">
                {shortcut.keys.map((key, index) => (
                  <span key={key} className="flex items-center gap-1">
                    <Kbd>{key}</Kbd>
                    {index < shortcut.keys.length - 1 ? (
                      <span
                        aria-hidden="true"
                        className="text-muted-foreground"
                      >
                        +
                      </span>
                    ) : null}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
