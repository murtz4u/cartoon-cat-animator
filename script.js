/* Cartoon Cat Animator - client script */
const $ = (sel)=>document.querySelector(sel);
const stage = $("#stage");
const ctx = stage.getContext("2d");
const brush = document.createElement("canvas");
brush.width = stage.width; brush.height = stage.height;
const btx = brush.getContext("2d");

let sourceImage = null; // ImageBitmap
let cutoutCanvas = document.createElement('canvas');
let cutCtx = cutoutCanvas.getContext('2d');

let frames = []; // [{tx,ty,scale,rot, doodle:ImageData or canvas }]
let active = 0;
let playing = false;
let rafId = null;
let holding = false;
let mode = "move"; // draw? erase?
let pointerPrev = null;

// Minimal UI fallbacks (if you used the shorter index.html)
const ensure = (id, html) => {
  if (!document.getElementById(id)) {
    const div = document.createElement("div");
    div.innerHTML = html.trim();
    const el = div.firstChild;
    document.querySelector(".controls")?.appendChild(el);
  }
};
ensure("thr", `<label>Background removal threshold <input id="thr" type="range" min="0" max="255" value="235"></label>`);
ensure("hue", `<label>Hue <input id="hue" type="range" min="-180" max="180" value="0"></label>`);
ensure("sat", `<label>Saturation <input id="sat" type="range" min="0" max="3" step="0.01" value="1"></label>`);
ensure("bri", `<label>Brightness <input id="bri" type="range" min="0" max="2" step="0.01" value="1"></label>`);
ensure("fps", `<label>Frames per second <input id="fps" type="range" min="1" max="24" value="8"></label>`);
ensure("onion", `<label><input id="onion" type="checkbox"> Onion skin</label>`);
ensure("brushSize", `<label>Brush Size <input id="brushSize" type="range" min="1" max="40" value="6"></label>`);
ensure("brushAlpha", `<label>Brush Opacity <input id="brushAlpha" type="range" min="0.1" max="1" step="0.05" value="0.9"></label>`);
if (!document.getElementById("brushColor")) {
  const color = document.createElement("input");
  color.type = "color"; color.id = "brushColor"; color.value = "#ff9900";
  document.querySelector(".controls")?.appendChild(color);
}
ensure("erase", `<button id="erase">Eraser</button>`);
ensure("clearBrush", `<button id="clearBrush">Clear Frame Doodles</button>`);

// Defaults
function defaultFrame(){
  return { tx:stage.width/2, ty:stage.height/2, scale:1, rot:0, doodle:null };
}

function addFrame(copy=null){
  const f = copy ? structuredClone(copy) : defaultFrame();
  frames.push(f);
  active = frames.length-1;
  paintTimeline();
  draw();
}

function deleteFrame(idx){
  if(frames.length===0) return;
  frames.splice(idx,1);
  active = Math.max(0, active-1);
  paintTimeline();
  draw();
}

function duplicateFrame(){
  if(frames.length===0) return;
  addFrame(frames[active]);
}

function paintTimeline(){
  const t = document.getElementById("timeline");
  if(!t) return;
  t.innerHTML = "";
  frames.forEach((f,i)=>{
    const d = document.createElement("div");
    d.className = "frame-thumb"+(i===active?" active":"");
    d.title = "Frame "+(i+1);
    const c = document.createElement("canvas");
    c.width = 96; c.height = 54;
    const x = c.getContext("2d");
    x.fillStyle="#0b1020"; x.fillRect(0,0,c.width,c.height);
    if(sourceImage){
      x.save();
      x.translate(c.width/2, c.height/2);
      const scale = f.scale * 0.1;
      x.rotate(f.rot);
      x.drawImage(cutoutCanvas, -cutoutCanvas.width*scale/2, -cutoutCanvas.height*scale/2, cutoutCanvas.width*scale, cutoutCanvas.height*scale);
      x.restore();
    }
    if(f.doodle){
      x.drawImage(f.doodle,0,0,c.width,c.height);
    }
    const label = document.createElement("span");
    label.textContent = i+1;
    d.appendChild(c);
    d.appendChild(label);
    d.addEventListener("click", ()=>{ active=i; paintTimeline(); draw(); });
    t.appendChild(d);
  });
}

