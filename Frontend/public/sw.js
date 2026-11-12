// TeleSpy's service worker: the part of the installable app (PWA) that the
// browser keeps running in the background for this site.
//
// It only speeds up opening and handles being offline:
// - Next.js build files (/_next/static/…) never change once built (their
//   names carry a hash), so they're kept on the device and served from it,
//   which is what makes the installed app open fast.
// - Pages always come from the network, so nobody sees stale data; with
//   no connection, the offline page shows instead of the browser's error.
// - API calls (/api/…, or another origin) and anything else pass straight
//   through: no customer or billing data is ever stored here.
//
// It also shows push notifications (BackendDotNet Services/Push.cs) — a new
// ticket for you or your team, or a new message on a ticket you're on — but
// only when no TeleSpy tab is in front of you: if you're on the app, you
// already see it there. Tapping one opens that ticket.
//
// Bump VERSION to throw every cached file away on the next visit.
const VERSION = "v3";
const STATIC_CACHE = `telespy-static-${VERSION}`;
const OFFLINE_CACHE = `telespy-offline-${VERSION}`;
const OFFLINE_URL = "/offline.html";
// What the offline page needs, saved at install so it can show without a
// connection.
const OFFLINE_FILES = [OFFLINE_URL, "/icons/icon-192.png"];
// Each deploy adds new build files; keep the cache from growing forever.
const MAX_STATIC_ENTRIES = 300;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((cache) => cache.addAll(OFFLINE_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== OFFLINE_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function trimStaticCache(cache) {
  const keys = await cache.keys();
  // Cache keys come back oldest first.
  await Promise.all(
    keys
      .slice(0, Math.max(0, keys.length - MAX_STATIC_ENTRIES))
      .map((key) => cache.delete(key)),
  );
}

async function staticFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    void trimStaticCache(cache);
  }
  return response;
}

/** Fresh from the network, or the saved copy when there's no connection. */
async function networkThenCache(request) {
  try {
    return await fetch(request);
  } catch {
    return (await caches.match(request)) ?? Response.error();
  }
}

async function pageOrOffline(request) {
  try {
    return await fetch(request);
  } catch {
    const offline = await caches.match(OFFLINE_URL);
    return offline ?? Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(pageOrOffline(request));
  } else if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(staticFirst(request));
  } else if (OFFLINE_FILES.includes(url.pathname)) {
    event.respondWith(networkThenCache(request));
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    return;
  }
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        // On the app right now: it shows the change itself.
        const onApp = windows.some(
          (w) => w.visibilityState === "visible" && w.focused,
        );
        if (onApp) return undefined;
        return self.registration.showNotification(data.title || "TeleSpy", {
          body: data.body || "",
          tag: data.tag,
          renotify: !!data.tag,
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
          data: { url: data.url || "/tickets" },
        });
      }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    (event.notification.data && event.notification.data.url) || "/tickets",
    self.location.origin,
  );
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windows) => {
        // Reuse an open TeleSpy window rather than opening another.
        const existing = windows.find(
          (w) => new URL(w.url).origin === url.origin,
        );
        if (existing) {
          await existing.focus();
          return existing.navigate(url.href);
        }
        return self.clients.openWindow(url.href);
      }),
  );
});
