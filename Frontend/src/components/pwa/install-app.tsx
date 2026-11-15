"use client";

import { useEffect } from "react";
import { Download, EllipsisVertical, Share, SquarePlus } from "lucide-react";
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

/** Which steps the install help shows. */
export type InstallHelpPlatform = "ios" | "android";

/** Mounted once in the root layout: registers the service worker. */
export function ServiceWorkerRegistrar() {
  useEffect(() => registerServiceWorker(), []);
  return null;
}

/** "Install TeleSpy" in the account menu, shown only where it can work:
 * Chrome/Edge (laptop or Android) open their install dialog. Where the
 * browser won't give us that dialog — always on iPhone and iPad, sometimes
 * on Android — it asks for the manual steps (<InstallHelpDialog>, kept
 * outside the menu so it outlives it). Hidden once installed. */
export function InstallAppMenuItem({
  onShowHelp,
}: {
  onShowHelp: (platform: InstallHelpPlatform) => void;
}) {
  const mode = useInstallMode();
  if (mode === "installed" || mode === "unavailable") return null;

  async function install() {
    if (mode === "ios" || mode === "android") {
      onShowHelp(mode);
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

/** The browser can't install from a button here, so: the steps by hand. */
export function InstallHelpDialog({
  platform,
  onOpenChange,
}: {
  /** null = closed. */
  platform: InstallHelpPlatform | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={platform !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add TeleSpy to your Home Screen</DialogTitle>
          <DialogDescription>
            It gets its own icon and opens full screen, like any other app.
          </DialogDescription>
        </DialogHeader>
        {platform === "android" ? (
          <ol className="flex flex-col gap-3 text-sm">
            <li className="flex items-start gap-3">
              <EllipsisVertical
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0"
              />
              <span>
                In Chrome, tap the <strong>menu</strong> (the three dots, top
                right). In Samsung Internet it&apos;s the three lines at the
                bottom.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <SquarePlus
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0"
              />
              <span>
                Tap <strong>Install app</strong> or{" "}
                <strong>Add to Home screen</strong>, then{" "}
                <strong>Install</strong>.
              </span>
            </li>
            <li className="text-muted-foreground text-xs">
              Opened TeleSpy from a link in WhatsApp, Gmail or another app? Open
              it in Chrome first; in-app browsers can&apos;t install apps.
            </li>
          </ol>
        ) : (
          <ol className="flex flex-col gap-3 text-sm">
            <li className="flex items-start gap-3">
              <Share aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                In Safari, tap <strong>Share</strong> (the square with an arrow,
                at the bottom of the screen).
              </span>
            </li>
            <li className="flex items-start gap-3">
              <SquarePlus
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0"
              />
              <span>
                Scroll down and tap <strong>Add to Home Screen</strong>, then{" "}
                <strong>Add</strong>.
              </span>
            </li>
          </ol>
        )}
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