function hsbAdjust(imgData, hue, sat, bri){
  const d = imgData.data;
  for(let i=0;i<d.length;i+=4){
    let r=d[i], g=d[i+1], b=d[i+2], a=d[i+3];
    if(a===0) continue;
    const rf=r/255, gf=g/255, bf=b/255;
    const max=Math.max(rf,gf,bf), min=Math.min(rf,gf,bf);
    let h,s,l=(max+min)/2;
    if(max===min){ h=0; s=0; }
    else{
      const dlt=max-min;
      s = l>0.5 ? dlt/(2-max-min) : dlt/(max+min);
      switch(max){
        case rf: h=(gf-bf)/dlt + (gf<bf?6:0); break;
        case gf: h=(bf-rf)/dlt + 2; break;
        case bf: h=(rf-gf)/dlt + 4; break;
      }
      h/=6;
    }
    h = (h + hue/360) % 1; if(h<0) h+=1;
    s = Math.min(1, Math.max(0, s*sat));
    l = Math.min(1, Math.max(0, l*bri));
    function hue2rgb(p,q,t){ if(t<0) t+=1; if(t>1) t-=1;
      if(t<1/6) return p + (q-p)*6*t;
      if(t<1/2) return q;
      if(t<2/3) return p + (q-p)*(2/3 - t)*6;
      return p;
    }
    let r2,g2,b2;
    if(s===0){ r2=g2=b2=l; }
    else{
      const q = l<0.5 ? l*(1+s) : l + s - l*s;
      const p = 2*l - q;
      r2 = hue2rgb(p,q,h+1/3);
      g2 = hue2rgb(p,q,h);
      b2 = hue2rgb(p,q,h-1/3);
    }
    d[i] = Math.round(r2*255);
    d[i+1] = Math.round(g2*255);
    d[i+2] = Math.round(b2*255);
  }
  return imgData;
}

async function makeCutout(imgBitmap){
  cutoutCanvas.width = imgBitmap.width;
  cutoutCanvas.height = imgBitmap.height;
  cutCtx.clearRect(0,0,cutoutCanvas.width,cutoutCanvas.height);
  cutCtx.drawImage(imgBitmap,0,0);
  applyProcessing();
}

function applyProcessing(){
  if(!sourceImage) return;
  const thr = +document.getElementById("thr").value;
  const hue = +document.getElementById("hue").value;
  const sat = +document.getElementById("sat").value;
  const bri = +document.getElementById("bri").value;

  let imgData = cutCtx.getImageData(0,0,cutoutCanvas.width,cutoutCanvas.height);
  const d = imgData.data;
  for(let i=0;i<d.length;i+=4){
    const r=d[i], g=d[i+1], b=d[i+2];
    const bright = (r+g+b)/3;
    if(bright>=thr){ d[i+3]=0; }
  }
  imgData = hsbAdjust(imgData, hue, sat, bri);
  cutCtx.putImageData(imgData,0,0);
  draw();
}

function draw(){
  ctx.clearRect(0,0,stage.width,stage.height);
  ctx.fillStyle="#0b1020";
  ctx.fillRect(0,0,stage.width,stage.height);

  if(frames.length===0){
    ctx.fillStyle="#94a3b8";
    ctx.font="16px ui-monospace,monospace";
    ctx.fillText("Import an image, tweak threshold, then Add Frame.", 24, 32);
    return;
  }
  const f = frames[active];
  if(document.getElementById("onion")?.checked && active>0){
    const pf = frames[active-1];
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.translate(pf.tx, pf.ty);
    ctx.rotate(pf.rot);
    ctx.scale(pf.scale, pf.scale);
    ctx.drawImage(cutoutCanvas, -cutoutCanvas.width/2, -cutoutCanvas.height/2);
    ctx.restore();
  }

  ctx.save();
  ctx.translate(f.tx, f.ty);
  ctx.rotate(f.rot);
  ctx.scale(f.scale, f.scale);
  if(sourceImage) ctx.drawImage(cutoutCanvas, -cutoutCanvas.width/2, -cutoutCanvas.height/2);
  ctx.restore();

  // doodle overlay
  if(f.doodle) ctx.drawImage(f.doodle,0,0,stage.width,stage.height);

  ctx.strokeStyle="#1f2937";
  ctx.strokeRect(0,0,stage.width,stage.height);
}

function pointerPos(e){
  const rect = stage.getBoundingClientRect();
  const x = (e.touches?e.touches[0].clientX:e.clientX) - rect.left;
  const y = (e.touches?e.touches[0].clientY:e.clientY) - rect.top;
  return { x: x*stage.width/rect.width, y: y*stage.height/rect.height };
}

// interaction
stage.addEventListener("pointerdown", (e)=>{
  holding=true; pointerPrev = pointerPos(e);
  if(e.shiftKey){ mode="rotate"; }
  else if(e.ctrlKey||e.metaKey){ mode="scale"; }
  else if(e.altKey){ mode="draw"; }
  else if(document.getElementById("erase")?.dataset.active==="1"){ mode="erase"; }
  else { mode="move"; }
});
["pointerup","pointercancel","pointerleave"].forEach(ev=>stage.addEventListener(ev, ()=>{ holding=false; pointerPrev=null; }));
stage.addEventListener("pointermove", (e)=>{
  if(!holding || frames.length===0) return;
  const now = pointerPos(e);
  const f = frames[active];
  if(mode==="move"){
    f.tx += now.x - pointerPrev.x;
    f.ty += now.y - pointerPrev.y;
  } else if(mode==="rotate"){
    const a1 = Math.atan2(pointerPrev.y - f.ty, pointerPrev.x - f.tx);
    const a2 = Math.atan2(now.y - f.ty, now.x - f.tx);
    f.rot += (a2-a1);
  } else if(mode==="scale"){
    const d1 = Math.hypot(pointerPrev.x - f.tx, pointerPrev.y - f.ty);
    const d2 = Math.hypot(now.x - f.tx, now.y - f.ty);
    if(d1>0) f.scale *= (d2/d1);
    f.scale = Math.max(0.1, Math.min(5, f.scale));
  } else if(mode==="draw" || mode==="erase"){
    if(!f._doodleCanvas){
      f._doodleCanvas = document.createElement("canvas");
      f._doodleCanvas.width = stage.width;
      f._doodleCanvas.height = stage.height;
      f._dtx = f._doodleCanvas.getContext("2d");
      f._dtx.lineCap="round";
      f._dtx.lineJoin="round";
    }
    const dtx = f._dtx;
    dtx.globalCompositeOperation = (mode==="erase") ? "destination-out" : "source-over";
    dtx.strokeStyle = document.getElementById("brushColor").value || "#ff9900";
    dtx.globalAlpha = +document.getElementById("brushAlpha").value || 0.9;
    dtx.lineWidth = +document.getElementById("brushSize").value || 6;
    dtx.beginPath();
    dtx.moveTo(pointerPrev.x, pointerPrev.y);
    dtx.lineTo(now.x, now.y);
    dtx.stroke();
    f.doodle = f._doodleCanvas;
  }
  pointerPrev = now;
  paintTimeline();
  draw();
});

