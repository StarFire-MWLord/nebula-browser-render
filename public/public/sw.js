importScripts("/uv/uv.bundle.js", "/uv.config.js", "/uv/uv.sw.js");
const sw = new UVServiceWorker();
self.addEventListener("fetch", event => {
  if (sw.route(event)) event.respondWith(sw.fetch(event));
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
