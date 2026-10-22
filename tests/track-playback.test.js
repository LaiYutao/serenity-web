import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceTrackState } from '../track-state.js';
import { BufferVoice, GainState, cloneState, restoreState } from '../stateful-dsp.js';
import { ContinuousTone, ContinuousCluster } from '../continuous-dsp.js';
import { TrackEffectDSP } from '../effects-dsp.js';
import { LoopRecorder, trackPosition, loopGain } from '../loops.js';
import { planCycleExport } from '../recording-export.js';
import { monoMix } from '../stereo.js';
import { fixture } from './fixtures/project.js';
import { encodeProject, decodeProject } from '../project.js';

const rate=8000;
function state(kind='buffer'){
 const voice=kind==='buffer'?new BufferVoice(Float32Array.from({length:701},(_,i)=>Math.sin(i*.17)*.2),.3):kind==='cluster'?new ContinuousCluster():new ContinuousTone();
 if(kind==='buffer'){voice.channels=[voice.samples.map(v=>v*1.4),voice.samples.map(v=>v*.6)];voice.samples=monoMix(voice.channels);}
 else{voice.waveform='electric';voice.install({mode:kind==='cluster'?'cluster':'average',duration:.73,offset:.317,frequencies:[290,410],weights:[Array(12).fill(.04),Array(12).fill(.07)],pans:[Array(12).fill(-.4),Array(12).fill(.3)],panFrames:[-.4,.3],pitchRate:1.25});voice.rate=1.25;voice.pitchSpeed=.75;}
 const fx=new TrackEffectDSP(rate,.73,-.317),r=new TrackEffectDSP(rate,.73,-.317);
 for(const d of [fx,r])d.setState({drive:{enabled:true,drive:.6,fuzz:.7,mix:.45},filter:{enabled:true,cutoff:1700},delay:{enabled:true,time:.037,feedback:.6,mix:.4},fade:{enabled:true,inTime:.2,outTime:.3}});
 return {frame:0,kind,voice:cloneState(voice),effects:{...fx.snapshot(),right:r.snapshot()},gain:{...new GainState(.7)}};
}
function render(s,n){
 const Type=s.kind==='buffer'?BufferVoice:s.kind==='cluster'?ContinuousCluster:ContinuousTone,v=restoreState(Type,s.voice),l=TrackEffectDSP.restore(s.effects),r=TrackEffectDSP.restore(s.effects.right),g=restoreState(GainState,s.gain),out=[[],[]],scale=s.kind==='buffer'?1:(s.kind==='cluster'?12000:10000)/32768;
 for(let i=0;i<n;i++){v.next(s.kind==='buffer'?s.frame+i:rate);const gain=g.next(rate);out[0].push(Math.fround(l.next(Math.fround(v.left*scale),(s.frame+i)/rate))*gain);out[1].push(Math.fround(r.next(Math.fround(v.right*scale),(s.frame+i)/rate))*gain);}
 return out;
}
test('copies compensate elapsed frames with sample-exact carriers, stereo and effect tails for every track source',()=>{
 for(const kind of ['buffer','tone','cluster']){
  const original=advanceTrackState(state(kind),4096,rate),copy=advanceTrackState(original,8192,rate);
  const uninterrupted=render(original,5120),copied=render(copy,1024);
  assert.deepEqual(copied,uninterrupted.map(c=>c.slice(4096)));
  assert.ok(copied.some(c=>c.some(v=>v!==0)));
  copy.voice.settings&&(copy.voice.settings.start=.9);assert.notDeepEqual(copy.voice,original.voice);
 }
});
test('pause freezes carriers, stereo smoothing and delay state; resume continues the same sound at the new wall clock',()=>{
 for(const kind of ['buffer','tone','cluster']){
  const active=advanceTrackState(state(kind),4096,rate),paused=structuredClone(active);paused.voice.paused=true;
  for(const key of ['effects']){const left=TrackEffectDSP.restore(paused[key]),right=TrackEffectDSP.restore(paused[key].right);left.setPaused(true,paused.frame/rate);right.setPaused(true,paused.frame/rate);paused[key]={...left.snapshot(),right:right.snapshot()};}
  const after=advanceTrackState(paused,12288,rate);assert.equal(after.voice.position??after.voice.profile.position,paused.voice.position??paused.voice.profile.position);
  assert.deepEqual(after.effects.history,paused.effects.history);assert.ok(render(after,128).every(c=>c.every(v=>v===0)));
  after.voice.paused=false;for(const key of ['effects']){const left=TrackEffectDSP.restore(after[key]),right=TrackEffectDSP.restore(after[key].right);left.setPaused(false,after.frame/rate);right.setPaused(false,after.frame/rate);after[key]={...left.snapshot(),right:right.snapshot()};}
  const resumed=render(after,512),expected=render(active,512);
  for(let c=0;c<2;c++)for(let i=0;i<512;i++)assert.ok(Math.abs(resumed[c][i]-expected[c][i])<1e-7);
 }
});