// IO
document.getElementById("fileInput")?.addEventListener("change", async (e)=>{
  const file = e.target.files[0];
  if(file){
    const img = await createImageBitmap(file);
    sourceImage = img;
    await makeCutout(img);
    if(frames.length===0) addFrame();
  }
});

document.getElementById("snapBtn")?.addEventListener("click", async ()=>{
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    alert("Camera not available in this browser.");
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ video:true });
  const video = document.createElement("video");
  video.srcObject = stream;
  await video.play();
  const cap = document.createElement("canvas");
  cap.width = video.videoWidth; cap.height = video.videoHeight;
  const vtx = cap.getContext("2d");
  vtx.drawImage(video,0,0);
  stream.getTracks().forEach(t=>t.stop());
  const blob = await new Promise(res=>cap.toBlob(res,"image/png"));
  const img = await createImageBitmap(blob);
  sourceImage = img;
  await makeCutout(img);
  if(frames.length===0) addFrame();
});

document.getElementById("clearImage")?.addEventListener("click", ()=>{
  sourceImage=null;
  cutoutCanvas.width = stage.width;
  cutoutCanvas.height = stage.height;
  cutCtx.clearRect(0,0,cutoutCanvas.width,cutoutCanvas.height);
  draw();
});

// controls
["thr","hue","sat","bri"].forEach(id=>{
  document.getElementById(id)?.addEventListener("input", applyProcessing);
});
document.getElementById("addFrame")?.addEventListener("click", ()=> addFrame());
document.getElementById("dupFrame")?.addEventListener("click", ()=> duplicateFrame());
document.getElementById("delFrame")?.addEventListener("click", ()=> { if(frames.length){ deleteFrame(active); } });

// brush controls
document.getElementById("erase")?.addEventListener("click", (e)=>{
  e.target.dataset.active = e.target.dataset.active==="1" ? "0":"1";
  e.target.textContent = e.target.dataset.active==="1" ? "Eraser ✓" : "Eraser";
});
document.getElementById("clearBrush")?.addEventListener("click", ()=>{
  const f = frames[active];
  if(!f) return;
  f.doodle = null;
  f._doodleCanvas = null;
  paintTimeline();
  draw();
});

// FPS & playback
document.getElementById("fps")?.addEventListener("input", (e)=>{/* UI shows value in full version */});
document.getElementById("play")?.addEventListener("click", ()=>{
  if(playing || frames.length===0) return;
  playing=true;
  let i=0;
  const step = ()=>{
    if(!playing) return;
    active = i%frames.length;
    paintTimeline();
    draw();
    i++;
    const fps = +document.getElementById("fps").value || 8;
    rafId = setTimeout(()=>requestAnimationFrame(step), 1000/fps);
  };
  step();
});
document.getElementById("stop")?.addEventListener("click", ()=>{
  playing=false;
  if(rafId){ clearTimeout(rafId); rafId=null; }
});

// Export WebM using MediaRecorder
document.getElementById("exportWebM")?.addEventListener("click", async ()=>{
  if(frames.length===0){ alert("Nothing to export."); return; }
  const fps = +document.getElementById("fps").value || 8;
  const stream = stage.captureStream(fps);
  const opts = { mimeType: 'video/webm;codecs=vp9' };
  let rec;
  try { rec = new MediaRecorder(stream, opts); }
  catch { rec = new MediaRecorder(stream); }
  let chunks = [];
  rec.ondataavailable = e => { if(e.data.size>0) chunks.push(e.data); };
  rec.onstop = ()=>{
    const blob = new Blob(chunks, {type:'video/webm'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cartoon-cat.webm";
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 2000);
  };
  rec.start();

  let i=0, total = frames.length*2;
  const drawFrame = ()=>{
    active = i%frames.length;
    paintTimeline();
    draw();
    i++;
    if(i<total) setTimeout(drawFrame, 1000/fps);
    else { rec.stop(); }
  };
  drawFrame();
});

// initial
paintTimeline();
draw();
