import express from "express";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import wisp from "wisp-server-node";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicPath = join(__dirname, "../public");
const app = express();

app.disable("x-powered-by");
app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.use((req, res, next) => {
  if (req.path === "/" || req.path === "/index.html" || req.path === "/app.js" ||
      req.path === "/sw.js" || req.path === "/uv.config.js") {
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
  if (req.url?.startsWith("/wisp/")) {
    console.log(`[wisp] upgrade ${req.url}`);
    wisp.routeRequest(req, socket, head);
  } else {
    socket.end();
  }
});

const port = Number.parseInt(process.env.PORT || "10000", 10);
server.listen(port, "0.0.0.0", () => console.log(`Ultraviolet listening on 0.0.0.0:${port}`));

function shutdown() { server.close(() => process.exit(0)); }
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
