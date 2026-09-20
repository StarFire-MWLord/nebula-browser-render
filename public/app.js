const $ = (s) => document.querySelector(s);
const form = $("#proxy-form"), input = $("#proxy-address"), status = $("#status");
const STORAGE_SETTINGS = "nebula.settings.v1", STORAGE_FAVS = "nebula.favorites.v1";
const MAX_TABS = 3;
let siteUnlocked = false;
let sessionPassword = "";
let tabs = [];
let activeTabId = null;
let nextTabId = 1;

const loginGate = $("#loginGate");
const loginForm = $("#loginForm");
const loginPassword = $("#loginPassword");
const loginError = $("#loginError");
const home = $("#home");
const tabStrip = $("#tabStrip");
const tabViews = $("#tabViews");
const newTabBtn = $("#newTabBtn");
const refreshTabBtn = $("#refreshTabBtn");


function normalize(value) {
  value = value.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(value)) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

function waitForActivation(reg) {
  if (reg.active) return Promise.resolve();
  const worker = reg.installing || reg.waiting;
  if (!worker) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Service worker activation timed out")), 12000);
    worker.addEventListener("statechange", () => {
      if (worker.state === "activated") { clearTimeout(timeout); resolve(); }
      if (worker.state === "redundant") { clearTimeout(timeout); reject(new Error("Service worker became redundant")); }
    });
  });
}

