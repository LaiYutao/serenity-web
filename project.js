import { FX_PARAMETERS } from './effects-dsp.js';
import { trackTempo } from './track-tempo.js';
import { bufferChannels, monoMix } from './stereo.js';
// Self-contained binary archive: a small JSON manifest followed by typed-array data.
// No audio re-encoding: original and processed PCM remain lossless and editable.
const MAGIC='SRNTY001', LIMIT=768*1024*1024;
const TYPES={Float32Array,Float64Array,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array};
export function encodeProject(project){
  validateProject(project);
  const chunks=[],seen=new WeakMap();let offset=0;
  const json=JSON.stringify(project,(_key,value)=>{
    if(ArrayBuffer.isView(value)){
      if(!TYPES[value.constructor.name])throw new Error('projectInvalid');
      if(seen.has(value))return seen.get(value);
      const ref={$array:value.constructor.name,offset,length:value.length};seen.set(value,ref);
      chunks.push(new Uint8Array(value.buffer,value.byteOffset,value.byteLength));offset+=value.byteLength;return ref;
    }
    return value;
  });
  const manifest=new TextEncoder().encode(json),header=new Uint8Array(12);
  header.set(new TextEncoder().encode(MAGIC));new DataView(header.buffer).setUint32(8,manifest.length,true);
  if(manifest.length>32*1024*1024||12+manifest.length+offset>LIMIT)throw new Error('projectTooLarge');
  return new Blob([header,manifest,...chunks],{type:'application/octet-stream'});
}
export async function decodeProject(file){
  if(file.size>LIMIT)throw new Error('projectTooLarge');
  const data=await file.arrayBuffer(),bytes=new Uint8Array(data);
  if(bytes.length<12||new TextDecoder().decode(bytes.subarray(0,8))!==MAGIC)throw new Error('projectInvalid');
  const size=new DataView(data).getUint32(8,true),start=12+size;
  if(size>32*1024*1024||start>bytes.length)throw new Error('projectInvalid');
  let project;const arrays=new Map();
  try{
    project=JSON.parse(new TextDecoder().decode(bytes.subarray(12,start)),(key,value)=>{
      if(['__proto__','prototype','constructor'].includes(key))throw new Error();
      if(value&&Object.hasOwn(value,'$array')){
        const Type=TYPES[value.$array],offset=value.offset,length=value.length;
        if(!Type||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<0||length*Type.BYTES_PER_ELEMENT>bytes.length-start-offset)throw new Error();
        const id=`${value.$array}:${offset}:${length}`;
        if(!arrays.has(id))arrays.set(id,new Type(data.slice(start+offset,start+offset+length*Type.BYTES_PER_ELEMENT)));
        return arrays.get(id);
      }
      return value;
    });
    validateProject(project);
  }catch{throw new Error('projectInvalid');}
  return project;
}
function check(value){if(!value)throw new Error('projectInvalid');}
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const within=(v,a,b)=>finite(v)&&v>=a&&v<=b;
function sceneValid(scene){
  check(scene&&Number.isInteger(scene.width)&&Number.isInteger(scene.height)&&within(scene.width,16,2048)&&within(scene.height,16,2048)&&scene.width*scene.height<=200000);
  check(within(scene.time,0,1e10)&&[-1,1].includes(scene.direction)&&Array.isArray(scene.fields)&&scene.fields.length<=32);
  for(const f of scene.fields){
    check(['circle','spiral'].includes(f.type)&&finite(f.x)&&finite(f.y)&&within(f.amplitude,0,6)&&within(f.frequency,-1,1)&&finite(f.revisionTime));
    check([-1,1].includes(f.direction)&&[-1,1].includes(f.initialDirection)&&Array.isArray(f.history)&&f.history.length>0&&Array.isArray(f.directionHistory));
    check(f.history.every(h=>within(h.amplitude,0,6)&&within(h.frequency,-1,1)&&finite(h.time))&&f.directionHistory.every(h=>finite(h.time)&&[-1,1].includes(h.from)&&[-1,1].includes(h.to)));
    check(within(f.activeCount,0,scene.width*scene.height));
    for(const key of ['distances','angularPhase','active','amps','freqs','phases'])check(ArrayBuffer.isView(f[key])&&f[key].length===scene.width*scene.height&&f[key].every(finite));
  }
  const s=scene.settings;
  check(s&&within(Math.abs(s.speed),.25,4)&&['cluster','average',null].includes(s.mode)&&['original','sine','triangle','sawtooth','square','pluck','bubble','electric'].includes(s.waveform));
  check(s.samplingMode===undefined||['normal','step'].includes(s.samplingMode));check(s.stepRate===undefined||within(s.stepRate,.05,4));
  check(s.point&&finite(s.point.x)&&finite(s.point.y)&&['circle','spiral'].includes(s.type)&&within(s.amplitude,0,6)&&within(s.frequency,-1,1)&&within(s.accumulator,0,.101));
  check(Array.isArray(s.regions)&&s.regions.length<=100&&s.regions.every(r=>['left','right','top','bottom'].every(k=>finite(r[k]))));
}
export function validateProject(p){
  check(p&&p.format==='serenity-project'&&p.version===1&&within(p.sampleRate,8000,192000));sceneValid(p.scene);
  check(within(p.volume,0,1)&&typeof p.muted==='boolean'&&['field','audio'].includes(p.recordMode));
  check(Array.isArray(p.tracks)&&p.tracks.length<=16);
  for(const t of p.tracks){
    for(const key of ['original','samples','pitchSamples'])check(t[key] instanceof Float32Array&&t[key].length>0&&t[key].length<=p.sampleRate*(key==='original'?1200:19200)&&t[key].every(finite));
    for(const [key,base] of [['originalChannels','original'],['channels','samples'],['pitchChannels','pitchSamples']]){
      if(t[key]!==undefined)check(Array.isArray(t[key])&&t[key].length===2&&t[key].every(c=>c instanceof Float32Array&&c.length===t[base].length&&c.every(finite)));
    }
    const tempo=trackTempo(t);
    check((t.normalSpeed===undefined||within(t.normalSpeed,.25,4))&&(t.stretchSpeed===undefined||within(t.stretchSpeed,.25,4)));
    check(within(tempo.normal,.25,4)&&within(tempo.stretch,.25,4)&&within(t.speed,.0625,16)&&Math.abs(t.speed-tempo.rate)<1e-9);
    check(within(t.position,0,t.samples.length/p.sampleRate+.01)&&['normal','stretch'].includes(t.speedMode)&&within(t.volume,0,2));
    check(t.paused===undefined||typeof t.paused==='boolean');
    check(typeof t.muted==='boolean'&&typeof t.solo==='boolean'&&within(t.baseDuration,0.001,1200));
    check(t.settings&&['start','end'].every(k=>within(t.settings[k],0,1))&&['lowPitch','highPitch'].every(k=>within(t.settings[k],0,127)));
    check(['original','sine','triangle','sawtooth','square','pluck','bubble','electric','recording'].includes(t.waveform));
    check(t.fx&&['filter','delay','fade'].every(k=>t.fx[k]&&typeof t.fx[k].enabled==='boolean'));
    check(t.fx.drive===undefined||t.fx.drive&&typeof t.fx.drive.enabled==='boolean');
    for(const [group,parameters] of Object.entries(FX_PARAMETERS)){
      if(group==='drive'&&t.fx.drive===undefined)continue;
      for(const param of parameters)check(within(t.fx[group][param.key],param.min,param.max));
    }
    check([1,2,4,8].includes(t.fx.filter.repeats)&&[0,.5,.25,.125,.0625].includes(t.fx.delay.sync));
    check(typeof t.continuous==='boolean');
    const map=t.pitchMap;check(map&&['recording','average','cluster'].includes(map.mode)&&Number.isInteger(map.frames)&&within(map.frames,1,24000));
    const pansValid=(values,length)=>values?.length===length&&Array.from(values).every(v=>within(v,-1,1));
    if(map.pans!==undefined)check(Array.isArray(map.pans)&&map.pans.length===map.frames&&map.pans.every(row=>pansValid(row,12)));
    if(map.panFrames!==undefined)check(pansValid(map.panFrames,map.frames));
    if(map.mode==='recording'){
      check(Number.isInteger(map.lowNote)&&Number.isInteger(map.highNote)&&within(map.lowNote,0,127)&&within(map.highNote,map.lowNote,127));
      check(Array.isArray(map.levels)&&map.levels.length===map.frames&&map.levels.every(row=>row.length===map.highNote-map.lowNote+1&&Array.from(row).every(finite)));
    }else{
      check(Array.isArray(map.weights)&&map.weights.length===map.frames&&map.weights.every(row=>Array.isArray(row)&&row.length===12&&row.every(finite)));
      check(Array.isArray(map.frequencies)&&map.frequencies.length===map.frames&&map.frequencies.every(finite)&&within(map.pitchRate,.01,16));
    }
    if(t.continuous)check(t.voice&&t.voice.profile&&within(t.voice.profile.duration,.001,1200)&&finite(t.voice.profile.elapsed)&&finite(t.voice.profile.position)&&within(t.voice.rate,.01,17)&&Array.isArray(t.voice.profile.weights)&&t.voice.profile.weights.length>0);
    if(t.continuous){
      const v=t.voice;check((v.paused===undefined||typeof v.paused==='boolean')&&!!v.paused===!!t.paused);check(within(v.profile.position,0,v.profile.duration)&&within(v.profile.elapsed,0,1e12));
      if(v.profile.panFrames!==undefined)check(pansValid(v.profile.panFrames,v.profile.frequencies?.length));
      if(v.profile.pans!==undefined)check(Array.isArray(v.profile.pans)&&v.profile.pans.length===v.profile.weights.length&&v.profile.pans.every(row=>pansValid(row,12)));
      check(v.profile.lookupOffset===undefined||finite(v.profile.lookupOffset));
      check(v.profile.loopDuration===undefined||within(v.profile.loopDuration,.001,1200));
      check(v.profile.introDuration===undefined||within(v.profile.introDuration,0,1200));
      check(v.profile.introFrames===undefined||Number.isInteger(v.profile.introFrames)&&within(v.profile.introFrames,0,(v.profile.frequencies?.length??1)-1));
      check(['average','cluster'].includes(v.profile.mode)&&['original','sine','triangle','sawtooth','square','pluck','bubble','electric'].includes(v.waveform));
      if(v.profile.mode==='average')check(finite(v.phase)&&finite(v.frequency)&&v.profile.frequencies?.length>0&&Array.from(v.profile.frequencies).every(finite));
      else check(v.phases instanceof Float64Array&&v.phases.length===12&&v.phases.every(finite));
      check(v.profile.weights.every(row=>Array.isArray(row)&&row.length===12&&row.every(finite)));
    }
    if(t.fieldScene)sceneValid(t.fieldScene);
  }
  return p;
}

