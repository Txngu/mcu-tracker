/* Network-first service worker: always tries the network first so edited
   files (like firebase-config.js) show up on a normal refresh, and only
   falls back to the cached copy when the network is unavailable (offline). */

const CACHE_NAME = "chronovault-cache-v2"; // bumped to purge the old cache-first version
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./mcu-data.js",
  "./manifest.json",
  "./firebase-config.js",
  "./auth.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});