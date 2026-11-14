const menuBtn=document.getElementById("menuBtn");
const mobileMenu=document.getElementById("mobileMenu");
const form=document.getElementById("downloadForm");
const input=document.getElementById("mediaUrl");
const notice=document.getElementById("notice");
const result=document.getElementById("result");
const downloadButton=document.getElementById("downloadButton");
document.getElementById("year").textContent=new Date().getFullYear();
if(menuBtn&&mobileMenu){menuBtn.addEventListener("click",()=>{const open=mobileMenu.classList.toggle("open");menuBtn.setAttribute("aria-expanded",String(open));});mobileMenu.querySelectorAll("a").forEach(a=>a.addEventListener("click",()=>{mobileMenu.classList.remove("open");menuBtn.setAttribute("aria-expanded","false");}));}
const ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/></svg>';
function showNotice(text,type){notice.className="notice"+(type?" "+type:"");notice.style.display=text?"block":"none";notice.textContent=text||"";}
function mkBtn(label,cls){const b=document.createElement("button");b.type="button";b.className="dl-btn"+(cls?" "+cls:"");b.innerHTML=ICON;b.appendChild(document.createTextNode(label));return b;}
function mkLink(f,cls){const a=document.createElement("a");a.className="dl-btn"+(cls?" "+cls:"");a.href=f.url;a.setAttribute("download","");a.innerHTML=ICON;a.appendChild(document.createTextNode(f.label));return a;}
function saveBlob(blob,name){const u=URL.createObjectURL(blob),a=document.createElement("a");a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4000);}
/* minimal ZIP (store, no compression) — no dependencies */
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(u8){let c=0xFFFFFFFF;for(let i=0;i<u8.length;i++)c=CRC[(c^u8[i])&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}
function buildZip(files){const enc=new TextEncoder(),parts=[],central=[];let offset=0;
 for(const f of files){const name=enc.encode(f.name),crc=crc32(f.data),size=f.data.length;
  const lh=new DataView(new ArrayBuffer(30));lh.setUint32(0,0x04034b50,true);lh.setUint16(4,20,true);lh.setUint16(6,0x0800,true);lh.setUint16(8,0,true);lh.setUint16(10,0,true);lh.setUint16(12,0x21,true);lh.setUint32(14,crc,true);lh.setUint32(18,size,true);lh.setUint32(22,size,true);lh.setUint16(26,name.length,true);lh.setUint16(28,0,true);
  parts.push(lh.buffer,name,f.data);
  const ch=new DataView(new ArrayBuffer(46));ch.setUint32(0,0x02014b50,true);ch.setUint16(4,20,true);ch.setUint16(6,20,true);ch.setUint16(8,0x0800,true);ch.setUint16(10,0,true);ch.setUint16(12,0,true);ch.setUint16(14,0x21,true);ch.setUint32(16,crc,true);ch.setUint32(20,size,true);ch.setUint32(24,size,true);ch.setUint16(28,name.length,true);ch.setUint32(42,offset,true);
  central.push(ch.buffer,name);offset+=30+name.length+size;}
 let csize=0;for(let i=0;i<central.length;i++)csize+=central[i].byteLength;
 const end=new DataView(new ArrayBuffer(22));end.setUint32(0,0x06054b50,true);end.setUint16(8,files.length,true);end.setUint16(10,files.length,true);end.setUint32(12,csize,true);end.setUint32(16,offset,true);
 return new Blob([...parts,...central,end.buffer],{type:"application/zip"});}
function renderSlides(data,images,others){
 result.className="result slides show";
 let i=0;
 const stage=document.createElement("div");stage.className="stage";
 const img=document.createElement("img");img.alt="";img.referrerPolicy="no-referrer";
 const prev=document.createElement("button");prev.type="button";prev.className="nav-btn prev";prev.setAttribute("aria-label","Previous slide");prev.textContent="‹";
 const next=document.createElement("button");next.type="button";next.className="nav-btn next";next.setAttribute("aria-label","Next slide");next.textContent="›";
 stage.append(prev,img,next);
 const info=document.createElement("p");info.className="slide-info";
 const title=document.createElement("p");title.className="result-title";title.textContent=data.title||"TikTok";
 const actions=document.createElement("div");actions.className="result-actions";
 const one=mkBtn("Download this slide"),all=mkBtn("Download all (ZIP)","alt");
 actions.append(one,all);others.forEach(f=>actions.appendChild(mkLink(f,"alt")));
 const cache=new Map();
 function loadBlob(n){if(!cache.has(n)){cache.set(n,fetch(images[n].url+"&inline=1").then(r=>{if(!r.ok)throw new Error("Gagal memuat slide "+(n+1));return r.blob();}).then(b=>URL.createObjectURL(b)).catch(e=>{cache.delete(n);throw e;}));}return cache.get(n);}
 const msg=document.createElement("p");msg.className="stage-msg";stage.appendChild(msg);
 async function show(){const n=i,f=images[n];
  stage.style.setProperty("--ar",f.width&&f.height?f.width+"/"+f.height:"3/4");
  info.textContent=`${n+1} / ${images.length}`+(f.width&&f.height?` • ${f.width} × ${f.height} px`:"");
  prev.disabled=images.length<2;next.disabled=images.length<2;
  stage.classList.add("loading");msg.textContent="Memuat...";img.style.visibility="hidden";
  try{const u=await loadBlob(n);if(n!==i)return;img.onload=()=>{if(n===i){img.style.visibility="visible";stage.classList.remove("loading");msg.textContent="";}};img.src=u;
   [n+1,n-1].forEach(k=>{if(k>=0&&k<images.length)loadBlob(k).catch(()=>{});});}
  catch(e){if(n!==i)return;stage.classList.add("loading");msg.textContent=e.message||"Gagal memuat slide";}}
 prev.onclick=()=>{i=(i-1+images.length)%images.length;show();};
 next.onclick=()=>{i=(i+1)%images.length;show();};
 stage.addEventListener("keydown",e=>{if(e.key==="ArrowLeft")prev.click();if(e.key==="ArrowRight")next.click();});stage.tabIndex=0;
 let sx=null;stage.addEventListener("touchstart",e=>{sx=e.touches[0].clientX;},{passive:true});stage.addEventListener("touchend",e=>{if(sx===null)return;const dx=e.changedTouches[0].clientX-sx;sx=null;if(Math.abs(dx)>45)(dx<0?next:prev).click();});
 one.onclick=()=>{const a=document.createElement("a");a.href=images[i].url;a.setAttribute("download","");document.body.appendChild(a);a.click();a.remove();};
 all.onclick=async()=>{all.disabled=true;const label=all.lastChild;
  try{const files=[];for(let n=0;n<images.length;n++){label.textContent=`Menyiapkan ${n+1}/${images.length}...`;const r=await fetch(images[n].url);if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.error||"Gagal mengambil slide "+(n+1));}files.push({name:`slide-${String(n+1).padStart(2,"0")}.${r.headers.get("x-file-ext")||"jpg"}`,data:new Uint8Array(await r.arrayBuffer())});}
   saveBlob(buildZip(files),"fetchio-slides.zip");}
  catch(e){showNotice(e.message||"Gagal membuat ZIP","error");}
  finally{label.textContent="Download all (ZIP)";all.disabled=false;}};
 result.replaceChildren(stage,info,title,actions);show();
}
function fmtDate(v){if(!v)return null;const d=new Date(v);return isNaN(d)?String(v):d.toLocaleString("id-ID",{dateStyle:"long",timeStyle:"short"});}
function fmtNum(n){return typeof n==="number"?n.toLocaleString("id-ID"):null;}
function fmtDur(s){if(!s)return null;s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return h?`${h}:${String(m).padStart(2,"0")}:${String(x).padStart(2,"0")}`:`${m}:${String(x).padStart(2,"0")}`;}
function mkLine(label,value){const p=document.createElement("p");p.className="yt-line";const b=document.createElement("b");b.textContent=label+": ";p.append(b,document.createTextNode(value));return p;}
function fmtSize(n){return n?(n>=1048576?(n/1048576).toFixed(1)+" MB":Math.round(n/1024)+" KB"):"";}
function mkFmtBtn(f){const a=document.createElement("a");const isAudio=f.type==="audio";a.className="fmt-btn"+(isAudio?" audio":"");if(!/^https?:\/\//i.test(f.url))return document.createComment("");a.href=f.url;a.rel="noopener noreferrer";a.setAttribute("download","");
 const ic=document.createElement("span");ic.className="fmt-ic";ic.innerHTML=ICON;
 const tx=document.createElement("span");tx.className="fmt-tx";
 const ext=(f.ext||(isAudio?"mp3":"mp4")).toUpperCase();
 const q=isAudio?(f.bitrate?Math.round(f.bitrate/1000)+" kbps":""):(f.height?f.height+"p":(f.quality&&f.quality!=="video"?f.quality:""));
 const n=document.createElement("b");n.textContent=ext+(q?" "+q:"");
 const sub=[isAudio?"Audio":"Video",fmtSize(f.size),!isAudio&&f.hasAudio===false?"tanpa audio":""].filter(Boolean).join(" · ");
 tx.appendChild(n);if(sub){const sm=document.createElement("small");sm.textContent=sub;tx.appendChild(sm);}
 a.append(ic,tx);return a;}
function renderYouTube(data){
 result.className="result yt show";
 const F=(data.formats||[]).filter(f=>f.type==="video"||f.type==="audio");
 const thumb=data.thumbnail||(data.thumbnails&&data.thumbnails[0]&&data.thumbnails[0].url);
 const body=document.createElement("div");body.className="yt-body";
 if(thumb){const img=document.createElement("img");img.className="yt-thumb";img.alt="";img.referrerPolicy="no-referrer";const tl=(data.thumbnails||[]).map(x=>x.url).filter(u=>/^https:\/\//i.test(u));if(!tl.length)tl.push(thumb);let ti=0;img.addEventListener("error",()=>{ti++;if(ti<tl.length)img.src=tl[ti];else img.remove();});img.addEventListener("load",()=>{if(img.naturalWidth<=120&&ti<tl.length-1){ti++;img.src=tl[ti];}});img.src=tl[0];body.appendChild(img);}
 const pad=document.createElement("div");pad.className="yt-pad";
 const t=document.createElement("p");t.className="result-title";t.textContent=data.title||"YouTube";pad.appendChild(t);
 const metaTxt=[fmtDur(data.duration),data.views!=null?fmtNum(data.views)+" views":null].filter(Boolean).join(" • ");
 if(metaTxt){const m=document.createElement("p");m.className="result-meta";m.textContent=metaTxt;pad.appendChild(m);}
 const info=document.createElement("div");info.className="yt-info";
 const ch=data.channel||{};
 if(ch.name)info.appendChild(mkLine("Creator",ch.name+(ch.handle?" ("+ch.handle+")":"")));
 if(ch.subscribersText||ch.subscribers!=null)info.appendChild(mkLine("Subscriber",(ch.subscribers!=null?"≈ "+fmtNum(ch.subscribers):"")+(ch.subscribersText?" ("+ch.subscribersText+")":"")));
 const up=fmtDate(data.publishedAt||data.uploadedAt);
 if(up)info.appendChild(mkLine("Diupload",up));
 if(data.editedAt)info.appendChild(mkLine("Terakhir diedit",fmtDate(data.editedAt)));
 if(data.description){const d=document.createElement("details");const sm=document.createElement("summary");sm.textContent="Deskripsi";const pre=document.createElement("pre");pre.className="yt-desc";pre.textContent=data.description;d.append(sm,pre);info.appendChild(d);}
 if(data.captions&&data.captions.length){const d=document.createElement("details");const sm=document.createElement("summary");sm.textContent="Caption ("+data.captions.length+")";d.appendChild(sm);
  data.captions.forEach(c=>{const row=document.createElement("div");row.className="yt-cap";const n=document.createElement("span");n.textContent=c.name+(c.auto?" (otomatis)":"")+" · "+c.languageCode;row.appendChild(n);
   const a=document.createElement("div");a.className="yt-cap-links";c.downloads.forEach(x=>{const l=document.createElement("a");l.href=x.url;l.setAttribute("download","");l.textContent=x.ext.toUpperCase();a.appendChild(l);});row.appendChild(a);d.appendChild(row);});
  info.appendChild(d);}
 if(info.childNodes.length)pad.appendChild(info);
 if(F.length){const grid=document.createElement("div");grid.className="fmt-grid";
  const vids=F.filter(f=>f.type==="video").sort((x,y)=>(y.height||0)-(x.height||0)),auds=F.filter(f=>f.type==="audio");
  [...vids,...auds].forEach(f=>grid.appendChild(mkFmtBtn(f)));pad.appendChild(grid);}
 if(data.warning){const w=document.createElement("p");w.className="result-meta";w.textContent="⚠ "+data.warning;pad.appendChild(w);}
 body.appendChild(pad);result.replaceChildren(body);
}
function renderResult(data){
 result.className="result";result.replaceChildren();
 if(data.platform==="youtube"){renderYouTube(data);return;}
 const images=data.formats.filter(f=>f.type==="image");
 if(images.length){renderSlides(data,images,data.formats.filter(f=>f.type!=="image"));return;}
 if(data.thumbnail){const img=document.createElement("img");img.src=data.thumbnail;img.alt="";img.referrerPolicy="no-referrer";img.addEventListener("error",()=>img.remove());result.appendChild(img);}
 const body=document.createElement("div");body.className="result-body";
 const t=document.createElement("p");t.className="result-title";t.textContent=data.title||"TikTok";body.appendChild(t);
 const m=document.createElement("p");m.className="result-meta";m.textContent=[data.author,data.duration?Math.round(data.duration)+" dtk":null].filter(Boolean).join(" • ");body.appendChild(m);
 const actions=document.createElement("div");actions.className="result-actions";
 data.formats.forEach(f=>actions.appendChild(mkLink(f,f.type==="video"?"":"alt")));
 body.appendChild(actions);result.appendChild(body);result.classList.add("show");
}
form.addEventListener("submit",async event=>{
 event.preventDefault();const url=input.value.trim();
 result.classList.remove("show");
 try{
  const parsed=new URL(url);if(!["http:","https:"].includes(parsed.protocol))throw new Error("Gunakan URL HTTP atau HTTPS yang valid");
  downloadButton.disabled=true;showNotice("Memproses tautan...");
  const response=await fetch("/download",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||"Permintaan gagal");
  showNotice("");renderResult(data.data);
 }catch(error){showNotice(error.message||"Terjadi kesalahan saat memproses tautan.","error");}
 finally{downloadButton.disabled=false;}
});

/* smooth scroll for in-page links without leaving "#" in the URL */
function goTo(id){const el=id==="top"?document.body:document.getElementById(id);if(!el)return false;el.scrollIntoView({behavior:"smooth",block:id==="top"?"start":"start"});history.replaceState(null,"",location.pathname+location.search.replace(/[?&]to=[^&]*/,"").replace(/^&/,"?"));return true;}
document.querySelectorAll('a[href^="#"]').forEach(a=>a.addEventListener("click",e=>{const id=a.getAttribute("href").slice(1);if(id&&goTo(id))e.preventDefault();}));
const to=new URLSearchParams(location.search).get("to");if(to)setTimeout(()=>goTo(to),80);