class Node {connect(target){return target;}disconnect(){} stop(){} restore(state,when){this.restored=state;this.when=when;} setPaused(paused,when){this.paused=paused;this.when=when;}}
class Gain extends Node {constructor(){super();this.gain={value:1,cancelScheduledValues(){},setTargetAtTime(value){this.value=value;}};}}
test('track duplication creates independent edits at a shared future position, inserts beside the source and enforces limits',async()=>{
 const initial=state(),ctx={sampleRate:rate,currentTime:.3,createGain:()=>new Gain()},fx=()=>Object.assign(new Node(),{input:new Node(),output:new Node(),setState(){}});
 const sound={context:ctx,async start(){},createBufferLoop:()=>new Node(),createTrackGain:()=>new Gain(),connectTrack:()=>1};
 const recorder=new LoopRecorder(sound,{effectsFactory:fx}),buffer={sampleRate:rate,duration:701/rate,numberOfChannels:2,getChannelData:i=>initial.voice.channels[i]};
 const at=frame=>advanceTrackState(initial,frame,rate);
 const source=Object.assign(new Node(),{snapshot:async frame=>({frame,state:at(frame).voice})});
 const track={id:10,continuous:false,buffer,source,gain:Object.assign(new Gain(),{snapshot:async frame=>({frame,state:at(frame).gain})}),effects:Object.assign(fx(),{snapshot:async frame=>({frame,state:at(frame).effects})}),settings:{start:0,end:0,lowPitch:0,highPitch:127},pitchMap:{mode:'recording'},fx:{delay:{enabled:true}},normalSpeed:1,stretchSpeed:1,volume:.7,muted:false,solo:false,startedAt:0,fieldScene:{settings:{mode:'cluster'}}};
 recorder.tracks=[track];const copy=await recorder.duplicate(track);
 assert.deepEqual(recorder.tracks,[track,copy]);assert.notEqual(copy.source,track.source);assert.notEqual(copy.gain,track.gain);assert.notEqual(copy.effects,track.effects);
 assert.equal(copy.source.when,copy.effects.when);assert.equal(copy.source.when,copy.gain.when);
 const expected=at(Math.round(copy.source.when*rate));assert.deepEqual(copy.source.restored,expected.voice);assert.deepEqual(copy.effects.restored,expected.effects);
 assert.ok(Math.abs(trackPosition(copy,copy.source.when)-expected.voice.position/rate)<1e-9);
 copy.settings.start=.4;copy.fx.delay.enabled=false;copy.fieldScene.settings.mode='average';assert.equal(track.settings.start,0);assert.equal(track.fx.delay.enabled,true);assert.equal(track.fieldScene.settings.mode,'cluster');
 track.worker={};await assert.rejects(recorder.duplicate(track),/exportTrackBusy/);delete track.worker;
 recorder.tracks=Array(16).fill(track);await assert.rejects(recorder.duplicate(track),/recordLimit/);assert.equal(recorder.copying,false);
});
test('single-track pause retains playhead through wall time and tempo changes and excludes it from cycle export',()=>{
 const ctx={sampleRate:rate,currentTime:3,createBuffer:(_c,n,r)=>({duration:n/r,copyToChannel(){}})},sound={context:ctx},recorder=new LoopRecorder(sound),calls=[];
 const track={id:1,continuous:true,buffer:{duration:4},source:{setPaused:(...args)=>calls.push(['source',...args]),setRate(){}},effects:{setPaused:(...args)=>calls.push(['fx',...args]),setDuration(){},setOrigin(){}},gain:new Gain(),volume:1,startedAt:0,baseDuration:4};recorder.tracks=[track];
 recorder.setPaused(track,true);const held=trackPosition(track,10);assert.equal(held,trackPosition(track,100));assert.deepEqual(calls[0].slice(1),calls[1].slice(1));assert.equal(loopGain(track,[track]),0);assert.throws(()=>planCycleExport([track],1,rate),/exportNoTracks/);
 ctx.currentTime=10;recorder.swap(track,new Float32Array(2*rate),2);assert.ok(Math.abs(trackPosition(track,100)-held/2)<1e-9);
 recorder.setPaused(track,false);const when=calls.at(-1)[2];assert.ok(Math.abs(trackPosition(track,when)-held/2)<1e-9);assert.ok(Math.abs(trackPosition(track,when+.2)-(held/2+.2))<1e-9);
});
test('projects retain per-track pause without changing old project compatibility',async()=>{
 const p=fixture();p.tracks[0].paused=true;p.tracks[0].voice.paused=true;
 assert.equal((await decodeProject(encodeProject(p))).tracks[0].paused,true);
 p.tracks[0].paused='yes';assert.throws(()=>encodeProject(p),/projectInvalid/);
});

