import { FX_PARAMETERS, knobValue, knobPosition, createFXState, delaySeconds, fadeEnvelopeAt } from './effects-dsp.js';
import { Simulation, WIDTH, HEIGHT, STEP, GLYPHS, NOTES, clamp, selectionBounds, gridForViewport } from './simulation.js';
import { SoundEngine, fieldSoundKey } from './audio.js';
import { LoopRecorder, formatTime, loopGain, paginateTracks } from './loops.js';
import { snapshotField, maskFromDrag } from './cycle-dsp.js';
import { translate, readLanguage } from './i18n.js';
import { MixCapture, encodeWav, planCycleExport, loadExportModule } from './recording-export.js';
import { snapshotCycle, startOfflineRender } from './recording-offline.js';
import { installWheelControls } from './wheel-controls.js';

const $=selector=>document.querySelector(selector);
let language='zh', noticeKey='';
let emailToastTimer=null,emailToastKey='';
try{language=readLanguage(window.localStorage);}catch{}
const t=(key,values)=>translate(language,key,values);
const sim=new Simulation(), sound=new SoundEngine();
const recorder=new LoopRecorder(sound);
let exportCapture=null,exportMode='live',cycleLocked=false,exportBusy=false,exportStatusKey='',exportProgress=0;
const canvas=$('#field'), context=canvas.getContext('2d',{alpha:false});
const point={x:119,y:69}, keys=new Set();
let started=false, paused=false, type='circle', amplitude=1, frequency=.25;
let sceneSpeed=1;
let previousAudioTime=null;
let accumulator=0, previous=performance.now(), dirty=true, pendingPlant=null;
let soundRegions=[], selectingRegion=false, regionDrag=null, regionOverlayDirty=true;
const regionOverlay=document.createElement('canvas');
regionOverlay.width=canvas.width;regionOverlay.height=canvas.height;
const regionOverlayContext=regionOverlay.getContext('2d');
function currentRegions(){return regionDrag?[...soundRegions,regionDrag.bounds]:soundRegions;}
function audioDistribution(){return sim.distributionFor(currentRegions());}
function liveSoundKey(){return fieldSoundKey(sim,sound,currentRegions());}
function syncRegion(){
  const regions=currentRegions(), region=regions[0];
  $('#select-region').disabled=!started;
  $('#select-region').setAttribute('aria-label',t(selectingRegion?'regionDone':'regionSelect'));
  $('#select-region').setAttribute('aria-pressed',selectingRegion);
  $('#clear-region').disabled=!region;
  $('#region-status').textContent=selectingRegion?t('regionEditing'):region?t('regionCompact',{count:regions.length}):t('regionAllCompact');
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
const glyphShades=[118, 127, 136, 145, 154, 162, 171, 180, 189, 198, 207, 216, 225];
for(let i=0;i<13;i++){
  ink.fillStyle='#1a1a1a';ink.fillRect(i*6,0,6,6);
  const shade=glyphShades[i];
  ink.fillStyle=`rgb(${shade},${shade},${shade})`;
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
  const manual=$('#download-manual');
  manual.href=`assets/manual/Serenity-User-Guide-${language.toUpperCase()}.pdf?v=export-and-shortcuts`;
  manual.download=`Serenity-User-Guide-${language.toUpperCase()}.pdf`;
  manual.hreflang=language==='en'?'en':'zh-CN';
  syncSelection();syncRegion();refreshStatus();setMode(sound.mode);
  $('#mute').setAttribute('aria-label',t('masterMute'));
  drawWaveform();renderTracks();
  notify(noticeKey);
  if(!$('#copy-toast').hidden)$('#copy-toast').textContent=t(emailToastKey);
  syncExport();if($('#export-dialog').open)syncExportDialog();
}
function selected(){return sim.at(point.x,point.y);}
function selectType(next){type=next;document.querySelectorAll('[data-type]').forEach(button=>{const active=button.dataset.type===type;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);});}
function syncSelection(){
  const field=selected();
  if(field){amplitude=field.amplitude;frequency=field.frequency;selectType(field.type);}
  $('#amplitude').value=amplitude;$('#frequency').value=frequency;
  $('#amplitude-value').textContent=amplitude;$('#frequency-value').textContent=`${frequency.toFixed(2)} Hz`;
  $('#plant').disabled=!!field;$('#plant').title=t(field?'occupied':'plant');
  dirty=true;
}
function refreshStatus(){
  $('#position').textContent=`${Math.round(point.x)}, ${Math.round(point.y)}`;
  $('#circle-count').textContent=String(sim.fields.filter(f=>f.type==='circle').length).padStart(2,'0');
  $('#spiral-count').textContent=String(sim.fields.filter(f=>f.type==='spiral').length).padStart(2,'0');
  const seconds=Math.floor(sim.time);$('#elapsed').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  $('#play-state').textContent=t(!started?'waiting':paused?'paused':document.hidden?'background':'playing');
  $('#live-dot').classList.toggle('live',started&&!paused&&!document.hidden);
  $('#pause').setAttribute('aria-pressed',started&&!paused);
  $('#pause-label').textContent=t(started&&!paused?'pauseAction':'startAction');
  $('#pause').title=t('transportToggle')+' (P / Space)';
  const pauseIcon=$('#pause .icon'),pauseIconPath=`assets/icons/${started&&!paused?'pause-fill':'play-fill'}.svg`;
  if(pauseIcon.getAttribute('src')!==pauseIconPath)pauseIcon.setAttribute('src',pauseIconPath);
  $('#pause-overlay').hidden=!paused;
  const distribution=audioDistribution();
  const max=Math.max(1,...distribution.filter((_,i)=>i!==6));
  bars.forEach((bar,i)=>{if(bar)bar.style.height=`${2+60*distribution[i]/max}px`;});
  sound.setLiveKey(liveSoundKey());sound.running=started&&!paused&&!document.hidden;sound.update(distribution);
}
function draw(){
  context.imageSmoothingEnabled=false;
  for(let i=0;i<sim.bins.length;i++)context.drawImage(atlas,sim.bins[i]*6,0,6,6,(i%sim.width)*6,Math.floor(i/sim.width)*6,6,6);
  const px=Math.round(point.x)*6+3,py=Math.round(point.y)*6+3;
  context.strokeStyle='#dadada';context.lineWidth=2;context.beginPath();
  context.moveTo(px-19,py);context.lineTo(px-8,py);context.moveTo(px+8,py);context.lineTo(px+19,py);
  context.moveTo(px,py-19);context.lineTo(px,py-8);context.moveTo(px,py+8);context.lineTo(px,py+19);context.stroke();
  const regions=currentRegions();
  if(regions.length){
    if(regionOverlayDirty){
      regionOverlayContext.clearRect(0,0,canvas.width,canvas.height);
      regionOverlayContext.fillStyle='#0e0e0e55';
      regionOverlayContext.fillRect(0,0,canvas.width,canvas.height);
      // Clear the union of all rectangles, including overlaps and nested boxes.
      for(const region of regions)regionOverlayContext.clearRect(region.left*6,region.top*6,(region.right-region.left+1)*6,(region.bottom-region.top+1)*6);
      regionOverlayDirty=false;
    }
    context.drawImage(regionOverlay,0,0);
    context.save();context.strokeStyle='#e1e1e1';context.lineWidth=3;
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
  sound.invalidateContinuous();
  clearTimeout(pendingPlant);pendingPlant=null;keys.clear();sim.reset();sim.setDirection(sceneSpeed<0?-1:1);point.x=Math.floor(sim.width/2)-1;point.y=Math.floor(sim.height/2)-6;accumulator=0;
  clearRegion();
  amplitude=1;frequency=.25;syncSelection();refreshStatus();notify('');
}
function stop(){reset();started=false;paused=false;$('#welcome').hidden=false;syncRegion();dirty=true;refreshStatus();}
function togglePause(){if(!started){void begin();return;}paused=!paused;keys.clear();accumulator=0;previous=performance.now();dirty=true;refreshStatus();}
function demo(){
  reset();void begin();
  const dx=Math.floor((sim.width-WIDTH)/2),dy=Math.floor((sim.height-HEIGHT)/2);
  const first=sim.plant('circle',84+dx,65+dy,3,.25);sim.plant('spiral',155+dx,80+dy,3,.2);sim.plant('circle',124+dx,105+dy,2,-.15);
  for(let i=0;i<100;i++)sim.step();
  point.x=first.x;point.y=first.y;syncSelection();
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
  sound.muted=!sound.muted;$('#mute').setAttribute('aria-pressed',sound.muted);
  if(started&&!sound.muted){try{await sound.start();}catch{notify('audioUnavailable');}}
  sound.update(audioDistribution());
}
$('#begin').onclick=()=>{notify('');void begin();};
$('#welcome-demo').onclick=demo;$('#demo').onclick=demo;$('#plant').onclick=()=>plant();
$('#reset').onclick=reset;$('#pause').onclick=togglePause;$('#mute').onclick=toggleMute;
$('#volume').oninput=event=>{sound.volume=Number(event.target.value)/100;$('#volume-value').textContent=event.target.value;sound.update(audioDistribution());};
$('#select-region').onclick=()=>{
  releaseKeys();cancelRegionDrag();selectingRegion=!selectingRegion;syncRegion();
  canvas.focus({preventScroll:true});
};
$('#clear-region').onclick=clearRegion;
document.querySelectorAll('[data-language]').forEach(button=>button.onclick=()=>applyLanguage(button.dataset.language));
function showEmailToast(key){
  clearTimeout(emailToastTimer);emailToastKey=key;
  const toast=$('#copy-toast');toast.textContent=t(key);toast.hidden=false;
  $('.credit-contact').classList.add('copy-feedback');
  emailToastTimer=setTimeout(()=>{toast.hidden=true;$('.credit-contact').classList.remove('copy-feedback');},2000);
}
$('#copy-email').onclick=async()=>{
  const email=$('#credit-email').textContent;
  try{
    try{await navigator.clipboard.writeText(email);}
    catch{
      const input=document.createElement('textarea');input.value=email;input.readOnly=true;
      input.style.cssText='position:fixed;left:-9999px;top:0';document.body.append(input);input.select();
      let copied=false;
      try{copied=document.execCommand('copy');}finally{input.remove();$('#copy-email').focus({preventScroll:true});}
      if(!copied)throw new Error('copy');
    }
    showEmailToast('emailCopied');
  }catch{showEmailToast('emailCopyFailed');}
};
function setSceneSpeed(value){
  advanceField();
  const rounded=Math.round(clamp(value,-4,4)*100)/100;
  // Keep the existing 0.25× minimum on either side of the direction boundary.
  const next=Math.abs(rounded)<.25?(rounded<0||rounded===0&&sceneSpeed<0?-.25:.25):rounded;
  if(Math.sign(next)!==Math.sign(sceneSpeed)){
    if(accumulator>0){sim.step(accumulator);accumulator=0;}
    sim.setDirection(Math.sign(next));
  }
  sceneSpeed=next;sound.speed=Math.abs(sceneSpeed);
  sound.setLiveKey(liveSoundKey());sound.update(audioDistribution());
  $('#speed-range').value=String(sceneSpeed);
  const speedSelect=$('#speed-value');
  speedSelect.querySelector('[data-custom-speed]')?.remove();
  if(!Array.from(speedSelect.options).some(option=>Number(option.value)===sceneSpeed)){
    const option=document.createElement('option');option.value=String(sceneSpeed);option.textContent=`${sceneSpeed.toFixed(2)}×`;option.hidden=true;option.dataset.customSpeed='';speedSelect.append(option);
  }
  speedSelect.value=String(sceneSpeed);
  $('#speed-down').disabled=sceneSpeed===-4;
  $('#speed-up').disabled=sceneSpeed===4;
}
$('#speed-range').oninput=event=>setSceneSpeed(Number(event.target.value));
$('#speed-value').onchange=event=>setSceneSpeed(Number(event.target.value));
$('#speed-down').onclick=()=>setSceneSpeed(sceneSpeed===.25?-.25:sceneSpeed-.25);
$('#speed-up').onclick=()=>setSceneSpeed(sceneSpeed===-.25?.25:sceneSpeed+.25);
$('#amplitude').oninput=adjust;$('#frequency').oninput=adjust;
document.querySelectorAll('[data-type]').forEach(button=>button.onclick=()=>selectType(button.dataset.type));
document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>setMode(button.dataset.mode));
$('#help').onclick=()=>{keys.clear();clearTimeout(pendingPlant);$('#help-dialog').showModal();};$('#close-help').onclick=()=>$('#help-dialog').close();
$('#help-dialog').addEventListener('click',event=>{if(event.target===$('#help-dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();}});

function gridPoint(event){
  const rect=canvas.getBoundingClientRect();
  return {x:clamp(Math.floor((event.clientX-rect.left)/rect.width*sim.width),0,sim.width-1),
    y:clamp(Math.floor((event.clientY-rect.top)/rect.height*sim.height),0,sim.height-1)};
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
    regionDrag={pointerId:event.pointerId,start,bounds:selectionBounds(start,start,sim.width,sim.height)};syncRegion();
  }else locate(event);
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove',event=>{
  if(regionDrag){
    if(event.pointerId!==regionDrag.pointerId)return;
    regionDrag.bounds=selectionBounds(regionDrag.start,gridPoint(event),sim.width,sim.height);syncRegion();
  }else if(!selectingRegion&&event.isPrimary&&event.buttons===1)locate(event);
});
canvas.addEventListener('pointerup',event=>{
  if(!regionDrag||event.pointerId!==regionDrag.pointerId)return;
  soundRegions.push(selectionBounds(regionDrag.start,gridPoint(event),sim.width,sim.height));
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
  if(event.ctrlKey||event.metaKey||event.altKey||$('#help-dialog').open||$('#export-dialog').open||event.target.matches('input,textarea,select'))return;
  const key=event.key.toLowerCase();
  if(key==='escape'&&selectingRegion){event.preventDefault();cancelRegionDrag();selectingRegion=false;syncRegion();return;}
  if(!['w','a','s','d','j','k','m','r','x','o','p',' '].includes(key))return;
  // Space on a focused button retains the native accessible activation.
  if(key===' '&&event.target.closest('button'))return;
  event.preventDefault();if(event.repeat)return;keys.add(key);
  if(key==='o'){$('#record').click();return;}
  if(key==='p'){togglePause();return;}
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

function advanceField(){
  const audioTime=sound.context?.currentTime??performance.now()/1000;
  const dt=audioTime!=null&&previousAudioTime!=null?Math.max(0,audioTime-previousAudioTime):0;
  previousAudioTime=audioTime;
  if(started&&!paused&&!document.hidden){
    accumulator+=dt*Math.abs(sceneSpeed);
    while(accumulator>=STEP){sim.step();accumulator-=STEP;dirty=true;}
  }
}
function frame(now){
  advanceField();
  const dt=Math.min((now-previous)/1000,.15);previous=now;
  if(started&&!paused&&!document.hidden){
    if(!keys.has('j')&&!keys.has('k')){
      const x=point.x,y=point.y;
      point.x=clamp(x+((keys.has('d')?1:0)-(keys.has('a')?1:0))*5*dt,0,sim.width-1);
      point.y=clamp(y+((keys.has('s')?1:0)-(keys.has('w')?1:0))*5*dt,0,sim.height-1);
      if(point.x!==x||point.y!==y){if(Math.round(x)!==Math.round(point.x)||Math.round(y)!==Math.round(point.y))syncSelection();dirty=true;}
    }
  }
  if(dirty)draw();drawTracks(now);requestAnimationFrame(frame);
}
// Displays represent measured or selected data; keys retain fixed action labels.
function drawWaveform(){
  const preview=$('#waveform-preview'),ctx=preview.getContext('2d'),w=preview.width,h=preview.height;
  ctx.clearRect(0,0,w,h);ctx.strokeStyle='#d4d4cf';ctx.lineWidth=2;ctx.beginPath();
  for(let x=0;x<w;x++){
    const phase=x/w*2*Math.PI*1.5;
    let y=Math.sin(phase);
    if(sound.waveform==='triangle')y=2/Math.PI*Math.asin(Math.sin(phase));
    if(sound.waveform==='square')y=Math.sin(phase)>=0?1:-1;
    if(sound.waveform==='sawtooth')y=2*(phase/(2*Math.PI)%1)-1;
    if(sound.waveform==='original')y=(y+.1*Math.sin(phase*2)+.056*Math.sin(phase*3)+.042*Math.sin(phase*4)+.037*Math.sin(phase*5))/1.15;
    const py=h/2-y*h*.32;x?ctx.lineTo(x,py):ctx.moveTo(x,py);
  }
  ctx.stroke();
}
$('#waveform').onchange=event=>{sound.setWaveform(event.target.value);drawWaveform();};
let recordBusy=false,trackDrawTime=0,editTrackId=null,trackPage=0,visibleTracks=[],recordMode='field';
$('#record-mode').onclick=event=>{recordMode=event.target.closest('[data-record-choice]')?.dataset.recordChoice??(recordMode==='field'?'audio':'field');syncRecord();};
$('#record').onclick=async()=>{
  if(recordBusy)return;
  recordBusy=true;$('#record').disabled=true;notify('');
  try{
    if(recorder.directRecording){
      await recorder.stopDirect();trackPage=Math.floor((recorder.tracks.length-1)/3);renderTracks();
    }else{
      if(!started)await begin();
      if(recordMode==='audio')await recorder.startDirect();
      else{
        advanceField();sound.setLiveKey(liveSoundKey());
        const snapshot=snapshotField(sim,currentRegions(),Math.abs(sceneSpeed));snapshot.time+=accumulator;
        await recorder.capture(snapshot,()=>{advanceField();return Math.max(0,sim.time+accumulator-snapshot.time)/snapshot.speed;});
        trackPage=Math.floor((recorder.tracks.length-1)/3);renderTracks();
      }
    }
  }
  catch(error){notify(['recordLimit','recordEmpty'].includes(error.message)?error.message:'recordUnavailable');}
  finally{recordBusy=false;$('#record').disabled=false;syncRecord();}
};
function syncRecord(){
  $('#record').disabled=recordBusy||cycleLocked;
  $('#record').classList.toggle('recording',recorder.recording);
  $('#record').setAttribute('aria-pressed',recorder.recording);
  $('#record-mode').disabled=recordBusy||recorder.recording||cycleLocked;
  $('#record-mode').setAttribute('aria-checked',recordMode==='audio');
  $('#record-mode').title=t('recordMode')+' · '+t(recordMode==='audio'?'directRecord':'fieldLayer');
  $('.record-rocker').dataset.mode=recordMode;
  $('#record [data-i18n]').textContent=t(recorder.directRecording?'stopRecord':'record');
  $('#record').title=t(recorder.directRecording?'stopRecord':'record')+' (O)';
  $('#record-status').textContent=recorder.directRecording?t('recording',{time:formatTime(Math.max(0,sound.context.currentTime-recorder.inputRecorder.startedAt))}):recorder.recording?t('processing'):t('trackCount',{count:recorder.tracks.length})+(recorder.tracks.length>3?` · ${trackPage+1}/${Math.ceil(recorder.tracks.length/3)}`:'');
}
function controlButton(label,text,action){
  const button=document.createElement('button');button.type='button';button.textContent=text;button.setAttribute('aria-label',label);button.title=label;button.onclick=action;return button;
}
function renderTracks(){
  const list=$('#tracks');list.replaceChildren();$('#empty-tracks').hidden=true;$('.workspace').style.setProperty('--track-shelf','96px');
  const paged=paginateTracks(recorder.tracks,trackPage);trackPage=paged.page;visibleTracks=paged.tracks;
  $('#prev-track-page').disabled=trackPage===0;$('#next-track-page').disabled=trackPage===paged.pages-1;
  for(const [slot,track] of visibleTracks.entries()){
    const trackNumber=trackPage*3+slot+1;
    const row=document.createElement('div');row.className='loop-row';row.dataset.track=track.id;
    const display=document.createElement('button');display.type='button';display.className='track-screen screen';display.setAttribute('aria-label',t('loopEdit')+' '+trackNumber);display.setAttribute('aria-pressed',track.id===editTrackId);display.onclick=()=>selectLoop(track.id);
    const number=document.createElement('span');number.className='track-number';number.textContent=String(trackNumber).padStart(2,'0');
    const wave=document.createElement('canvas');wave.className='track-wave';wave.width=720;wave.height=40;wave.setAttribute('aria-label',t('loops')+' '+trackNumber);
    const time=document.createElement('span');time.className='track-time';time.textContent=formatTime(track.buffer.duration);
    const repeat=document.createElement('img');repeat.src='assets/icons/repeat.svg';repeat.className='icon';repeat.alt='';
    display.append(number,wave,time,repeat);track.display=display;track.canvas=wave;
    row.append(display);list.append(row);
  }
  for(let slot=visibleTracks.length;slot<3;slot++){
    const empty=document.createElement('div');empty.className='track-placeholder screen';
    const number=document.createElement('span');number.textContent=String(trackPage*3+slot+1).padStart(2,'0');
    const blank=document.createElement('span');blank.className='blank-track-space';
    const time=document.createElement('span');time.textContent='—:—';empty.append(number,blank,time);list.append(empty);
  }
  syncTrackControls();syncRecord();syncEditor();
  if($('#export-dialog').open)syncExportDialog();
}

function syncExport(){
  const button=$('#export-audio'),active=!!exportCapture;
  button.setAttribute('aria-pressed',active);
  button.disabled=exportBusy;
  const action=active?(exportMode==='cycle'?'exportCancelRender':'exportStop'):'exportAudio';
  button.setAttribute('aria-label',t(action));button.title=t(action);
  const status=$('#export-status');
  const compact={exportStarted:'exportStatusRecording',exportCycleStarted:'exportStatusCycle',exportTruncatedStarted:'exportStatusTruncated',exportSaved:'exportStatusSaved',exportEmpty:'exportStatusEmpty',exportSnapshotting:'exportSnapshotting',exportRendering:'exportRendering',exportCancelled:'exportCancelled'};
  status.hidden=!exportStatusKey;status.textContent=exportStatusKey?t(compact[exportStatusKey]??'exportStatusFailed',{progress:exportProgress}):'';
  status.title=exportStatusKey?t(exportStatusKey,{progress:exportProgress}):'';
}
function showExportStatus(key){exportStatusKey=key;syncExport();}
function syncExportDialog(){
  $('#export-error').hidden=true;
  document.querySelectorAll('[data-export-mode]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.exportMode===exportMode));
  $('#export-description').textContent=t(exportMode==='live'?'exportLiveDescription':'exportCycleDescription');
  $('#export-cycle-options').hidden=exportMode!=='cycle';
  $('#start-export').textContent=t(exportMode==='cycle'?'exportStartCycle':'exportStart');
  const select=$('#export-anchor'),previous=Number(select.value)||editTrackId;
  select.replaceChildren();
  for(const [index,track] of recorder.tracks.entries()){
    if(loopGain(track,recorder.tracks)<=0)continue;
    const option=document.createElement('option');option.value=track.id;
    option.textContent=t('exportAnchorOption',{number:String(index+1).padStart(2,'0'),duration:track.buffer.duration.toFixed(2)});select.append(option);
  }
  if([...select.options].some(option=>Number(option.value)===previous))select.value=previous;
  $('#start-export').disabled=false;
  if(exportMode==='cycle'){
    try{
      if(recorder.recording)throw new Error('exportTrackBusy');
      const plan=planCycleExport(recorder.tracks,Number(select.value),sound.context?.sampleRate??48000,sound.context?.currentTime??0);
      $('#export-cycle-duration').textContent=plan.truncated?t('exportCycleTruncated'):t('exportDuration',{time:formatTime(plan.duration)+` (${plan.duration.toFixed(2)}s)`,count:plan.trackIds.length});
      if(plan.truncated)$('#start-export').textContent=t('exportStartTruncated');
    }catch(error){$('#export-cycle-duration').textContent=t(error.message);$('#start-export').disabled=true;}
  }
}
function lockCycleExport(locked){
  cycleLocked=locked;$('.loop-editor').inert=locked;syncRecord();
}
function downloadWav(samples,sampleRate,mode=exportMode){
  const blob=new Blob([encodeWav(samples,sampleRate)],{type:'audio/wav'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  link.href=url;link.download=`serenity-${mode}-${stamp}.wav`;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function startAudioExport(){
  if(exportBusy||exportCapture)return;
  exportBusy=true;$('#start-export').disabled=true;syncExport();
  let capture=null,fileMode=exportMode,plannedFrames=null;
  try{
    await sound.start();
    if(exportMode==='cycle'){
      if(recorder.recording)throw new Error('exportTrackBusy');
      lockCycleExport(true);
      showExportStatus('exportSnapshotting');
      const snapshot=await snapshotCycle(sound,recorder.tracks,Number($('#export-anchor').value));
      plannedFrames=snapshot.frames;if(snapshot.plan.truncated)fileMode='cycle-truncated';
      exportProgress=0;
      capture=startOfflineRender(snapshot,value=>{
        const next=Math.round(value*100);if(next!==exportProgress){exportProgress=next;showExportStatus('exportRendering');}
      });exportCapture=capture;
      $('#export-dialog').close();showExportStatus('exportRendering');
    }else{
      await loadExportModule(sound);capture=new MixCapture(sound);exportCapture=capture;await capture.start();
      $('#export-dialog').close();showExportStatus('exportStarted');
    }
    void capture.done.then(({samples,sampleRate})=>{
      if(samples.length<sampleRate*.1)throw new Error('exportEmpty');
      const name=plannedFrames&&samples.length<plannedFrames?fileMode+'-partial':fileMode;
      downloadWav(samples,sampleRate,name);showExportStatus('exportSaved');
    }).catch(error=>showExportStatus(['exportEmpty','exportCancelled'].includes(error.message)?error.message:'exportFailed')).finally(()=>{
      exportCapture=null;lockCycleExport(false);syncExport();
    });
  }catch(error){
    exportCapture=null;lockCycleExport(false);showExportStatus(['exportNoTracks','exportTrackBusy'].includes(error.message)?error.message:'exportFailed');
    if($('#export-dialog').open){$('#export-error').textContent=t(exportStatusKey);$('#export-error').hidden=false;}
  }finally{exportBusy=false;syncExport();$('#start-export').disabled=false;}
}
$('#export-audio').onclick=()=>{
  if(exportCapture){exportBusy=true;syncExport();void exportCapture.stop().catch(()=>{}).finally(()=>{exportBusy=false;syncExport();});return;}
  keys.clear();clearTimeout(pendingPlant);$('#export-anchor').replaceChildren();syncExportDialog();$('#export-dialog').showModal();
};
document.querySelectorAll('[data-export-mode]').forEach(button=>button.onclick=()=>{exportMode=button.dataset.exportMode;syncExportDialog();});
$('#export-anchor').onchange=syncExportDialog;
$('#start-export').onclick=()=>void startAudioExport();
$('#close-export').onclick=$('#cancel-export').onclick=()=>$('#export-dialog').close();
function syncTrackControls(){
  for(const track of visibleTracks)track.display.classList.toggle('muted',loopGain(track,recorder.tracks)===0);
  const track=recorder.tracks.find(item=>item.id===editTrackId);
  if(track){$('#edit-mute').setAttribute('aria-pressed',track.muted);$('#edit-solo').setAttribute('aria-pressed',track.solo);}
}
function drawTracks(now){
  if(now-trackDrawTime<50)return;trackDrawTime=now;
  if(recorder.recording)syncRecord();
  for(const track of visibleTracks){
    const ctx=track.canvas.getContext('2d'),w=track.canvas.width,h=track.canvas.height;
    if(track.mapBuffer!==track.buffer||track.mapPitchKey!==`${track.settings.lowPitch}:${track.settings.highPitch}`){track.mapCanvas=document.createElement('canvas');track.mapCanvas.width=w;track.mapCanvas.height=h;drawPitchMap(track.mapCanvas.getContext('2d'),track,1);track.mapBuffer=track.buffer;track.mapPitchKey=`${track.settings.lowPitch}:${track.settings.highPitch}`;}
    ctx.clearRect(0,0,w,h);ctx.globalAlpha=loopGain(track,recorder.tracks)>0?Math.sqrt(Math.min(1,track.volume)):.25;ctx.drawImage(track.mapCanvas,0,0);ctx.globalAlpha=1;
    const position=((sound.context.currentTime-track.startedAt)%track.buffer.duration)/track.buffer.duration;
    ctx.fillStyle='#e56732';ctx.fillRect(position*w,2,1,h-4);
  }
}
$('#prev-track-page').onclick=()=>{trackPage--;renderTracks();};
$('#next-track-page').onclick=()=>{trackPage++;renderTracks();};
function selectLoop(id){editTrackId=id;renderTracks();}
function formatPitch(note){const names=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];return names[note%12]+(Math.floor(note/12)-1);}
let fxPage='filter',knobDrag=null;
const knobs=Array.from({length:4},(_,i)=>{
  const cell=document.createElement('div');cell.className='fx-knob-cell';
  const value=document.createElement('output');value.className='screen';value.id=`fx-value-${i}`;
  const knob=document.createElement('button');knob.className='fx-knob';knob.id=`fx-knob-${i}`;knob.type='button';knob.setAttribute('role','slider');knob.innerHTML='<span class="knob-pointer" aria-hidden="true"></span>';
  const label=document.createElement('span');label.className='fx-knob-label';cell.append(value,knob,label);$('#fx-knobs').append(cell);
  const change=position=>{
    const track=selectedLoop();if(!track)return;
    const parameter=FX_PARAMETERS[fxPage][i];
    if(fxPage==='delay'&&parameter.key==='time'&&track.fx.delay.sync)return;
    recorder.setEffects(track,fxPage,{[parameter.key]:knobValue(parameter,position),enabled:true});syncEffects();
  };
  const position=()=>{const track=selectedLoop();return track?knobPosition(FX_PARAMETERS[fxPage][i],track.fx[fxPage][FX_PARAMETERS[fxPage][i].key]):0;};
  knob.addEventListener('pointerdown',event=>{
    if(event.button!==0||!event.isPrimary)return;event.preventDefault();knob.focus();knob.setPointerCapture(event.pointerId);
    knobDrag={knob,id:event.pointerId,y:event.clientY,position:position()};
  });
  knob.addEventListener('pointermove',event=>{if(knobDrag?.knob===knob&&knobDrag.id===event.pointerId){const delta=(knobDrag.y-event.clientY)/(event.shiftKey?1200:120);knobDrag.position=clamp(knobDrag.position+delta,0,1);knobDrag.y=event.clientY;change(knobDrag.position);}});
  const release=event=>{if(knobDrag?.knob===knob){knobDrag=null;if(knob.hasPointerCapture(event.pointerId))knob.releasePointerCapture(event.pointerId);}};
  knob.addEventListener('pointerup',release);knob.addEventListener('pointercancel',release);
  knob.addEventListener('keydown',event=>{
    const moves={ArrowUp:1,ArrowRight:1,ArrowDown:-1,ArrowLeft:-1,PageUp:10,PageDown:-10};
    if(event.key==='Home'||event.key==='End'){event.preventDefault();change(event.key==='Home'?0:1);}
    else if(event.key in moves){event.preventDefault();change(position()+moves[event.key]*(event.shiftKey?.001:.01));}
  });
  knob.addEventListener('dblclick',()=>change(knobPosition(FX_PARAMETERS[fxPage][i],FX_PARAMETERS[fxPage][i].default)));
  return {knob,value,label,change,position};
});
installWheelControls(knobs);
function fxValue(parameter,value,duration=1){
  if(parameter.unit==='loopTime')return fxValue({unit:'seconds'},value*duration);
  if(parameter.unit==='curve')return Math.abs(value)<1e-8?'Lin':(value>0?'+':'')+Math.round(value*100)+'%';
  if(parameter.unit==='hz')return value>=1000?(value/1000).toFixed(value>=10000?1:2)+'k':Math.round(value)+'Hz';
  if(parameter.unit==='seconds')return value<1?Math.round(value*1000)+'ms':value.toFixed(2)+'s';
  if(parameter.unit==='signed')return (value>0?'+':'')+Math.round(value*100)+'%';
  return Math.round(value*100)+'%';
}
function syncEffects(){
  const track=selectedLoop(),state=track?.fx??createFXState(),group=state[fxPage];
  document.querySelectorAll('[data-fx-page]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.fxPage===fxPage));
  $('#fx-power').disabled=!track;$('#fx-power').setAttribute('aria-pressed',!!track&&group.enabled);
  const clock=$('#fx-clock');clock.replaceChildren();clock.disabled=!track||fxPage==='fade';
  clock.setAttribute('aria-label',t(fxPage==='fade'?'fadeTiming':'effectTiming'));clock.title=fxPage==='fade'?t('fadeTiming'):'';
  const choices=fxPage==='fade'?[[1,'1×']]:fxPage==='filter'?[[1,'1×'],[2,'2×'],[4,'4×'],[8,'8×']]:[[0,t('freeDelay')],[.5,'1/2'],[.25,'1/4'],[.125,'1/8'],[.0625,'1/16']];
  for(const [value,text] of choices){const option=document.createElement('option');option.value=value;option.textContent=text;option.disabled=fxPage==='delay'&&value>0&&!!track&&track.buffer.duration*value>16;clock.append(option);}
  clock.value=String(fxPage==='fade'?1:fxPage==='filter'?group.repeats:group.sync);
  FX_PARAMETERS[fxPage].forEach((parameter,i)=>{
    const {knob,value,label}=knobs[i],current=group[parameter.key],synced=fxPage==='delay'&&parameter.key==='time'&&!!group.sync;
    knob.disabled=!track||synced;knob.title=parameter.label+' · '+t('effectKnob');
    knob.setAttribute('aria-label',parameter.label);knob.setAttribute('aria-valuemin',parameter.min);knob.setAttribute('aria-valuemax',synced&&track?Math.max(parameter.max,delaySeconds(group,track.buffer.duration)):parameter.max);
    const displayed=synced&&track?delaySeconds(group,track.buffer.duration):current;knob.setAttribute('aria-valuenow',displayed);
    const text=fxValue(parameter,displayed,track?.buffer.duration??1);knob.setAttribute('aria-valuetext',text);
    if(fxPage==='fade')knob.title=parameter.label+' · '+t(parameter.unit==='loopTime'?'fadeTimeHint':'fadeCurveHint')+' · '+t('effectKnob');
    knob.style.setProperty('--knob-angle',`${-135+270*knobPosition(parameter,displayed)}deg`);value.textContent=track?text:'—';label.textContent=parameter.label;
  });
  if(track)drawEditor(track);
}
document.querySelectorAll('[data-fx-page]').forEach(button=>button.onclick=()=>{knobDrag=null;fxPage=button.dataset.fxPage;syncEffects();});
$('#fx-power').onclick=()=>{const track=selectedLoop();if(track){recorder.setEffects(track,fxPage,{enabled:!track.fx[fxPage].enabled});syncEffects();}};
$('#fx-clock').onchange=event=>{const track=selectedLoop();if(track&&fxPage!=='fade'){recorder.setEffects(track,fxPage,{[fxPage==='filter'?'repeats':'sync']:Number(event.target.value),enabled:true});syncEffects();}};
function syncEditor(){
  const track=recorder.tracks.find(item=>item.id===editTrackId);
  $('#loop-editor').hidden=false;
  $('#loop-editor').querySelectorAll('button,input,select').forEach(element=>element.disabled=!track);
  document.querySelectorAll('[data-fx-page]').forEach(button=>button.disabled=false);syncEffects();
  document.querySelectorAll('[data-tempo-mode]').forEach(button=>{button.setAttribute('aria-pressed',(track?.speedMode??'stretch')===button.dataset.tempoMode);button.title=t(button.dataset.tempoMode==='normal'?'normalTempo':'stretchTempo');});
  if(!track){
    $('#edit-track').textContent='— / —';$('#edit-volume-value').textContent='—';
    $('#track-speed-range').value=1;$('#track-speed-value').value=1;
    for(const id of ['mask-start','mask-end','cut-high','cut-low'])$('#'+id+'-value').textContent='—';
    $('#edit-mute').setAttribute('aria-pressed','false');$('#edit-solo').setAttribute('aria-pressed','false');
    const canvas=$('#cycle-preview'),ctx=canvas.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);return;
  }
  const rate=track.speed??1,select=$('#track-speed-value');
  $('#track-speed-range').value=String(rate);select.querySelector('[data-custom-speed]')?.remove();
  if(!Array.from(select.options).some(option=>Number(option.value)===rate)){const option=document.createElement('option');option.value=rate;option.textContent=rate.toFixed(2)+'×';option.hidden=true;option.dataset.customSpeed='';select.append(option);}
  select.value=String(rate);$('#track-speed-down').disabled=rate<=.25;$('#track-speed-up').disabled=rate>=4;
  $('#edit-volume').value=Math.round(track.volume*100);$('#edit-volume-value').textContent=Math.round(track.volume*100);
  $('#edit-track').textContent=String(recorder.tracks.indexOf(track)+1).padStart(2,'0')+' / '+(track.buffer.duration).toFixed(2)+'s';
  for(const [id,key] of [['mask-start','start'],['mask-end','end'],['cut-high','highPitch'],['cut-low','lowPitch']]){
    $('#'+id).value=key==='start'||key==='end'?Math.round(track.settings[key]*100):track.settings[key];
    $('#'+id+'-value').textContent=key==='start'||key==='end'?Math.round(track.settings[key]*100)+'%':formatPitch(track.settings[key]);
  }
  drawEditor(track);
}
function drawPitchMap(ctx,track,repeats){
  const w=ctx.canvas.width,h=ctx.canvas.height,map=track.pitchMap,pitchScale=track.appliedMode==='normal'?(track.appliedSpeed??1):1;
  ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);if(!map)return;
  if(map.mode==='recording'){
    let peak=0;for(const row of map.levels)for(const value of row)peak=Math.max(peak,value);
    const rows=map.highNote-map.lowNote+1,frameWidth=w/repeats/map.frames;
    for(let r=0;r<repeats;r++)for(let f=0;f<map.frames;f++)for(let row=0;row<rows;row++){
      const note=row+map.lowNote+12*Math.log2(pitchScale);if(note<track.settings.lowPitch||note>track.settings.highPitch)continue;
      const value=map.levels[f][row];if(!value||!peak)continue;
      ctx.fillStyle=`rgba(255,255,255,${Math.sqrt(value/peak)})`;
      ctx.fillRect(r*w/repeats+f*frameWidth,h-(row+1+12*Math.log2(pitchScale))*h/rows,Math.max(1,frameWidth+.2),Math.max(1,h/rows));
    }
  }else{
  const samples=track.buffer.getChannelData(0),frames=map.frames;
  const rows=12,frameWidth=w/repeats/frames;
  // Measured output energy controls brightness; pitch comes from synthesis data.
  const energies=[];
  for(let f=0;f<frames;f++){
    const start=Math.floor(f*samples.length/frames),end=Math.floor((f+1)*samples.length/frames);
    let sum=0;for(let i=start;i<end;i+=8)sum+=samples[i]*samples[i];
    energies.push(Math.sqrt(sum/Math.max(1,(end-start)/8)));
  }
  let peak=0;
  for(let f=0;f<frames;f++)peak=Math.max(peak,map.mode==='average'?energies[f]:Math.max(...map.weights[f])*energies[f]);
  const scale=peak>0?1/peak:0;
  for(let r=0;r<repeats;r++)for(let f=0;f<frames;f++){
    const energy=energies[f],x=r*w/repeats+f*frameWidth;
    if(map.mode==='average'){
      const note=69+12*Math.log2(Math.max(1,map.frequencies[f]*(map.pitchRate??1)*pitchScale)/440);
      if(note<track.settings.lowPitch||note>track.settings.highPitch)continue;
      const y=h-4-Math.max(0,Math.min(1,(note-48)/36))*(h-8);
      ctx.fillStyle=`rgba(255,255,255,${energy*scale})`;ctx.fillRect(x,y,Math.max(1,frameWidth+.2),Math.max(2,h/32));
    }else{
      const weights=map.weights[f];
      for(let i=0;i<rows;i++){
        const pitch=i+60+12*Math.log2((map.pitchRate??1)*pitchScale);
        if(pitch<track.settings.lowPitch||pitch>track.settings.highPitch)continue;
        ctx.fillStyle=`rgba(255,255,255,${weights[i]*energy*scale})`;
        ctx.fillRect(x,h-(i+1)*h/rows,Math.max(1,frameWidth+.2),Math.max(1,h/rows-1));
      }
    }
  }
  }
  const {start,end,lowPitch,highPitch}=track.settings;ctx.fillStyle='#000';
  for(let r=0;r<repeats;r++){
    const x=r*w/repeats;
    if(start<end)ctx.fillRect(x+start*w/repeats,0,(end-start)*w/repeats,h);
    else if(start>end){ctx.fillRect(x,0,end*w/repeats,h);ctx.fillRect(x+start*w/repeats,0,(1-start)*w/repeats,h);}
  }

}
function drawEditor(track){
  const canvas=$('#cycle-preview'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  drawPitchMap(ctx,track,1);
  if(track.fx.fade.enabled||fxPage==='fade'){
    const fade=track.fx.fade,top=27,bottom=h-24;
    ctx.save();ctx.beginPath();ctx.moveTo(0,bottom);
    for(let x=0;x<=w;x+=2)ctx.lineTo(x,bottom-fadeEnvelopeAt(x/w,fade)*(bottom-top));
    ctx.lineTo(w,bottom);ctx.closePath();ctx.fillStyle=fade.enabled?'#e5673215':'#ffffff08';ctx.fill();
    ctx.beginPath();for(let x=0;x<=w;x+=2){const y=bottom-fadeEnvelopeAt(x/w,fade)*(bottom-top);x?ctx.lineTo(x,y):ctx.moveTo(x,y);}
    ctx.strokeStyle=fade.enabled?'#e56732':'#8a8c85';ctx.lineWidth=4;ctx.stroke();ctx.restore();
  }
  ctx.fillStyle='#e8e8e0';ctx.font='18px monospace';
  for(const fraction of [0,.5,1]){
    ctx.textAlign=fraction===0?'left':fraction===1?'right':'center';
    ctx.fillText((fraction*track.buffer.duration).toFixed(1)+'s',fraction===0?7:fraction===1?w-44:w/2,20);
  }
  ctx.textAlign='left';
  if(track.pitchMap?.mode==='recording'){
    ctx.fillStyle='#ddddcf';ctx.font='17px monospace';ctx.fillText(formatPitch(track.pitchMap.highNote),w-40,19);ctx.fillText(formatPitch(track.pitchMap.lowNote),w-40,h-5);return;
  }
  ctx.fillStyle='#191919';ctx.fillRect(w-36,0,36,24);ctx.fillRect(w-36,h-24,36,24);ctx.fillStyle='#ddddcf';ctx.font='17px monospace';ctx.fillText(track.pitchMap?.mode==='average'?'C6':formatPitch(Math.round(71+12*Math.log2((track.pitchMap?.pitchRate??1)*(track.appliedMode==='normal'?track.appliedSpeed??1:1)))),w-32,19);ctx.fillText(track.pitchMap?.mode==='average'?'C3':formatPitch(Math.round(60+12*Math.log2((track.pitchMap?.pitchRate??1)*(track.appliedMode==='normal'?track.appliedSpeed??1:1)))),w-32,h-5);
}
const selectedLoop=()=>recorder.tracks.find(item=>item.id===editTrackId);
$('#edit-mute').onclick=()=>{const track=selectedLoop();if(track){track.muted=!track.muted;recorder.mix();syncTrackControls();}};
$('#edit-solo').onclick=()=>{const track=selectedLoop();if(track){track.solo=!track.solo;recorder.mix();syncTrackControls();}};
$('#delete-selected').onclick=()=>{const track=selectedLoop();if(track){editTrackId=null;recorder.remove(track.id);}};
document.querySelectorAll('[data-tempo-mode]').forEach(button=>button.onclick=()=>{const track=selectedLoop();if(track)recorder.setSpeedMode(track,button.dataset.tempoMode);});
$('#track-speed-down').onclick=()=>{const track=selectedLoop();if(track)recorder.setSpeed(track,(track.speed??1)-.25);};
$('#track-speed-up').onclick=()=>{const track=selectedLoop();if(track)recorder.setSpeed(track,(track.speed??1)+.25);};
for(const [id,event] of [['track-speed-range','oninput'],['track-speed-value','onchange']])$('#'+id)[event]=e=>{const track=selectedLoop();if(track)recorder.setSpeed(track,Number(e.target.value));};
$('#edit-volume').oninput=event=>{const track=selectedLoop();if(track){track.volume=Number(event.target.value)/100;$('#edit-volume-value').textContent=event.target.value;recorder.mix();}};
for(const [id,key] of [['mask-start','start'],['mask-end','end'],['cut-high','highPitch'],['cut-low','lowPitch']]){
  $('#'+id).oninput=()=>{
    const track=recorder.tracks.find(item=>item.id===editTrackId);if(!track)return;
    let value=Number($('#'+id).value);
    if(key==='start'||key==='end')value/=100;
    if(key==='highPitch')value=Math.max(value,track.settings.lowPitch);
    if(key==='lowPitch')value=Math.min(value,track.settings.highPitch);
    recorder.edit(track,{[key]:value});
  };
}
let maskDrag=null,maskCommitTimer=null;
const maskCanvas=$('#cycle-preview');
function maskPosition(event){const rect=maskCanvas.getBoundingClientRect();return Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));}
function commitDrag(){
  clearTimeout(maskCommitTimer);maskCommitTimer=null;
  if(maskDrag?.moved&&recorder.tracks.includes(maskDrag.track))recorder.edit(maskDrag.track,maskDrag.latest);
}
maskCanvas.addEventListener('pointerdown',event=>{
  const track=selectedLoop();if(!track||event.button!==0||!event.isPrimary)return;
  event.preventDefault();maskCanvas.setPointerCapture(event.pointerId);
  maskDrag={pointerId:event.pointerId,track,origin:maskPosition(event),clientX:event.clientX,initial:{...track.settings},moved:false,latest:{}};
});
maskCanvas.addEventListener('pointermove',event=>{
  if(!maskDrag||maskDrag.pointerId!==event.pointerId)return;
  if(Math.abs(event.clientX-maskDrag.clientX)<2&&!maskDrag.moved)return;
  maskDrag.moved=true;maskDrag.latest=maskFromDrag(maskDrag.origin,maskPosition(event));
  Object.assign(maskDrag.track.settings,maskDrag.latest);syncEditor();
  if(!maskCommitTimer)maskCommitTimer=setTimeout(commitDrag,80);
});
maskCanvas.addEventListener('pointerup',event=>{
  if(!maskDrag||maskDrag.pointerId!==event.pointerId)return;
  commitDrag();maskDrag=null;if(maskCanvas.hasPointerCapture(event.pointerId))maskCanvas.releasePointerCapture(event.pointerId);
});
function cancelMaskDrag(){
  clearTimeout(maskCommitTimer);maskCommitTimer=null;
  if(maskDrag&&recorder.tracks.includes(maskDrag.track))recorder.edit(maskDrag.track,maskDrag.initial);
  maskDrag=null;
}
maskCanvas.addEventListener('pointercancel',cancelMaskDrag);
maskCanvas.addEventListener('lostpointercapture',()=>{if(maskDrag)cancelMaskDrag();});
$('#restore-loop').onclick=()=>{const track=selectedLoop();if(track){recorder.resetEffects(track);track.speed=1;track.speedMode='stretch';recorder.edit(track,{start:0,end:0,lowPitch:0,highPitch:127});}};
$('#close-editor').onclick=()=>{editTrackId=null;renderTracks();};
recorder.onchange=renderTracks;recorder.onerror=notify;
function resizeFieldGrid(){
  const rect=$('#stage').getBoundingClientRect(),size=gridForViewport(rect.width,rect.height);
  if(size.width===sim.width&&size.height===sim.height)return;
  cancelRegionDrag();
  const {dx,dy}=sim.resize(size.width,size.height);
  point.x=clamp(point.x+dx,0,sim.width-1);point.y=clamp(point.y+dy,0,sim.height-1);
  soundRegions=soundRegions.map(region=>({left:region.left+dx,right:region.right+dx,top:region.top+dy,bottom:region.bottom+dy}));
  canvas.width=sim.width*6;canvas.height=sim.height*6;regionOverlay.width=canvas.width;regionOverlay.height=canvas.height;
  syncSelection();syncRegion();dirty=true;
}
applyLanguage(language);resizeFieldGrid();new ResizeObserver(resizeFieldGrid).observe($('#stage'));requestAnimationFrame(frame);
