/* eslint-disable no-restricted-globals */

// Makes repeat visits start instantly and keeps the app shell available on flaky mobile networks.
// Only the app's own files are cached - API calls and the WebSocket always go to the network.
//
// Caching is strictly an optimisation: cache storage can be unavailable or full (private
// browsing, low disk space), so every cache operation here is allowed to fail and the
// request then simply goes to the network as if this file did not exist.
const CACHE = "onboard-shell-v1";
const SHELL_URL = "/";
const SHELL_TIMEOUT_MS = 3000;
const MAX_ENTRIES = 60;

const isCacheable = (response) => response && response.ok && !response.redirected && response.type === "basic";

const lookup = async (key) => {
  try {
    const cache = await caches.open(CACHE);
    return (await cache.match(key)) || null;
  } catch (error) {
    return null;
  }
};

const store = async (key, response) => {
  if (!isCacheable(response)) return;
  try {
    const cache = await caches.open(CACHE);
    await cache.put(key, response);
  } catch (error) {
    // Not cached this time
  }
};

// Fetch the page and the scripts/styles it references, so the next visit needs no network for them
const precache = async () => {
  const response = await fetch(SHELL_URL, { cache: "no-cache" });
  if (!isCacheable(response)) return;
  const html = await response.clone().text();
  await store(SHELL_URL, response);
  const assets = [...new Set(html.match(/\/static\/[^"')\s]+\.(?:js|css)/g) || [])];
  await Promise.all(assets.map(async (url) => {
    if (!(await lookup(url))) await store(url, await fetch(url));
  }));
};

// Files of old deployments are never asked for again - drop the oldest ones
const trim = async () => {
  const cache = await caches.open(CACHE);
  const keys = (await cache.keys()).filter((request) => new URL(request.url).pathname !== SHELL_URL);
  const extra = keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES));
  await Promise.all(extra.map((request) => cache.delete(request)));
};

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(precache().catch(() => {}));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
    } catch (error) {
      // Nothing to clean up
    }
    await self.clients.claim();
  })());
});

// Page loads: always try for the newest version, fall back to the saved one when offline or slow
const loadShell = async (request) => {
  const cached = await lookup(SHELL_URL);
  // Only give up on a slow network when there is a saved copy to show instead
  const controller = cached ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), SHELL_TIMEOUT_MS) : null;
  try {
    const response = await (controller ? fetch(request, { signal: controller.signal }) : fetch(request));
    await store(SHELL_URL, response.clone());
    return response;
  } catch (error) {
    if (cached) return cached;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

// Build files have a content hash in their name, so a cached copy never goes stale
const cacheFirst = async (request) => {
  const cached = await lookup(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheable(response)) {
    await store(request, response.clone());
    trim().catch(() => {});
  }
  return response;
};

// Icons, manifest: answer from the cache right away and refresh it in the background
const staleWhileRevalidate = async (request) => {
  const cached = await lookup(request);
  const refresh = fetch(request).then(async (response) => {
    await store(request, response.clone());
    return response;
  });
  if (!cached) return refresh;
  refresh.catch(() => {});
  return cached;
};

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws/")) return;

  if (request.mode === "navigate") {
    event.respondWith(loadShell(request));
  } else if (url.pathname.startsWith("/static/")) {
    event.respondWith(cacheFirst(request));
  } else if (/\.(?:png|svg|ico|json)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
