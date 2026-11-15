"use client";

import { useEffect, type ReactNode } from "react";
import {
  Download,
  EllipsisVertical,
  MonitorDown,
  Share,
  SquarePlus,
  type LucideIcon,
} from "lucide-react";
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
export type InstallHelpPlatform =
  "ios" | "android" | "mac-safari" | "desktop" | "unsupported";

/** Mounted once in the root layout: registers the service worker. */
export function ServiceWorkerRegistrar() {
  useEffect(() => registerServiceWorker(), []);
  return null;
}

/** "Install TeleSpy" in the account menu, on every device until it's
 * installed. Chrome/Edge (laptop or Android) open their install dialog.
 * Where the browser won't give us that dialog — iPhone, iPad, Safari on a
 * Mac, sometimes Android or a laptop — it shows the steps by hand
 * (<InstallHelpDialog>, kept outside the menu so it outlives it). */
export function InstallAppMenuItem({
  onShowHelp,
}: {
  onShowHelp: (platform: InstallHelpPlatform) => void;
}) {
  const mode = useInstallMode();
  if (mode === "installed" || mode === "unavailable") return null;
  const help = mode === "prompt" ? null : mode;

  async function install() {
    if (help) {
      onShowHelp(help);
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

const HELP_TITLES: Record<InstallHelpPlatform, string> = {
  ios: "Add TeleSpy to your Home Screen",
  android: "Add TeleSpy to your Home Screen",
  "mac-safari": "Add TeleSpy to your Dock",
  desktop: "Install TeleSpy on this computer",
  unsupported: "Install TeleSpy on this computer",
};

function Step({
  icon: Icon,
  children,
}: {
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      {Icon ? (
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      ) : (
        <span aria-hidden="true" className="size-4 shrink-0" />
      )}
      <span>{children}</span>
    </li>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <li className="text-muted-foreground text-xs">{children}</li>;
}

/** The steps for each device. */
function HelpSteps({ platform }: { platform: InstallHelpPlatform }) {
  switch (platform) {
    case "android":
      return (
        <>
          <Step icon={EllipsisVertical}>
            In Chrome, tap the <strong>menu</strong> (the three dots, top
            right). In Samsung Internet it&apos;s the three lines at the bottom;
            in Firefox, the three dots.
          </Step>
          <Step icon={SquarePlus}>
            Tap <strong>Install app</strong> or{" "}
            <strong>Add to Home screen</strong>, then <strong>Install</strong>.
          </Step>
          <Note>
            Opened TeleSpy from a link in WhatsApp, Gmail or another app? Open
            it in Chrome first; in-app browsers can&apos;t install apps.
          </Note>
        </>
      );
    case "ios":
      return (
        <>
          <Step icon={Share}>
            Tap <strong>Share</strong> (the square with an arrow). In Safari
            it&apos;s at the bottom of the screen; in Chrome and Edge, in the
            address bar.
          </Step>
          <Step icon={SquarePlus}>
            Scroll down and tap <strong>Add to Home Screen</strong>, then{" "}
            <strong>Add</strong>.
          </Step>
          <Note>
            Opened TeleSpy from a link in WhatsApp, Gmail or another app? Open
            it in Safari first; in-app browsers can&apos;t add it.
          </Note>
        </>
      );
    case "mac-safari":
      return (
        <>
          <Step icon={Share}>
            In the menu bar, choose <strong>File</strong> →{" "}
            <strong>Add to Dock</strong> (or click <strong>Share</strong> in the
            toolbar, then <strong>Add to Dock</strong>).
          </Step>
          <Step icon={SquarePlus}>
            Click <strong>Add</strong>. TeleSpy opens from the Dock and
            Launchpad in its own window.
          </Step>
          <Note>
            Needs macOS Sonoma (14) or later. On an older Mac, open TeleSpy in
            Chrome or Edge and install it from there.
          </Note>
        </>
      );
    case "desktop":
      return (
        <>
          <Step icon={MonitorDown}>
            In Chrome, click the <strong>install</strong> icon at the right of
            the address bar, or open the <strong>menu</strong> (three dots) →{" "}
            <strong>Cast, save and share</strong> →{" "}
            <strong>Install page as app</strong>.
          </Step>
          <Step icon={EllipsisVertical}>
            In Edge, open the <strong>menu</strong> (three dots) →{" "}
            <strong>Apps</strong> → <strong>Install this site as an app</strong>
            .
          </Step>
          <Note>
            It then opens from the Start menu, taskbar, Dock or Launchpad in its
            own window.
          </Note>
        </>
      );
    case "unsupported":
      return (
        <>
          <Step icon={MonitorDown}>
            Firefox can&apos;t install web apps. Open TeleSpy in{" "}
            <strong>Chrome</strong> or <strong>Edge</strong> (or{" "}
            <strong>Safari</strong> on a Mac), then choose{" "}
            <strong>Install TeleSpy app</strong> from your account menu there.
          </Step>
        </>
      );
  }
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
          <DialogTitle>
            {platform ? HELP_TITLES[platform] : "Install TeleSpy"}
          </DialogTitle>
          <DialogDescription>
            It gets its own icon and opens in its own window, like any other
            app.
          </DialogDescription>
        </DialogHeader>
        {platform ? (
          <ol className="flex flex-col gap-3 text-sm">
            <HelpSteps platform={platform} />
          </ol>
        ) : null}
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
