"use client";

import { useEffect } from "react";
import { Download, Share, SquarePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  promptInstall,
  registerServiceWorker,
  useInstallMode,
} from "@/lib/pwa";

/** Mounted once in the root layout: registers the service worker. */
export function ServiceWorkerRegistrar() {
  useEffect(() => registerServiceWorker(), []);
  return null;
}

/** "Install TeleSpy" in the account menu, shown only where it can work:
 * Chrome/Edge (laptop or Android) open their install dialog; on iPhone and
 * iPad it asks for the Add to Home Screen steps (<IosInstallDialog>, kept
 * outside the menu so it outlives it). Hidden once installed. */
export function InstallAppMenuItem({
  onShowIosHelp,
}: {
  onShowIosHelp: () => void;
}) {
  const mode = useInstallMode();
  if (mode === "installed" || mode === "unavailable") return null;

  async function install() {
    if (mode === "ios") {
      onShowIosHelp();
      return;
    }
    if (await promptInstall()) {
      toast.success("TeleSpy is installed. Open it from its icon any time.");
    }
  }

  return (
    <DropdownMenuItem onSelect={() => void install()}>
      <Download aria-hidden="true" />
      <span>Install TeleSpy app</span>
    </DropdownMenuItem>
  );
}

/** Safari can't install from a button, so: how to Add to Home Screen. */
export function IosInstallDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add TeleSpy to your Home Screen</DialogTitle>
          <DialogDescription>
            It gets its own icon and opens full screen, like any other app.
          </DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col gap-3 text-sm">
          <li className="flex items-start gap-3">
            <Share aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              In Safari, tap <strong>Share</strong> (the square with an arrow,
              at the bottom of the screen).
            </span>
          </li>
          <li className="flex items-start gap-3">
            <SquarePlus aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              Scroll down and tap <strong>Add to Home Screen</strong>, then{" "}
              <strong>Add</strong>.
            </span>
          </li>
        </ol>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
