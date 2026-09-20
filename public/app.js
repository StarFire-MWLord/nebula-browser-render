const screen=document.querySelector('#screen'),stage=document.querySelector('#stage'),address=document.querySelector('#address'),status=document.querySelector('#status'),msg=document.querySelector('#message'),keys=document.querySelector('#keys');
let socket,nativeW=1280,nativeH=720,retry=0,retryTimer;
function showMessage(text){msg.hidden=false;msg.textContent=text}
function connect(){
  clearTimeout(retryTimer);
  status.textContent='Connecting…';showMessage('Connecting to server-side Chromium…');
  const proto=location.protocol==='https:'?'wss':'ws';
  socket=new WebSocket(`${proto}://${location.host}/browser`);
  socket.onopen=()=>{retry=0;status.textContent='Starting browser…';showMessage('Starting Chromium session…');resize()};
  socket.onclose=e=>{status.textContent='Disconnected';showMessage('Browser connection ended. Reconnecting…');const delay=Math.min(10000,1000*(2**Math.min(retry++,3)));retryTimer=setTimeout(connect,delay)};
  socket.onerror=()=>{status.textContent='Connection error';showMessage('Could not establish the browser WebSocket. Retrying…')};
  socket.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}
    if(m.type==='frame'){screen.src='data:image/jpeg;base64,'+m.data;address.value=m.url||address.value;document.title=(m.title||'Nebula')+' — Nebula GX';status.textContent='Connected';msg.hidden=true}
    else if(m.type==='status'){status.textContent=m.message||'Connecting…';showMessage(m.message||'Connecting…')}
    else if(m.type==='error'){status.textContent='Browser error';showMessage(m.message||'Browser session failed')}
  };
}
function send(o){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(o))}
function resize(){const r=stage.getBoundingClientRect();nativeW=Math.max(320,Math.min(1600,Math.floor(r.width)));nativeH=Math.max(240,Math.min(900,Math.floor(r.height)));send({type:'viewport',width:nativeW,height:nativeH})}
function point(e){const r=screen.getBoundingClientRect();return{x:(e.clientX-r.left)*nativeW/r.width,y:(e.clientY-r.top)*nativeH/r.height}}
document.querySelector('#go').onsubmit=e=>{e.preventDefault();send({type:'navigate',value:address.value});keys.focus()};document.querySelector('#back').onclick=()=>send({type:'back'});document.querySelector('#forward').onclick=()=>send({type:'forward'});document.querySelector('#reload').onclick=()=>send({type:'reload'});
screen.addEventListener('click',e=>{const p=point(e);send({type:'click',...p});keys.focus()});screen.addEventListener('mousemove',e=>{const p=point(e);send({type:'move',...p})});stage.addEventListener('wheel',e=>{e.preventDefault();send({type:'wheel',dx:e.deltaX,dy:e.deltaY})},{passive:false});
keys.addEventListener('beforeinput',e=>{if(e.data)send({type:'text',text:e.data})});keys.addEventListener('keydown',e=>{const map={Enter:'Enter',Backspace:'Backspace',Delete:'Delete',Tab:'Tab',Escape:'Escape',ArrowUp:'ArrowUp',ArrowDown:'ArrowDown',ArrowLeft:'ArrowLeft',ArrowRight:'ArrowRight'};if(map[e.key]){e.preventDefault();send({type:'key',key:map[e.key]})}});window.addEventListener('resize',()=>setTimeout(resize,150));connect();
