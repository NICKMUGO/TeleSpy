"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { enablePush, pushState } from "@/lib/push";

const DISMISSED_KEY = "telespy-push-prompt-dismissed";

/** A one-line offer to turn notifications on, shown in the app until the
 * person answers it. Asking the browser needs a click (Safari won't ask
 * otherwise), hence a button rather than asking on page load. */
export function NotificationsPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      // Storage blocked: just offer it.
    }
    if (dismissed) return;
    void pushState().then((state) => {
      if (
        state === "off" &&
        "Notification" in window &&
        Notification.permission === "default"
      ) {
        setShow(true);
      }
    });
  }, []);

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Fine: it'll offer again next time.
    }
  }

  if (!show) return null;
  return (
    <div className="border-border-subtle bg-muted/50 flex items-center gap-3 border-b px-4 py-2 text-sm sm:px-6">
      <Bell
        aria-hidden="true"
        className="text-muted-foreground size-4 shrink-0"
      />
      <p className="min-w-0 flex-1">
        Get notified about new tickets and messages when TeleSpy isn&apos;t
        open.
      </p>
      <Button
        size="sm"
        onClick={() => {
          void enablePush().finally(dismiss);
        }}
      >
        Turn on
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-8"
        aria-label="Not now"
        onClick={dismiss}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}
