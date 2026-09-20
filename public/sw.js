importScripts("/uv/uv.bundle.js", "/uv.config.js", "/uv/uv.sw.js");
const sw = new UVServiceWorker();
self.addEventListener("fetch", event => event.respondWith(sw.fetch(event)));
