// Keeps the app shell on the phone so it opens without a connection.
// Shell files are network-first (so updates arrive on the next open) with the
// cache as fallback. Google API calls are never cached here.
const CACHE = "pt-shell-v8";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "config.js",
  "manifest.webmanifest",
  "js/app.js",
  "js/model.js",
  "js/google.js",
  "js/chart.js",
  "js/format.js",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "icons/icon-maskable-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(e.request, { cache: "no-cache" });
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      } catch {
        const hit = (await cache.match(e.request, { ignoreSearch: true })) ?? (e.request.mode === "navigate" ? await cache.match("index.html") : null);
        return hit ?? Response.error();
      }
    })(),
  );
});
