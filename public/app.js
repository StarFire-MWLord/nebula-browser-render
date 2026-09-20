import { BareMuxConnection } from "/baremux/index.js";

const form = document.querySelector("#proxy-form");
const input = document.querySelector("#proxy-address");
const status = document.querySelector("#status");

function normalize(value) {
  value = value.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(value)) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

async function setup() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers are not supported by this browser.");
  }

  // Register UV's gateway and WAIT until it is active before navigating into
  // /service/. register() alone can resolve while the worker is still installing.
  await navigator.serviceWorker.register("/sw.js", { scope: __uv$config.prefix });
  await navigator.serviceWorker.ready;

  const conn = new BareMuxConnection("/baremux/worker.js");
  const wisp = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/wisp/`;
  await conn.setTransport("/epoxy/index.mjs", [{ wisp }]);
}

let readyPromise = setup();
readyPromise
  .then(() => { status.textContent = "Ready"; })
  .catch((err) => {
    console.error(err);
    status.textContent = `Proxy setup failed: ${err?.message || err}`;
  });

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const target = normalize(input.value);
  if (!target) return;

  try {
    status.textContent = "Opening…";
    await readyPromise;
    const encoded = __uv$config.encodeUrl(target);
    window.location.assign(__uv$config.prefix + encoded);
  } catch (err) {
    console.error(err);
    status.textContent = `Proxy startup failed: ${err?.message || err}`;
    readyPromise = setup();
  }
});