async function setupProxy() {
  if (!("serviceWorker" in navigator)) throw new Error("Service workers are not supported by this browser.");

  status.textContent = "Registering proxy…";
  const reg = await navigator.serviceWorker.register("/sw.js?v=starfire-3", {
    scope: "/",
    updateViaCache: "none"
  });
  try { await reg.update(); } catch {}

  status.textContent = "Starting service worker…";
  const readyReg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error("Service worker did not become ready within 12 seconds")),
      12000
    ))
  ]);

  if (!readyReg.active) await waitForActivation(readyReg);

  status.textContent = "Loading transport…";
  if (!window.BareMux?.BareMuxConnection) {
    throw new Error("BareMux browser library did not load");
  }
  const conn = new window.BareMux.BareMuxConnection("/baremux/worker.js");
  const wisp = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/wisp/`;

  status.textContent = "Connecting transport…";
  await conn.setTransport("/epoxy/index.mjs", [{ wisp }]);

  status.textContent = "Ready";
}
let readyPromise;
function startProxy() {
  readyPromise = setupProxy().catch(err => {
    console.error("Starfire proxy startup failed:", err);
    status.textContent = `Proxy error: ${err?.message || err}`;
    throw err;
  });
  return readyPromise;
}
// Start only AFTER all UI handlers below have been installed.


function tabFor(id) {
  return tabs.find(tab => tab.id === id);
}

function tabTitleFor(url) {
  try { return new URL(url).hostname.replace(/^www\./, "").slice(0, 24); }
  catch { return "New Tab"; }
}

function renderTabs() {
  tabStrip.innerHTML = "";
  for (const tab of tabs) {
    const button = document.createElement("button");
    button.className = `browserTab${tab.id === activeTabId ? " active" : ""}`;
    button.type = "button";

    const title = document.createElement("span");
    title.className = "browserTabTitle";
    title.textContent = tab.title;

    const close = document.createElement("button");
    close.className = "browserTabClose";
    close.type = "button";
    close.textContent = "×";
    close.title = "Close tab";
    close.addEventListener("click", event => {
      event.stopPropagation();
      closeTab(tab.id);
    });

    button.addEventListener("click", () => activateTab(tab.id));
    button.append(title, close);
    tabStrip.append(button);
  }
  newTabBtn.disabled = tabs.length >= MAX_TABS;
}

function createTab() {
  if (!siteUnlocked) return null;
  if (tabs.length >= MAX_TABS) {
    status.textContent = "Maximum of 3 tabs.";
    return null;
  }
  const tab = { id: nextTabId++, title: "New Tab", url: null, frame: null };
  tabs.push(tab);
  activateTab(tab.id);
  return tab;
}

function activateTab(id) {
  activeTabId = id;
  for (const tab of tabs) {
    if (tab.frame) tab.frame.classList.toggle("active", tab.id === id);
  }
  const tab = tabFor(id);
  home.classList.toggle("tabHidden", Boolean(tab?.frame));
  input.value = tab?.url || "";
  renderTabs();
}

function closeTab(id) {
  const index = tabs.findIndex(tab => tab.id === id);
  if (index < 0) return;
  const wasActive = activeTabId === id;
  tabs[index].frame?.remove();
  tabs.splice(index, 1);

  if (!tabs.length) {
    createTab();
    return;
  }
  if (wasActive) activateTab(tabs[Math.min(index, tabs.length - 1)].id);
  else renderTabs();
}

async function openTarget(value) {
  if (!siteUnlocked) return;
  const target = normalize(value);
  if (!target) return;
  try {
    status.textContent = "Opening…";
    await (readyPromise || startProxy());

    const tab = tabFor(activeTabId) || createTab();
    if (!tab) return;
    tab.url = target;
    tab.title = tabTitleFor(target);

    if (!tab.frame) {
      tab.frame = document.createElement("iframe");
      tab.frame.className = "proxyTabFrame";
      tab.frame.addEventListener("load", () => {
        if (tab.id === activeTabId) status.textContent = "Ready";
      });
      tabViews.append(tab.frame);
    }

    tab.frame.src = __uv$config.prefix + __uv$config.encodeUrl(target);
    activateTab(tab.id);
  } catch (err) {
    console.error(err);
    status.textContent = `Proxy startup failed: ${err.message || err}`;
    readyPromise = setupProxy();
  }
}

form.addEventListener("submit", event => {
  event.preventDefault();
  openTarget(input.value);
});

newTabBtn.addEventListener("click", createTab);
refreshTabBtn.addEventListener("click", () => {
  if (!siteUnlocked) return;
  const tab = tabFor(activeTabId);
  if (!tab?.frame) {
    status.textContent = "Nothing to refresh in this tab.";
    return;
  }
  status.textContent = "Refreshing tab…";
  // This reloads only the iframe containing the proxied page, never Starfire itself.
  try { tab.frame.contentWindow.location.reload(); }
  catch { tab.frame.src = tab.frame.src; }
});


/* Panels + persistent settings */
const defaults = {theme:"rainbow",starColor:"theme",animation:true,starCount:100,mouseSensitivity:1.5,animationSpeed:1.5,freezeMode:"off"};
let settings = {...defaults, ...JSON.parse(localStorage.getItem(STORAGE_SETTINGS) || "{}")};
const controls = ["theme","starColor","animation","starCount","mouseSensitivity","animationSpeed","freezeMode"];
async function saveSettings(){
  localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(settings));
  if (!siteUnlocked || !sessionPassword) return;
  try {
    await fetch("/api/settings", {
      method: "PUT",
      headers: {"Content-Type":"application/json", "X-Starfire-Password": sessionPassword},
      body: JSON.stringify(settings)
    });
  } catch (err) {
    console.warn("Shared settings update failed:", err);
  }
}
function syncControls(){
  for(const id of controls){ const el=$("#"+id); if(el.type==="checkbox") el.checked=!!settings[id]; else el.value=settings[id]; }
  $("#countValue").textContent=settings.starCount; $("#mouseValue").textContent=Number(settings.mouseSensitivity).toFixed(1); $("#speedValue").textContent=Number(settings.animationSpeed).toFixed(1);
}
for(const id of controls) $("#"+id).addEventListener("input", e => {
  settings[id] = e.target.type==="checkbox" ? e.target.checked : (["starCount","mouseSensitivity","animationSpeed"].includes(id) ? Number(e.target.value) : e.target.value);
  saveSettings(); syncControls(); if(id==="starCount") rebuildStars();
});
$("#resetSettings").onclick=()=>{settings={...defaults};saveSettings();syncControls();rebuildStars();};
syncControls();

async function loadSharedSettings() {
  try {
    const response = await fetch("/api/settings", { cache: "no-store" });
    if (!response.ok) return;
    settings = {...defaults, ...await response.json()};
    localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(settings));
    syncControls();
    rebuildStars();
  } catch (err) {
    console.warn("Shared settings load failed:", err);
  }
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  loginError.textContent = "Checking…";
  try {
    const password = loginPassword.value;
    const response = await fetch("/api/login", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ password })
    });
    if (!response.ok) {
      loginError.textContent = "Incorrect password.";
      loginPassword.select();
      return;
    }
    siteUnlocked = true;
    sessionPassword = password;
    loginPassword.value = "";
    loginError.textContent = "";
    loginGate.classList.add("unlocked");
    await loadSharedSettings();
    if (!tabs.length) createTab();
    input.focus();
  } catch (err) {
    console.error(err);
    loginError.textContent = "Could not contact the server.";
  }
});

function togglePanel(id){ document.querySelectorAll(".panel").forEach(p=>p.classList.toggle("open",p.id===id && !p.classList.contains("open"))); }
$("#settingsBtn").onclick=()=>togglePanel("settingsPanel"); $("#favoritesBtn").onclick=()=>togglePanel("favoritesPanel");
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>$("#"+b.dataset.close).classList.remove("open"));

/* Favorites */
let favorites = JSON.parse(localStorage.getItem(STORAGE_FAVS) || "[]");
function saveFavs(){localStorage.setItem(STORAGE_FAVS,JSON.stringify(favorites));renderFavs();}
function renderFavs(){
  const list=$("#favoritesList"); list.innerHTML="";
  if(!favorites.length){list.innerHTML='<div style="color:#77819f;font-size:13px">No favorites saved yet.</div>';return;}
  favorites.forEach((f,i)=>{
    const row=document.createElement("div");row.className="fav";
    const open=document.createElement("button");open.className="favOpen";open.innerHTML=`<b></b><small></small>`;open.querySelector("b").textContent=f.name;open.querySelector("small").textContent=f.url;open.onclick=()=>openTarget(f.url);
    const del=document.createElement("button");del.className="favDelete";del.textContent="×";del.title="Remove";del.onclick=()=>{favorites.splice(i,1);saveFavs();};
    row.append(open,del);list.append(row);
  });
}
$("#favoriteForm").onsubmit=e=>{e.preventDefault();const url=normalize($("#favoriteUrl").value);if(!url)return;let name=$("#favoriteName").value.trim();if(!name){try{name=new URL(url).hostname.replace(/^www\./,"");}catch{name="Favorite";}}favorites.push({name,url});saveFavs();e.target.reset();};
renderFavs();

/* Constellation canvas */
const canvas=$("#stars"), ctx=canvas.getContext("2d"); let stars=[], mouse={x:-9999,y:-9999}, last=performance.now(), hue=220;
const palette={blue:"#6ea8ff",purple:"#b982ff",cyan:"#62f3ff",green:"#72f6a5",red:"#ff6f83",orange:"#ffad5c",white:"#f4f7ff"};
function resize(){const d=Math.min(devicePixelRatio||1,2);canvas.width=innerWidth*d;canvas.height=innerHeight*d;canvas.style.width=innerWidth+"px";canvas.style.height=innerHeight+"px";ctx.setTransform(d,0,0,d,0,0);}
function rebuildStars(){stars=Array.from({length:Number(settings.starCount)},()=>({x:Math.random()*innerWidth,y:Math.random()*innerHeight,vx:(Math.random()-.5)*.22,vy:(Math.random()-.5)*.22,r:Math.random()*1.35+1}));}
function color(alpha=1){let c=settings.starColor==="theme"?settings.theme:settings.starColor;if(c==="rainbow"||settings.theme==="rainbow"&&settings.starColor==="theme")return `hsla(${hue},90%,72%,${alpha})`;const hex=palette[c]||palette.blue; if(alpha===1)return hex; const n=parseInt(hex.slice(1),16);return `rgba(${n>>16},${n>>8&255},${n&255},${alpha})`;}
function draw(now){
  requestAnimationFrame(draw); const dt=Math.min((now-last)/16.67,3);last=now;ctx.clearRect(0,0,innerWidth,innerHeight);
  if(settings.theme==="rainbow"||settings.starColor==="rainbow") hue=(hue+.22*Number(settings.animationSpeed)*dt)%360;
  const moving=settings.animation && settings.freezeMode==="off", mouseOn=settings.freezeMode!=="all";
  const speed=Number(settings.animationSpeed);
  for(const s of stars){if(moving){s.x+=s.vx*speed*dt;s.y+=s.vy*speed*dt;if(s.x<0)s.x=innerWidth;if(s.x>innerWidth)s.x=0;if(s.y<0)s.y=innerHeight;if(s.y>innerHeight)s.y=0;}ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fillStyle=color(.95);ctx.shadowBlur=10;ctx.shadowColor=color(.8);ctx.fill();ctx.shadowBlur=0;}
  const maxDist=125;
  for(let i=0;i<stars.length;i++)for(let j=i+1;j<stars.length;j++){const a=stars[i],b=stars[j],dx=a.x-b.x,dy=a.y-b.y,d=Math.hypot(dx,dy);if(d<maxDist){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle=color((1-d/maxDist)*.38);ctx.lineWidth=.7;ctx.stroke();}}
  if(mouseOn){const radius=90+Number(settings.mouseSensitivity)*18;for(const s of stars){const d=Math.hypot(s.x-mouse.x,s.y-mouse.y);if(d<radius){ctx.beginPath();ctx.moveTo(s.x,s.y);ctx.lineTo(mouse.x,mouse.y);ctx.strokeStyle=color((1-d/radius)*.8);ctx.lineWidth=.85;ctx.stroke();}}}
}
addEventListener("resize",()=>{resize();rebuildStars();}); addEventListener("pointermove",e=>{mouse.x=e.clientX;mouse.y=e.clientY;}); addEventListener("pointerleave",()=>{mouse.x=mouse.y=-9999;});
resize();rebuildStars();requestAnimationFrame(draw);

// UI is fully initialized; proxy startup can no longer disable the controls if it fails.
startProxy();
