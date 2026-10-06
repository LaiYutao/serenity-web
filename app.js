import { Simulation, WIDTH, HEIGHT, STEP, GLYPHS, NOTES, clamp, selectionBounds } from './simulation.js';
import { SoundEngine } from './audio.js';
import { translate, readLanguage } from './i18n.js';

const $=selector=>document.querySelector(selector);
let language='zh', noticeKey='';
try{language=readLanguage(window.localStorage);}catch{}
const t=(key,values)=>translate(language,key,values);
const sim=new Simulation(), sound=new SoundEngine();
const canvas=$('#field'), context=canvas.getContext('2d',{alpha:false});
const point={x:119,y:69}, keys=new Set();
let started=false, paused=false, type='circle', amplitude=1, frequency=.25;
let accumulator=0, previous=performance.now(), dirty=true, pendingPlant=null;
let soundRegions=[], selectingRegion=false, regionDrag=null, regionOverlayDirty=true;
const regionOverlay=document.createElement('canvas');
regionOverlay.width=canvas.width;regionOverlay.height=canvas.height;
const regionOverlayContext=regionOverlay.getContext('2d');
function currentRegions(){return regionDrag?[...soundRegions,regionDrag.bounds]:soundRegions;}
function audioDistribution(){return sim.distributionFor(currentRegions());}
function syncRegion(){
  const regions=currentRegions(), region=regions[0];
  $('#select-region').disabled=!started;
  $('#select-region').textContent=t(selectingRegion?(soundRegions.length?'regionDone':'regionCancel'):soundRegions.length?'regionAdd':'regionSelect');
  $('#select-region').setAttribute('aria-pressed',selectingRegion);
  $('#clear-region').disabled=!region;
  $('#region-status').textContent=selectingRegion&&!region?t('regionPrompt'):region
    ?(regions.length>1?t('regionCount',{count:regions.length}):t('regionSize',{width:region.right-region.left+1,height:region.bottom-region.top+1,x:region.left,y:region.top}))
    :t('regionGlobal');
  $('.canvas-hint').textContent=t(selectingRegion?'dragHint':'canvasHint');
  regionOverlayDirty=true;dirty=true;
}
function cancelRegionDrag(){
  const pointerId=regionDrag?.pointerId;
  regionDrag=null;
  if(pointerId!==undefined&&canvas.hasPointerCapture(pointerId))canvas.releasePointerCapture(pointerId);
}
function clearRegion(){
  cancelRegionDrag();soundRegions=[];selectingRegion=false;syncRegion();sound.update(audioDistribution());
}
const bars=NOTES.map((note,i)=>{
  if(!note)return null;
  const bar=document.createElement('span');bar.title=`${note} Hz`;$('#spectrum').append(bar);return bar;
});

// Cache the glyph rasterization; drawImage avoids 36,000 text layouts per frame.
const atlas=document.createElement('canvas');atlas.width=13*6;atlas.height=6;
const ink=atlas.getContext('2d');ink.font='7px monospace';ink.textBaseline='middle';ink.textAlign='center';
for(let i=0;i<13;i++){
  ink.fillStyle='#131c16';ink.fillRect(i*6,0,6,6);
  ink.fillStyle=`rgb(${107+i*9},${123+i*9},${93+i*8})`;
  ink.fillText(GLYPHS[i],i*6+3,3.3);
}

