import express from 'express';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/browser' });
const port = Number(process.env.PORT || 10000);
const sessions = new Map();

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req,res)=>res.json({ok:true,sessions:sessions.size}));
app.use((_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

function normalize(raw){
  const v=String(raw||'').trim();
  if(!v) return 'https://www.google.com/';
  if(/^https?:\/\//i.test(v)) return v;
  if(/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(v)) return 'https://'+v;
  return 'https://www.google.com/search?q='+encodeURIComponent(v);
}
function safeSend(ws,obj){ if(ws.readyState===1) ws.send(JSON.stringify(obj)); }

wss.on('connection', async ws => {
  const id=crypto.randomUUID();
  let browser, context, page;
  let lastFrame=0, rendering=false;
  try {
    browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});
    context=await browser.newContext({viewport:{width:1365,height:768},ignoreHTTPSErrors:true});
    page=await context.newPage();
    sessions.set(id,{browser,context,page});

    const render=async(force=false)=>{
      const now=Date.now(); if(rendering||(!force&&now-lastFrame<120)) return;
      rendering=true;
      try{
        const buf=await page.screenshot({type:'jpeg',quality:68});
        safeSend(ws,{type:'frame',data:buf.toString('base64'),url:page.url(),title:await page.title()});
        lastFrame=Date.now();
      }catch{} finally{rendering=false;}
    };
    page.on('load',()=>render(true));
    page.on('domcontentloaded',()=>render(true));
    page.on('framenavigated',f=>{if(f===page.mainFrame()) render(true)});
    await page.goto('https://www.google.com/',{waitUntil:'domcontentloaded',timeout:30000}).catch(()=>{});
    await render(true);

    ws.on('message',async raw=>{
      try{
        const m=JSON.parse(raw.toString());
        if(m.type==='navigate') await page.goto(normalize(m.value),{waitUntil:'domcontentloaded',timeout:30000}).catch(e=>safeSend(ws,{type:'error',message:e.message}));
        else if(m.type==='back') await page.goBack({waitUntil:'domcontentloaded',timeout:20000}).catch(()=>{});
        else if(m.type==='forward') await page.goForward({waitUntil:'domcontentloaded',timeout:20000}).catch(()=>{});
        else if(m.type==='reload') await page.reload({waitUntil:'domcontentloaded',timeout:20000}).catch(()=>{});
        else if(m.type==='click'){await page.mouse.click(Number(m.x),Number(m.y));}
        else if(m.type==='move'){await page.mouse.move(Number(m.x),Number(m.y));}
        else if(m.type==='wheel'){await page.mouse.wheel(Number(m.dx||0),Number(m.dy||0));}
        else if(m.type==='key'){await page.keyboard.press(String(m.key));}
        else if(m.type==='text'){await page.keyboard.insertText(String(m.text||''));}
        else if(m.type==='viewport'){await page.setViewportSize({width:Math.max(320,Math.min(1920,Number(m.width)||1365)),height:Math.max(240,Math.min(1080,Number(m.height)||768))});}
        await render(true);
      }catch(e){safeSend(ws,{type:'error',message:e.message});}
    });
  }catch(e){safeSend(ws,{type:'error',message:'Browser failed to start: '+e.message});}
  ws.on('close',async()=>{sessions.delete(id);try{await context?.close()}catch{}try{await browser?.close()}catch{}});
});

server.listen(port,'0.0.0.0',()=>console.log(`Nebula server browser listening on 0.0.0.0:${port}`));
