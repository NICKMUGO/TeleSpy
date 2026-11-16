"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { enablePush, pushState } from "@/lib/push";

const ASKED_KEY = "telespy-push-asked";

/**
 * Asks once per device, with the browser's own question ("Allow / Block",
 * or "Allow / Don't Allow" on iPhone) — no banner of ours. Browsers only
 * show it in response to a tap or click, so it waits for the first one
 * anywhere in the app. Never asks again after that, whatever the answer;
 * Settings → Notifications turns them on or off later.
 */
export function NotificationsPrompt() {
  useEffect(() => {
    let asked = false;
    try {
      asked = localStorage.getItem(ASKED_KEY) === "1";
    } catch {
      // Storage blocked: ask anyway.
    }
    if (asked) return;

    let armed = false;
    const ask = () => {
      document.removeEventListener("click", ask, true);
      try {
        localStorage.setItem(ASKED_KEY, "1");
      } catch {
        // Fine: it may ask again next time.
      }
      // Called straight from the click, so the browser shows its question.
      enablePush()
        .then((state) => {
          if (state === "on") toast.success("Notifications are on.");
        })
        .catch((error: unknown) => {
          toast.error(
            error instanceof Error
              ? `Couldn't turn notifications on: ${error.message}`
              : "Couldn't turn notifications on. Try again from Settings.",
          );
        });
    };

    void pushState().then((state) => {
      if (
        state === "off" &&
        "Notification" in window &&
        Notification.permission === "default"
      ) {
        armed = true;
        document.addEventListener("click", ask, true);
      }
    });
    return () => {
      if (armed) document.removeEventListener("click", ask, true);
    };
  }, []);

  return null;
}
