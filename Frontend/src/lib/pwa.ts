"use client";

import { useSyncExternalStore } from "react";

/**
 * Installing TeleSpy as an app (PWA). Chrome and Edge, on laptops and
 * Android, fire `beforeinstallprompt` once a page qualifies (manifest +
 * service worker); holding on to that event lets our own "Install app"
 * button open the browser's install dialog later. Safari never fires it —
 * on iPhone and iPad it's Share → Add to Home Screen, so we explain that
 * instead. Firefox on desktop can't install web apps at all.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's own flag for a home-screen app.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Android, where Chrome may hold back its install event (after a dismissed
 * prompt, before enough use, or in Samsung Internet and in-app browsers) —
 * but its own menu can still install the app. */
export function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

export function isIos() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac, but Macs have no touch screen.
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

// Listen from the moment this module loads: the event fires once, early,
// and is gone if nobody catches it.
if (typeof window !== "undefined") {
  installed = isStandalone();
  window.addEventListener("beforeinstallprompt", (event) => {
    // Stops Chrome's own mini-infobar; our button offers it instead.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installed = true;
    notify();
  });
}

export type InstallMode =
  /** Already running as the installed app. */
  | "installed"
  /** We can open the browser's install dialog. */
  | "prompt"
  /** iPhone/iPad: show how to Add to Home Screen. */
  | "ios"
  /** Android without the install event: show how to install from the
   * browser's own menu. */
  | "android"
  /** This browser can't install, or hasn't offered it yet. */
  | "unavailable";

function snapshot(): InstallMode {
  if (installed) return "installed";
  if (deferredPrompt) return "prompt";
  if (isIos()) return "ios";
  if (isAndroid()) return "android";
  return "unavailable";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInstallMode(): InstallMode {
  return useSyncExternalStore(subscribe, snapshot, () => "unavailable");
}

/** Opens the browser's install dialog. True if the person installed it. */
export async function promptInstall() {
  const event = deferredPrompt;
  if (!event) return false;
  // The event can only be used once.
  deferredPrompt = null;
  notify();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === "accepted";
}

/** Registers public/sw.js. Production only: in development it would cache
 * build files that hot reload keeps replacing. */
export function registerServiceWorker() {
  if (process.env.NODE_ENV !== "production") return;
  if (!("serviceWorker" in navigator)) return;
  const register = () =>
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((error) => console.warn("Service worker not registered", error));
  // After load, so it never competes with the first paint.
  if (document.readyState === "complete") void register();
  else window.addEventListener("load", () => void register(), { once: true });
}
