importScripts("/uv/uv.bundle.js", "/uv.config.js", "/uv/uv.sw.js");
const sw = new UVServiceWorker();

async function proxyFetchWithStarfireControls(event) {
  const response = await sw.fetch(event);

  // Only alter full-page proxied HTML navigations. CSS, JS, media, API calls,
  // images, Wisp, and all other proxy traffic are returned untouched.
  if (event.request.mode !== "navigate") return response;

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  try {
    let html = await response.text();
    const tag = '<script src="/starfire-refresh.js"></script>';
    if (!html.includes("/starfire-refresh.js")) {
      if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, tag + "</body>");
      else html += tag;
    }

    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");

    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  } catch {
    return response;
  }
}

self.addEventListener("fetch", event => {
  if (sw.route(event)) event.respondWith(proxyFetchWithStarfireControls(event));
});
