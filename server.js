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
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
const port = Number(process.env.PORT || 10000);
const sessions = new Map();
const MAX_SESSIONS = Math.max(1, Number(process.env.MAX_BROWSER_SESSIONS || 1));
const FRAME_QUALITY = Math.max(25, Math.min(70, Number(process.env.FRAME_QUALITY || 45)));
const MAX_W = Math.max(640, Math.min(1280, Number(process.env.MAX_VIEWPORT_WIDTH || 1024)));
const MAX_H = Math.max(360, Math.min(720, Number(process.env.MAX_VIEWPORT_HEIGHT || 576)));
let sharedBrowser = null;
let launchingBrowser = null;

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), { etag: true, maxAge: '1h' }));
app.get('/health', (_req,res) => {
  const m=process.memoryUsage();
  res.json({ok:true,browser:!!sharedBrowser,sessions:sessions.size,rssMB:Math.round(m.rss/1048576),heapMB:Math.round(m.heapUsed/1048576)});
});
app.use((_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

function normalize(raw){
  const v=String(raw||'').trim();
  if(!v) return 'https://www.google.com/';
  if(/^https?:\/\//i.test(v)) return v;
  if(/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(v)) return 'https://'+v;
  return 'https://www.google.com/search?q='+encodeURIComponent(v);
}
function safeSend(ws,obj){
  if(ws.readyState!==WebSocket.OPEN) return;
  if(ws.bufferedAmount > 2*1024*1024) return;
  ws.send(JSON.stringify(obj));
}
async function getBrowser(){
  if(sharedBrowser?.isConnected()) return sharedBrowser;
  if(launchingBrowser) return launchingBrowser;
  launchingBrowser=(async()=>{
    console.log('[chromium] launching shared browser');
    const browser=await chromium.launch({headless:true,args:[
      '--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu',
      '--no-zygote','--renderer-process-limit=2','--disable-background-networking',
      '--disable-background-timer-throttling','--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows','--disable-breakpad','--disable-component-update',
      '--disable-default-apps','--disable-domain-reliability',
      '--disable-features=Translate,BackForwardCache,MediaRouter,OptimizationHints,AutofillServerCommunication',
      '--disable-hang-monitor','--disable-ipc-flooding-protection','--disable-notifications',
      '--disable-popup-blocking','--disable-prompt-on-repost','--disable-sync',
      '--metrics-recording-only','--no-first-run','--no-default-browser-check',
      '--password-store=basic','--use-mock-keychain','--mute-audio'
    ]});
    browser.on('disconnected',()=>{console.error('[chromium] browser disconnected');sharedBrowser=null});
    sharedBrowser=browser;
    console.log('[chromium] browser ready');
    return browser;
  })().finally(()=>{launchingBrowser=null});
  return launchingBrowser;
}

server.on('upgrade',(request,socket,head)=>{
  let pathname;
  try{pathname=new URL(request.url,'http://localhost').pathname}catch{socket.destroy();return}
  if(pathname!=='/browser'){socket.destroy();return}
  wss.handleUpgrade(request,socket,head,ws=>wss.emit('connection',ws,request));
});

wss.on('connection',async ws=>{
  if(sessions.size>=MAX_SESSIONS){
    safeSend(ws,{type:'error',message:'Browser is already in use. Try again when the current session closes.'});
    ws.close(1013,'Browser busy');
    return;
  }
  const id=crypto.randomUUID();
  let context=null,page=null,rendering=false,lastFrame=0,closed=false;
  ws.isAlive=true;
  ws.on('pong',()=>{ws.isAlive=true});
  sessions.set(id,{context:null,page:null,ws});
  console.log(`[session ${id}] connected`);

  const cleanup=async()=>{
    if(closed)return; closed=true;
    sessions.delete(id);
    try{await page?.close({runBeforeUnload:false})}catch{}
    try{await context?.close()}catch{}
    page=null;context=null;
    console.log(`[session ${id}] cleaned up`);
  };

  const render=async(force=false)=>{
    if(!page||page.isClosed()||ws.readyState!==WebSocket.OPEN)return;
    const now=Date.now();
    if(rendering||(!force&&now-lastFrame<350)||ws.bufferedAmount>1024*1024)return;
    rendering=true;
    try{
      const buf=await page.screenshot({type:'jpeg',quality:FRAME_QUALITY,animations:'disabled',scale:'css'});
      const title=await page.title().catch(()=>'');
      safeSend(ws,{type:'frame',data:buf.toString('base64'),url:page.url(),title});
      lastFrame=Date.now();
    }catch(e){if(!closed)console.error(`[session ${id}] screenshot: ${e.message}`)}
    finally{rendering=false}
  };

  try{
    const browser=await getBrowser();
    context=await browser.newContext({
      viewport:{width:MAX_W,height:MAX_H},
      ignoreHTTPSErrors:true,
      serviceWorkers:'block',
      reducedMotion:'reduce'
    });
    sessions.set(id,{context,page:null,ws});
    page=await context.newPage();
    sessions.set(id,{context,page,ws});

    await page.route('**/*',async route=>{
      const req=route.request();
      const type=req.resourceType();
      const url=req.url();
      if(type==='font' ||
         (type==='websocket' && /doubleclick|googleads|googlesyndication/i.test(url)) ||
         /doubleclick\.net|googlesyndication\.com|google-analytics\.com|googletagmanager\.com|scorecardresearch\.com/i.test(url)){
        return route.abort().catch(()=>{});
      }
      return route.continue().catch(()=>{});
    });

    page.on('load',()=>render(true));
    page.on('domcontentloaded',()=>render(true));
    page.on('framenavigated',f=>{if(f===page.mainFrame())render(true)});
    page.on('crash',()=>safeSend(ws,{type:'error',message:'This page used too much memory and crashed. Go back or reload.'}));

    await page.goto('https://www.google.com/',{waitUntil:'domcontentloaded',timeout:30000}).catch(()=>{});
    safeSend(ws,{type:'status',message:'Connected'});
    await render(true);
  }catch(e){
    console.error(`[session ${id}] startup failed:`,e.message);
    safeSend(ws,{type:'error',message:'Browser failed to start: '+e.message});
    await cleanup();
  }

  ws.on('message',async raw=>{
    if(!page||page.isClosed())return;
    try{
      const m=JSON.parse(raw.toString());
      if(m.type==='navigate')await page.goto(normalize(m.value),{waitUntil:'domcontentloaded',timeout:30000});
      else if(m.type==='back')await page.goBack({waitUntil:'domcontentloaded',timeout:20000});
      else if(m.type==='forward')await page.goForward({waitUntil:'domcontentloaded',timeout:20000});
      else if(m.type==='reload')await page.reload({waitUntil:'domcontentloaded',timeout:20000});
      else if(m.type==='click')await page.mouse.click(Number(m.x),Number(m.y));
      else if(m.type==='move')await page.mouse.move(Number(m.x),Number(m.y));
      else if(m.type==='wheel')await page.mouse.wheel(Number(m.dx||0),Number(m.dy||0));
      else if(m.type==='key')await page.keyboard.press(String(m.key));
      else if(m.type==='text')await page.keyboard.insertText(String(m.text||''));
      else if(m.type==='viewport')await page.setViewportSize({
        width:Math.max(320,Math.min(MAX_W,Number(m.width)||MAX_W)),
        height:Math.max(240,Math.min(MAX_H,Number(m.height)||MAX_H))
      });
      await render(true);
    }catch(e){safeSend(ws,{type:'error',message:e.message});await render(true)}
  });
  ws.on('close',cleanup);
  ws.on('error',cleanup);
});

const heartbeat=setInterval(()=>{
  for(const ws of wss.clients){
    if(ws.isAlive===false){ws.terminate();continue}
    ws.isAlive=false;try{ws.ping()}catch{}
  }
},20000);

const memoryLog=setInterval(()=>{
  const m=process.memoryUsage();
  console.log(`[memory] rss=${Math.round(m.rss/1048576)}MB heap=${Math.round(m.heapUsed/1048576)}MB sessions=${sessions.size}`);
},60000);

async function shutdown(signal){
  console.log('[shutdown]',signal);
  clearInterval(heartbeat);clearInterval(memoryLog);
  for(const ws of wss.clients)try{ws.close(1012,'Server restarting')}catch{}
  for(const {context} of sessions.values())try{await context?.close()}catch{}
  sessions.clear();
  try{await sharedBrowser?.close()}catch{}
  server.close(()=>process.exit(0));
  setTimeout(()=>process.exit(0),15000).unref();
}
process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGINT',()=>shutdown('SIGINT'));
process.on('uncaughtException',e=>console.error('[uncaughtException]',e));
process.on('unhandledRejection',e=>console.error('[unhandledRejection]',e));

server.listen(port,'0.0.0.0',()=>console.log(`Nebula optimized server browser listening on 0.0.0.0:${port}`));
