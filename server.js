import express from 'express';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { WebSocketServer, WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const port = Number(process.env.PORT || 10000);
const sessions = new Map();
let sharedBrowser = null;
let launchingBrowser = null;

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.status(200).json({ ok: true, browser: !!sharedBrowser, sessions: sessions.size }));
app.use((_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

function normalize(raw) {
  const v = String(raw || '').trim();
  if (!v) return 'https://www.google.com/';
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(v)) return 'https://' + v;
  return 'https://www.google.com/search?q=' + encodeURIComponent(v);
}

function safeSend(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

async function getBrowser() {
  if (sharedBrowser?.isConnected()) return sharedBrowser;
  if (launchingBrowser) return launchingBrowser;
  launchingBrowser = (async () => {
    console.log('[chromium] launching shared browser');
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--autoplay-policy=no-user-gesture-required'
      ]
    });
    browser.on('disconnected', () => {
      console.error('[chromium] browser disconnected');
      sharedBrowser = null;
    });
    sharedBrowser = browser;
    console.log('[chromium] browser ready');
    return browser;
  })().finally(() => { launchingBrowser = null; });
  return launchingBrowser;
}

server.on('upgrade', (request, socket, head) => {
  let pathname;
  try { pathname = new URL(request.url, 'http://localhost').pathname; }
  catch { socket.destroy(); return; }
  if (pathname !== '/browser') { socket.destroy(); return; }
  console.log('[ws] upgrade request /browser');
  wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
});

wss.on('connection', async ws => {
  const id = crypto.randomUUID();
  let context = null;
  let page = null;
  let rendering = false;
  let lastFrame = 0;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  safeSend(ws, { type: 'status', message: 'Starting Chromium…' });
  console.log(`[session ${id}] connected`);

  const render = async (force = false) => {
    if (!page || page.isClosed()) return;
    const now = Date.now();
    if (rendering || (!force && now - lastFrame < 180)) return;
    rendering = true;
    try {
      const [buf, title] = await Promise.all([
        page.screenshot({ type: 'jpeg', quality: 62, animations: 'disabled' }),
        page.title().catch(() => '')
      ]);
      safeSend(ws, { type: 'frame', data: buf.toString('base64'), url: page.url(), title });
      lastFrame = Date.now();
    } catch (e) {
      console.error(`[session ${id}] screenshot error:`, e.message);
    } finally { rendering = false; }
  };

  try {
    const browser = await getBrowser();
    safeSend(ws, { type: 'status', message: 'Creating browser session…' });
    context = await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
    page = await context.newPage();
    sessions.set(id, { context, page });
    page.on('load', () => render(true));
    page.on('domcontentloaded', () => render(true));
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) render(true); });
    page.on('crash', () => safeSend(ws, { type: 'error', message: 'The Chromium page crashed. Try reloading.' }));
    await page.goto('https://www.google.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => {
      console.error(`[session ${id}] initial navigation:`, e.message);
    });
    safeSend(ws, { type: 'status', message: 'Connected' });
    await render(true);
  } catch (e) {
    console.error(`[session ${id}] browser startup failed:`, e);
    safeSend(ws, { type: 'error', message: 'Browser failed to start: ' + e.message });
  }

  ws.on('message', async raw => {
    if (!page || page.isClosed()) return safeSend(ws, { type: 'error', message: 'Browser session is not ready.' });
    try {
      const m = JSON.parse(raw.toString());
      if (m.type === 'navigate') await page.goto(normalize(m.value), { waitUntil: 'domcontentloaded', timeout: 30000 });
      else if (m.type === 'back') await page.goBack({ waitUntil: 'domcontentloaded', timeout: 20000 });
      else if (m.type === 'forward') await page.goForward({ waitUntil: 'domcontentloaded', timeout: 20000 });
      else if (m.type === 'reload') await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
      else if (m.type === 'click') await page.mouse.click(Number(m.x), Number(m.y));
      else if (m.type === 'move') await page.mouse.move(Number(m.x), Number(m.y));
      else if (m.type === 'wheel') await page.mouse.wheel(Number(m.dx || 0), Number(m.dy || 0));
      else if (m.type === 'key') await page.keyboard.press(String(m.key));
      else if (m.type === 'text') await page.keyboard.insertText(String(m.text || ''));
      else if (m.type === 'viewport') await page.setViewportSize({
        width: Math.max(320, Math.min(1600, Number(m.width) || 1280)),
        height: Math.max(240, Math.min(900, Number(m.height) || 720))
      });
      await render(true);
    } catch (e) {
      console.error(`[session ${id}] command failed:`, e.message);
      safeSend(ws, { type: 'error', message: e.message });
      await render(true);
    }
  });

  ws.on('close', async () => {
    console.log(`[session ${id}] disconnected`);
    sessions.delete(id);
    try { await context?.close(); } catch {}
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 25000);

async function shutdown(signal) {
  console.log(`[shutdown] ${signal}`);
  clearInterval(heartbeat);
  for (const ws of wss.clients) try { ws.close(1012, 'Server restarting'); } catch {}
  for (const { context } of sessions.values()) try { await context.close(); } catch {}
  sessions.clear();
  try { await sharedBrowser?.close(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 25000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', e => console.error('[uncaughtException]', e));
process.on('unhandledRejection', e => console.error('[unhandledRejection]', e));

server.listen(port, '0.0.0.0', () => console.log(`Nebula server browser listening on 0.0.0.0:${port}`));