function notify(key=''){noticeKey=key;$('#notice').textContent=key?t(key):'';}
function applyLanguage(next){
  language=next==='en'?'en':'zh';
  try{window.localStorage.setItem('serenity-language',language);}catch{}
  document.documentElement.lang=language==='en'?'en':'zh-CN';
  document.title=t('title');
  document.querySelectorAll('[data-i18n]').forEach(element=>{element.textContent=t(element.dataset.i18n);});
  document.querySelectorAll('[data-i18n-aria]').forEach(element=>{element.setAttribute('aria-label',t(element.dataset.i18nAria));});
  document.querySelectorAll('[data-language]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.language===language));
  syncSelection();syncRegion();refreshStatus();setMode(sound.mode);
  $('#mute').textContent=t(sound.muted?'muted':'soundOn');
  notify(noticeKey);
}
function selected(){return sim.at(point.x,point.y);}
function selectType(next){type=next;document.querySelectorAll('[data-type]').forEach(button=>{const active=button.dataset.type===type;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);});}
function syncSelection(){
  const field=selected();
  if(field){amplitude=field.amplitude;frequency=field.frequency;selectType(field.type);}
  $('#amplitude').value=amplitude;$('#frequency').value=frequency;
  $('#amplitude-value').textContent=amplitude;$('#frequency-value').textContent=`${frequency.toFixed(2)} Hz`;
  $('#parameter-hint').textContent=t(field?'editing':'nextSource');
  $('#selection').textContent=field?t('selected',{type:t(field.type),x:field.x,y:field.y}):t('choosePosition');
  $('#plant').textContent=t(field?'occupied':'plant');$('#plant').disabled=!!field;
  dirty=true;
}
function refreshStatus(){
  $('#position').textContent=`${Math.round(point.x)}, ${Math.round(point.y)}`;
  $('#circle-count').textContent=String(sim.fields.filter(f=>f.type==='circle').length).padStart(2,'0');
  $('#spiral-count').textContent=String(sim.fields.filter(f=>f.type==='spiral').length).padStart(2,'0');
  const seconds=Math.floor(sim.time);$('#elapsed').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  $('#play-state').textContent=t(!started?'waiting':paused?'paused':document.hidden?'background':'playing');
  $('#live-dot').classList.toggle('live',started&&!paused&&!document.hidden);
  $('#pause').disabled=!started;$('#pause').textContent=t(paused?'resume':'pause');
  $('#pause-overlay').hidden=!paused;
  const distribution=audioDistribution();
  const max=Math.max(1,...distribution.filter((_,i)=>i!==6));
  bars.forEach((bar,i)=>{if(bar)bar.style.height=`${2+60*distribution[i]/max}px`;});
  sound.running=started&&!paused&&!document.hidden;sound.update(distribution);
}
function draw(){
  context.imageSmoothingEnabled=false;
  for(let i=0;i<sim.bins.length;i++)context.drawImage(atlas,sim.bins[i]*6,0,6,6,(i%WIDTH)*6,Math.floor(i/WIDTH)*6,6,6);
  const px=Math.round(point.x)*6+3,py=Math.round(point.y)*6+3;
  context.strokeStyle='#e9daa6';context.lineWidth=2;context.beginPath();
  context.moveTo(px-19,py);context.lineTo(px-8,py);context.moveTo(px+8,py);context.lineTo(px+19,py);
  context.moveTo(px,py-19);context.lineTo(px,py-8);context.moveTo(px,py+8);context.lineTo(px,py+19);context.stroke();
  const regions=currentRegions();
  if(regions.length){
    if(regionOverlayDirty){
      regionOverlayContext.clearRect(0,0,canvas.width,canvas.height);
      regionOverlayContext.fillStyle='#08100a55';
      regionOverlayContext.fillRect(0,0,canvas.width,canvas.height);
      // Clear the union of all rectangles, including overlaps and nested boxes.
      for(const region of regions)regionOverlayContext.clearRect(region.left*6,region.top*6,(region.right-region.left+1)*6,(region.bottom-region.top+1)*6);
      regionOverlayDirty=false;
    }
    context.drawImage(regionOverlay,0,0);
    context.save();context.strokeStyle='#efe2a9';context.lineWidth=3;
    for(const region of regions){
      const x=region.left*6,y=region.top*6,w=(region.right-region.left+1)*6,h=(region.bottom-region.top+1)*6;
      context.setLineDash(region===regionDrag?.bounds?[10,6]:[]);
      context.strokeRect(x+1.5,y+1.5,Math.max(3,w-3),Math.max(3,h-3));
    }
    context.restore();
  }
  refreshStatus();dirty=false;
}
async function begin(){
  started=true;paused=false;$('#welcome').hidden=true;previous=performance.now();accumulator=0;syncRegion();dirty=true;
  try{await sound.start();sound.running=started&&!paused&&!document.hidden;sound.update(audioDistribution());}
  catch{notify('audioUnavailable');}
}
function plant(next=type){
  if(!started)void begin();
  if(sim.at(point.x,point.y)){syncSelection();return;}
  const field=sim.plant(next,point.x,point.y,amplitude,frequency);
  if(!field){notify('fieldLimit');return;}
  point.x=field.x;point.y=field.y;selectType(next);syncSelection();notify('');
}
function reset(){
  clearTimeout(pendingPlant);pendingPlant=null;keys.clear();sim.reset();point.x=119;point.y=69;accumulator=0;
  clearRegion();
  amplitude=1;frequency=.25;syncSelection();refreshStatus();notify('');
}
function stop(){reset();started=false;paused=false;$('#welcome').hidden=false;syncRegion();dirty=true;refreshStatus();}
function togglePause(){if(!started)return;paused=!paused;keys.clear();accumulator=0;previous=performance.now();dirty=true;refreshStatus();}
function demo(){
  reset();void begin();
  sim.plant('circle',84,65,3,.25);sim.plant('spiral',155,80,3,.2);sim.plant('circle',124,105,2,-.15);
  for(let i=0;i<100;i++)sim.step();
  point.x=84;point.y=65;syncSelection();
}
function adjust(){
  amplitude=Number($('#amplitude').value);frequency=Number($('#frequency').value);
  const field=selected();if(field)field.change(amplitude,frequency,sim.time);
  syncSelection();
}
function setMode(mode){
  sound.mode=mode;document.querySelectorAll('[data-mode]').forEach(button=>{const active=button.dataset.mode===mode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);});
  $('#mode-description').textContent=t(mode==='cluster'?'clusterDescription':'averageDescription');
  sound.update(audioDistribution());
}
async function toggleMute(){
  sound.muted=!sound.muted;$('#mute').textContent=t(sound.muted?'muted':'soundOn');$('#mute').setAttribute('aria-pressed',sound.muted);
  if(started&&!sound.muted){try{await sound.start();}catch{notify('audioUnavailable');}}
  sound.update(audioDistribution());
}
$('#begin').onclick=()=>{notify('');void begin();};
$('#welcome-demo').onclick=demo;$('#demo').onclick=demo;$('#plant').onclick=()=>plant();
$('#reset').onclick=reset;$('#pause').onclick=togglePause;$('#mute').onclick=toggleMute;
$('#volume').oninput=event=>{sound.volume=Number(event.target.value)/100;sound.update(audioDistribution());};
$('#select-region').onclick=()=>{
  releaseKeys();cancelRegionDrag();selectingRegion=!selectingRegion;syncRegion();
  canvas.focus({preventScroll:true});
};
$('#clear-region').onclick=clearRegion;
document.querySelectorAll('[data-language]').forEach(button=>button.onclick=()=>applyLanguage(button.dataset.language));
$('#amplitude').oninput=adjust;$('#frequency').oninput=adjust;
document.querySelectorAll('[data-type]').forEach(button=>button.onclick=()=>selectType(button.dataset.type));
document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>setMode(button.dataset.mode));
$('#help').onclick=()=>{keys.clear();clearTimeout(pendingPlant);$('#help-dialog').showModal();};$('#close-help').onclick=()=>$('#help-dialog').close();
$('#help-dialog').addEventListener('click',event=>{if(event.target===$('#help-dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();}});

function gridPoint(event){
  const rect=canvas.getBoundingClientRect();
  return {x:clamp(Math.floor((event.clientX-rect.left)/rect.width*WIDTH),0,WIDTH-1),
    y:clamp(Math.floor((event.clientY-rect.top)/rect.height*HEIGHT),0,HEIGHT-1)};
}
function locate(event){
  Object.assign(point,gridPoint(event));
  const near=sim.fields.find(f=>Math.hypot(f.x-point.x,f.y-point.y)<=3);
  if(near){point.x=near.x;point.y=near.y;}
  syncSelection();canvas.focus({preventScroll:true});
}
canvas.addEventListener('pointerdown',event=>{
  if(!event.isPrimary||event.button!==0)return;
  if(selectingRegion){
    const start=gridPoint(event);
    regionDrag={pointerId:event.pointerId,start,bounds:selectionBounds(start,start)};syncRegion();
  }else locate(event);
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove',event=>{
  if(regionDrag){
    if(event.pointerId!==regionDrag.pointerId)return;
    regionDrag.bounds=selectionBounds(regionDrag.start,gridPoint(event));syncRegion();
  }else if(!selectingRegion&&event.isPrimary&&event.buttons===1)locate(event);
});
canvas.addEventListener('pointerup',event=>{
  if(!regionDrag||event.pointerId!==regionDrag.pointerId)return;
  soundRegions.push(selectionBounds(regionDrag.start,gridPoint(event)));
  cancelRegionDrag();syncRegion();
});
// Stay in the drawing tool until explicitly exited, so a second drag can
// add another rectangle without planting or moving a field by accident.
canvas.addEventListener('pointercancel',()=>{cancelRegionDrag();syncRegion();});
canvas.addEventListener('lostpointercapture',()=>{if(regionDrag){cancelRegionDrag();syncRegion();}});
canvas.addEventListener('dblclick',event=>{if(!selectingRegion){locate(event);plant();}});

function keyboardAdjust(key){
  const field=selected();if(!field)return;
  const sign=key==='w'?1:-1;
  if(keys.has('j'))$('#amplitude').value=clamp(amplitude+sign,0,6);
  else $('#frequency').value=clamp(Math.round((frequency+sign*.05)*100)/100,-1,1);
  adjust();
}
window.addEventListener('keydown',event=>{
  if(event.ctrlKey||event.metaKey||event.altKey||$('#help-dialog').open||event.target.matches('input,textarea,select'))return;
  const key=event.key.toLowerCase();
  if(key==='escape'&&selectingRegion){event.preventDefault();cancelRegionDrag();selectingRegion=false;syncRegion();return;}
  if(!['w','a','s','d','j','k','m','r','x',' '].includes(key))return;
  // Space on a focused button retains the native accessible activation.
  if(key===' '&&event.target.closest('button'))return;
  event.preventDefault();if(event.repeat)return;keys.add(key);
  if(!started){if(key===' '){void begin();}return;}
  if(key==='j'||key==='k'){
    clearTimeout(pendingPlant);
    if(keys.has('j')&&keys.has('k')){setMode(sound.mode==='cluster'?'average':'cluster');return;}
    // Brief chord window prevents J+K from also planting a source.
    if(!selected())pendingPlant=setTimeout(()=>{plant(key==='j'?'circle':'spiral');pendingPlant=null;},90);
  }else if((key==='w'||key==='s')&&(keys.has('j')||keys.has('k')))keyboardAdjust(key);
  else if(key==='m')void toggleMute();else if(key==='r')reset();else if(key==='x')stop();else if(key===' ')togglePause();
});
window.addEventListener('keyup',event=>keys.delete(event.key.toLowerCase()));
function releaseKeys(){keys.clear();clearTimeout(pendingPlant);pendingPlant=null;if(regionDrag){cancelRegionDrag();syncRegion();}}
window.addEventListener('blur',releaseKeys);
document.addEventListener('visibilitychange',()=>{releaseKeys();accumulator=0;previous=performance.now();refreshStatus();dirty=true;});

function frame(now){
  const dt=Math.min((now-previous)/1000,.15);previous=now;
  if(started&&!paused&&!document.hidden){
    if(!keys.has('j')&&!keys.has('k')){
      const x=point.x,y=point.y;
      point.x=clamp(x+((keys.has('d')?1:0)-(keys.has('a')?1:0))*5*dt,0,WIDTH-1);
      point.y=clamp(y+((keys.has('s')?1:0)-(keys.has('w')?1:0))*5*dt,0,HEIGHT-1);
      if(point.x!==x||point.y!==y){if(Math.round(x)!==Math.round(point.x)||Math.round(y)!==Math.round(point.y))syncSelection();dirty=true;}
    }
    accumulator+=dt;
    while(accumulator>=STEP){sim.step();accumulator-=STEP;dirty=true;}
  }
  if(dirty)draw();requestAnimationFrame(frame);
}
applyLanguage(language);requestAnimationFrame(frame);
