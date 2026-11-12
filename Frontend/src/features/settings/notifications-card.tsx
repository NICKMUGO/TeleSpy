"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SectionCard } from "@/components/data/section-card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { disablePush, enablePush, pushState, type PushState } from "@/lib/push";

const HELP: Record<Exclude<PushState, "on" | "off">, string> = {
  blocked:
    "Notifications are blocked for TeleSpy in this browser. Allow them in the browser's site settings (the icon next to the address), then come back here.",
  "needs-install":
    "On iPhone and iPad, add TeleSpy to your Home Screen first (Share → Add to Home Screen), then turn notifications on from the app.",
  unavailable:
    "Notifications aren't available here — this browser doesn't support them, or they aren't set up on the server yet.",
};

/** Settings → Notifications: on/off for this browser or device. */
export function NotificationsCard() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void pushState().then(setState);
  }, []);

  async function toggle(on: boolean) {
    setBusy(true);
    try {
      const next = on ? await enablePush() : await disablePush();
      setState(next);
      if (on && next === "on")
        toast.success("Notifications are on for this device.");
      if (!on) toast.success("Notifications are off for this device.");
    } catch {
      toast.error("Couldn't change notifications. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      title="Notifications on this device"
      description="A new ticket for you or your team, and new messages on tickets you're on — only when TeleSpy isn't open in front of you."
    >
      {state === null ? null : state === "on" || state === "off" ? (
        <div className="flex items-center gap-3">
          <Switch
            id="push-toggle"
            checked={state === "on"}
            disabled={busy}
            onCheckedChange={(checked) => void toggle(checked)}
          />
          <Label htmlFor="push-toggle" className="font-normal">
            {state === "on" ? "On" : "Off"}
          </Label>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{HELP[state]}</p>
      )}
    </SectionCard>
  );
}
