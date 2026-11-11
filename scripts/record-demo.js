// Конечная 120-секундная запись локального Chrome через CDP; требует ffmpeg.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const pages = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = pages.find(p=>p.url.startsWith('http://127.0.0.1:3000'));
if (!page) throw new Error('Откройте демо в Chrome с remote-debugging-port=9222');
mkdirSync('artifacts/frames',{recursive:true});
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let id=0, busy=false, count=0;
ws.addEventListener('message',event=>{ const m=JSON.parse(event.data); if(m.id) busy=false; });
const timer=setInterval(()=>{
  if(busy) return;
  busy=true;ws.send(JSON.stringify({id:++id,method:'Page.captureScreenshot',params:{format:'jpeg',quality:80}}));
},500);
ws.addEventListener('message',event=>{
 const m=JSON.parse(event.data);if(m.result?.data) writeFileSync(`artifacts/frames/${String(count++).padStart(5,'0')}.jpg`,Buffer.from(m.result.data,'base64'));
});
setTimeout(()=>{
 clearInterval(timer);ws.close();
 const result=spawnSync('ffmpeg',['-y','-framerate','2','-i','artifacts/frames/%05d.jpg','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','artifacts/demo.mp4'],{encoding:'utf8'});
 if(result.status!==0) {console.error(result.stderr);process.exitCode=1;} else {rmSync('artifacts/frames',{recursive:true});console.log('Запись готова: artifacts/demo.mp4');}
},120000);
