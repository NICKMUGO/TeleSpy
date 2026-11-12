"use client";

import { apiRequest } from "@/lib/api/client";
import type { ApiEnvelope } from "@/lib/api/types";
import { isIos, isStandalone } from "@/lib/pwa";

/**
 * Push notifications for this browser/device (BackendDotNet
 * Services/Push.cs, shown by public/sw.js). The browser asks the person
 * itself (Allow/Block); turning them off here forgets this device on the
 * server. Covered by the Terms (clause 5), accepted at account setup.
 */
export type PushState =
  /** Notifications reach this device. */
  | "on"
  /** Can be turned on. */
  | "off"
  /** The person chose Block; only the browser's site settings can undo it. */
  | "blocked"
  /** iPhone/iPad: only works once TeleSpy is added to the Home Screen. */
  | "needs-install"
  /** This browser can't, the server has no push keys, or (development) no
   * service worker is running. */
  | "unavailable";

function supported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

let serverKey: Promise<string | null> | null = null;
function publicKey() {
  serverKey ??= apiRequest<
    ApiEnvelope<{ enabled: boolean; public_key: string | null }>
  >("/push/key")
    .then((r) => (r.data.enabled ? r.data.public_key : null))
    .catch(() => {
      serverKey = null;
      return null;
    });
  return serverKey;
}

/** The service worker, if one is running — it's only registered in
 * production builds (lib/pwa.ts). */
async function registration() {
  if (!supported()) return null;
  return (await navigator.serviceWorker.getRegistration("/")) ?? null;
}

function keyBytes(base64Url: string) {
  const base64 = (base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

export async function pushState(): Promise<PushState> {
  if (isIos() && !isStandalone()) return "needs-install";
  if (!supported()) return "unavailable";
  if (Notification.permission === "denied") return "blocked";
  const [reg, key] = await Promise.all([registration(), publicKey()]);
  if (!reg || !key) return "unavailable";
  const subscription = await reg.pushManager.getSubscription();
  return subscription && Notification.permission === "granted" ? "on" : "off";
}

/** Asks the browser, then registers this device. Must run from a click
 * (Safari only asks in response to one). */
export async function enablePush(): Promise<PushState> {
  const [reg, key] = await Promise.all([registration(), publicKey()]);
  if (!reg || !key) return "unavailable";
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "blocked";
  if (permission !== "granted") return "off";
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(key),
    }));
  const json = subscription.toJSON();
  await apiRequest("/push/subscribe", {
    method: "POST",
    body: { endpoint: json.endpoint, keys: json.keys },
  });
  return "on";
}

/** Stops notifications on this device (also on sign-out, so the next
 * person to use it doesn't get the last one's). */
export async function disablePush(): Promise<PushState> {
  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  if (subscription) {
    await apiRequest("/push/unsubscribe", {
      method: "POST",
      body: { endpoint: subscription.endpoint },
    }).catch(() => undefined);
    await subscription.unsubscribe().catch(() => undefined);
  }
  return "off";
}
