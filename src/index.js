import express from "express";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { server as wisp, logging as wispLogging } from "@mercuryworkshop/wisp-js/server";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicPath = join(__dirname, "../public");
const app = express();

wispLogging.set_level(wispLogging.INFO);

const PASSWORD = process.env.STARFIRE_PASSWORD || "Jackegg1218";
let sharedSettings = {
  theme: "rainbow",
  starColor: "theme",
  animation: true,
  starCount: 100,
  mouseSensitivity: 1.5,
  animationSpeed: 1.5,
  freezeMode: "off"
};

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

app.post("/api/login", (req, res) => {
  if (req.body?.password !== PASSWORD) return res.status(401).json({ ok: false });
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true });
});

app.get("/api/settings", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(sharedSettings);
});

app.put("/api/settings", (req, res) => {
  if (req.get("X-Starfire-Password") !== PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const b = req.body || {};
  sharedSettings = {
    theme: String(b.theme || sharedSettings.theme),
    starColor: String(b.starColor || sharedSettings.starColor),
    animation: Boolean(b.animation),
    starCount: Math.max(20, Math.min(220, Number(b.starCount) || 100)),
    mouseSensitivity: Math.max(0.1, Math.min(10, Number(b.mouseSensitivity) || 1.5)),
    animationSpeed: Math.max(0.1, Math.min(10, Number(b.animationSpeed) || 1.5)),
    freezeMode: String(b.freezeMode || sharedSettings.freezeMode)
  };
  res.json(sharedSettings);
});

app.use((req, res, next) => {
  if (["/", "/index.html", "/app.js", "/style.css", "/sw.js", "/uv.config.js"].includes(req.path)) {
    res.setHeader("Cache-Control", "no-store, max-age=0");
  }
  next();
});

app.use(express.static(publicPath));
app.use("/uv/", express.static(uvPath));
app.use("/epoxy/", express.static(epoxyPath));
app.use("/baremux/", express.static(baremuxPath));
app.use((_req, res) => res.status(404).sendFile(join(publicPath, "404.html")));

const server = createServer((req, res) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  app(req, res);
});

server.on("upgrade", (req, socket, head) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  if (pathname === "/wisp/") {
    req.url = pathname;
    wisp.routeRequest(req, socket, head);
    return;
  }
  socket.end();
});

const port = Number.parseInt(process.env.PORT || "10000", 10);
server.listen(port, "0.0.0.0", () => console.log(`Ultraviolet listening on 0.0.0.0:${port}`));

function shutdown() { server.close(() => process.exit(0)); }
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