test('actual worklets schedule aligned restore and pause/resume without advancing stopped voices',async t=>{
 const keys=['AudioWorkletProcessor','registerProcessor','currentFrame','currentTime','sampleRate'],saved=keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]),types=new Map();
 t.after(()=>{for(const [k,v]of saved){if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];}});
 globalThis.sampleRate=rate;globalThis.currentFrame=0;globalThis.currentTime=0;
 globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage(){}};}};globalThis.registerProcessor=(name,Type)=>types.set(name,Type);
 await import('../stateful-worklet.js');await import('../continuous-worklet.js');await import('../effects-worklet.js');
 const Buffer=types.get('stateful-buffer'),buffer=new Buffer(),s=state(),send=(node,data)=>node.port.onmessage({data}),out=()=>[[new Float32Array(128),new Float32Array(128)]];
 send(buffer,{type:'restore',state:s.voice,frame:128});buffer.process([],out());assert.equal(buffer.voice.samples.length,0);
 globalThis.currentFrame=128;globalThis.currentTime=128/rate;send(buffer,{type:'pause',paused:true,frame:160});buffer.process([],out());const position=buffer.voice.position;assert.ok(Math.abs(position-s.voice.position-32)<1e-9);
 globalThis.currentFrame=256;buffer.process([],out());assert.equal(buffer.voice.position,position);
 send(buffer,{type:'pause',paused:false,frame:288});buffer.process([],out());assert.ok(Math.abs(buffer.voice.position-position-96)<1e-9);
 const Field=types.get('continuous-field'),field=new Field(),c=state('cluster');send(field,{type:'restore',slot:1,state:c.voice,frame:384});
 globalThis.currentFrame=384;globalThis.currentTime=384/rate;send(field,{type:'pause',slot:1,paused:true,frame:416});field.process([],Array.from({length:17},()=>[new Float32Array(128),new Float32Array(128)]));const phase=field.tracks.get(1).phases.slice();
 globalThis.currentFrame=512;field.process([],Array.from({length:17},()=>[new Float32Array(128),new Float32Array(128)]));assert.deepEqual(field.tracks.get(1).phases,phase);
 const FX=types.get('track-effects'),fx=new FX({processorOptions:{duration:1}});send(fx,{type:'restore',state:s.effects,frame:640});globalThis.currentFrame=640;globalThis.currentTime=640/rate;send(fx,{type:'pause',paused:true,frame:640});const silence=out();fx.process([[new Float32Array(128).fill(.5),new Float32Array(128).fill(.2)]],silence);assert.ok(silence[0].every(c=>c.every(v=>v===0)));assert.equal(fx.dsp.cursor,s.effects.cursor);
});
