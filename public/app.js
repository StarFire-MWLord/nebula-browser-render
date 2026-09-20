import { BareMuxConnection } from "/baremux/index.js";

const form = document.querySelector("#proxy-form");
const input = document.querySelector("#proxy-address");
const status = document.querySelector("#status");

async function setup() {
  if (!navigator.serviceWorker) throw new Error("Service workers are not supported by this browser.");
  await navigator.serviceWorker.register("/sw.js", { scope: __uv$config.prefix });
  const conn = new BareMuxConnection("/baremux/worker.js");
  const wisp = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/wisp/`;
  await conn.setTransport("/epoxy/index.mjs", [{ wisp }]);
}

function normalize(value) {
  value = value.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(value)) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

let ready;
form.addEventListener("submit", async event => {
  event.preventDefault();
  try {
    status.textContent = "Starting proxy…";
    ready ||= setup();
    await ready;
    const target = normalize(input.value);
    if (!target) return;
    location.href = __uv$config.prefix + __uv$config.encodeUrl(target);
  } catch (err) {
    console.error(err);
    status.textContent = `Proxy startup failed: ${err.message || err}`;
    ready = null;
  }
});

setup().then(() => status.textContent = "Ready").catch(err => status.textContent = `Setup warning: ${err.message || err}`);
