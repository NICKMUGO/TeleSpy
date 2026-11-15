"use client";

import { useSyncExternalStore } from "react";

/**
 * Installing TeleSpy as an app (PWA). Chrome and Edge, on laptops and
 * Android, fire `beforeinstallprompt` once a page qualifies (manifest +
 * service worker); holding on to that event lets our own "Install app"
 * button open the browser's install dialog later. Everywhere else we show
 * the steps by hand: on iPhone and iPad it's Share → Add to Home Screen (in
 * Safari, and in Chrome or Edge since iOS 16.4); on a Mac in Safari it's
 * File → Add to Dock (macOS Sonoma or later). Firefox on desktop can't
 * install web apps, so we point to a browser that can.
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

/** Firefox on a laptop or desktop: it has no way to install web apps. */
export function isDesktopFirefox() {
  return /Firefox\//.test(navigator.userAgent) && !isAndroid() && !isIos();
}

/** Safari on a Mac (not Chrome, Edge, Firefox or Opera, which also say
 * "Safari" in their user agent, and not an iPad posing as a Mac). */
export function isMacSafari() {
  const ua = navigator.userAgent;
  return (
    ua.includes("Macintosh") &&
    !isIos() &&
    /Safari\//.test(ua) &&
    !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS|OPR/.test(ua)
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
  /** Safari on a Mac: show how to Add to Dock. */
  | "mac-safari"
  /** Chrome or Edge on a laptop that hasn't offered its install dialog (it
   * was dismissed before, say): show where its own install option is. */
  | "desktop"
  /** Firefox on a laptop: it can't install, so suggest another browser. */
  | "unsupported"
  /** Not known yet (rendering on the server). */
  | "unavailable";

function snapshot(): InstallMode {
  if (installed) return "installed";
  if (deferredPrompt) return "prompt";
  if (isIos()) return "ios";
  if (isAndroid()) return "android";
  if (isMacSafari()) return "mac-safari";
  if (isDesktopFirefox()) return "unsupported";
  return "desktop";
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