export async function captureProjectTracks(sound,tracks,{frozen=false}={}){
  const ctx=sound.context,frame=Math.ceil((ctx.currentTime+.1)*ctx.sampleRate/128)*128;
  const slots=tracks.filter(t=>t.continuous).map(t=>t.source.slot);
  const [voices,buffers]=frozen?[null,[]]:await Promise.all([
    slots.length?sound.snapshotContinuous(slots,frame):null,
    Promise.all(tracks.map(t=>t.continuous?null:t.source.snapshot(frame)))
  ]);
  return {time:frozen||!tracks.length?ctx.currentTime:frame/ctx.sampleRate,tracks:tracks.map((t,i)=>{
    const voice=t.continuous?structuredClone(frozen?t.projectVoice:voices.tracks.find(v=>v.slot===t.source.slot).state):null;
    const tempo=trackTempo(t),normal=t.appliedNormalSpeed??tempo.normal,stretch=t.appliedStretchSpeed??tempo.stretch;
    if(voice){voice.settings={...t.settings};voice.rate=t.baseDuration/t.buffer.duration;voice.pitchSpeed=normal;}
    const duration=t.buffer.duration,position=t.continuous?voice.profile.position/voice.rate:frozen?(t.paused?t.pausePosition:((ctx.currentTime-t.startedAt)%duration+duration)%duration):((buffers[i].state.position/t.buffer.sampleRate)%duration+duration)%duration;
    const channels=bufferChannels(t.buffer);
    return {original:t.original,originalChannels:t.originalChannels,channels,samples:channels?monoMix(channels):t.buffer.getChannelData(0).slice(),pitchSamples:t.pitchSamples,pitchChannels:t.pitchChannels,pitchKey:t.pitchKey,
      settings:{...t.settings},speed:normal*stretch,normalSpeed:normal,stretchSpeed:stretch,speedMode:t.speedMode??'stretch',baseDuration:t.baseDuration,waveform:t.waveform,
      continuous:t.continuous,paused:!!t.paused,volume:t.volume,muted:t.muted,solo:t.solo,position,pitchMap:t.pitchMap,pitchCorrection:t.pitchCorrection,
      fx:structuredClone(t.fx),fieldScene:t.fieldScene,voice};
  })};
}
