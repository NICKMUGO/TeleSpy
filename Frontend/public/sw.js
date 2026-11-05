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
// Bump VERSION to throw every cached file away on the next visit.
const VERSION = "v2";
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
