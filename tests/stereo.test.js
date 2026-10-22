import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, musicMapping, sampleDistribution } from '../simulation.js';
import { snapshotField, renderCycle } from '../cycle-dsp.js';
import { ContinuousTone, ContinuousCluster } from '../continuous-dsp.js';
import { PAN_WIDTH, monoMix } from '../stereo.js';
import { encodeWav } from '../recording-export.js';
import { renderTrackAudio } from '../track-tempo-dsp.js';
import { encodeProject, decodeProject } from '../project.js';
import { fixture } from './fixtures/project.js';
import { BufferVoice, GainState, SnapshotCompressor, cloneState } from '../stateful-dsp.js';
import { TrackEffectDSP } from '../effects-dsp.js';
import { renderOfflineAudio } from '../recording-offline-dsp.js';

const close=(a,b,epsilon=1e-6)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
test('spatial mapping preserves every note and normalizes overlapping selections to their shared bounds',()=>{
 const sim=new Simulation(10,2);sim.bins.fill(6);sim.bins[2]=0;sim.bins[7]=12;
 const regions=[{left:2,right:3,top:0,bottom:0},{left:6,right:7,top:0,bottom:0},{left:2,right:3,top:0,bottom:0}];
 const mono=musicMapping(sim.distributionFor(regions)),stereo=musicMapping(sampleDistribution(sim,regions,0,true));
 assert.deepEqual(stereo.weights,mono.weights);assert.equal(stereo.hertz,mono.hertz);
 close(stereo.pans[0],-PAN_WIDTH);close(stereo.pans[12],PAN_WIDTH);close(stereo.pan,0);
 const single=musicMapping(sampleDistribution(sim,[{left:2,right:2,top:0,bottom:0}],0,true));assert.equal(single.pan,0);
 const empty=musicMapping(sampleDistribution(sim,[{left:20,right:25,top:0,bottom:1}],0,true));assert.equal(empty.pan,0);assert.equal(empty.hertz,0);
});

test('mirroring a field swaps its stereo image without changing pitch, rhythm or the mono mix',()=>{
 for(const mode of ['cluster','average'])for(const waveform of ['sine','bubble','electric']){
  const render=x=>{const sim=new Simulation(21,17);sim.plant('circle',x,8,3,.25);sim.step(1.2);const snapshot=snapshotField(sim,[]);snapshot.sampleInterval=.2;return renderCycle(snapshot,mode,waveform,8000);};
  const a=render(3),b=render(17);assert.deepEqual(a.samples,b.samples);assert.equal(a.channels.length,2);
  let difference=0;
  for(let i=0;i<a.samples.length;i++){
   close((a.channels[0][i]+a.channels[1][i])/2,a.samples[i]);
   close(a.channels[0][i],b.channels[1][i]);close(a.channels[1][i],b.channels[0][i]);
   difference+=Math.abs(a.channels[0][i]-a.channels[1][i]);
  }
  assert.ok(difference>1,`${mode} ${waveform} must have a spatial image`);
 }
 const sim=new Simulation(21,17);sim.plant('circle',10,8,3,.25);sim.step(3);
 const centred=renderCycle(snapshotField(sim,[]),'cluster','sine',8000);
 for(let i=0;i<centred.samples.length;i++)close(centred.channels[0][i],centred.channels[1][i]);
});

test('stereo voices smooth position changes, preserve the quiet ear and resume both channels exactly',()=>{
 for(const Type of [ContinuousTone,ContinuousCluster]){
  const voice=new Type();voice.waveform='sine';
  voice.install({duration:1,offset:0,frequencies:[440],weights:[Array.from({length:12},(_,i)=>i===9?1:0)],pans:[Array(12).fill(-PAN_WIDTH)],panFrames:[-PAN_WIDTH],pitchRate:1});
  for(let i=0;i<8000;i++){
   const mono=voice.next(8000);close((voice.left+voice.right)/2,mono);
   if(i>4000&&Math.abs(mono)>.1)close(voice.left/voice.right,(1+PAN_WIDTH)/(1-PAN_WIDTH),1e-4);
  }
  const copy=Object.assign(new Type(),structuredClone(voice));
  for(let i=0;i<1000;i++){assert.equal(copy.next(8000),voice.next(8000));assert.equal(copy.left,voice.left);assert.equal(copy.right,voice.right);}
  voice.settings={start:0,end:1,lowPitch:0,highPitch:127};voice.next(8000);assert.equal(voice.left,0);assert.equal(voice.right,0);
 }
 const live=new ContinuousTone();live.frequency=live.target=440;live.next(8000);live.targetPan=-PAN_WIDTH;live.next(8000);assert.ok(Math.abs(live.pan)<.002);
});

test('stereo Normal and Stretch share grain alignment and retain the original channel relationship',()=>{
 const rate=8000,left=Float32Array.from({length:rate},(_,i)=>.3*Math.sin(2*Math.PI*440*i/rate)),right=left.map(v=>v*.37),channels=[left,right];
 for(const [normal,stretch] of [[1,.25],[1,2],[2,.5],[.5,4]]){
  const out=renderTrackAudio({waveform:'recording',samples:monoMix(channels),channels,sampleRate:rate,duration:1,normalSpeed:normal,stretchSpeed:stretch,lowPitch:0,highPitch:127});
  assert.equal(out.samples.length,Math.round(rate/(normal*stretch)));
  for(let i=0;i<out.samples.length;i++)close(out.channels[1][i],out.channels[0][i]*.37,1e-6);
 }
});

test('stereo WAV headers and interleaving preserve independent left/right samples',()=>{
 const channels=[Float32Array.of(-1,.25),Float32Array.of(.5,1)],view=new DataView(encodeWav(monoMix(channels),48000,channels));
 assert.equal(view.getUint32(4,true)+8,view.byteLength);
 assert.equal(view.getUint16(22,true),2);assert.equal(view.getUint16(32,true),4);assert.equal(view.getUint32(28,true),192000);assert.equal(view.getUint32(40,true),8);
 assert.deepEqual(Array.from({length:4},(_,i)=>view.getInt16(44+i*2,true)),[-32768,16384,8192,32767]);
});

test('stereo PCM and spatial profiles survive project storage while old mono projects remain valid',async()=>{
 const p=fixture(),track=p.tracks[1],channels=[track.samples.map(v=>v*1.3),track.samples.map(v=>v*.7)];
 track.originalChannels=channels;track.channels=channels;track.pitchChannels=channels;
 const restored=await decodeProject(encodeProject(p));assert.deepEqual(restored,p);
 const bad=structuredClone(p);bad.tracks[1].channels[1]=new Float32Array(1);assert.throws(()=>encodeProject(bad),/projectInvalid/);
 delete track.originalChannels;delete track.channels;delete track.pitchChannels;assert.ok(await decodeProject(encodeProject(p)));
});

test('offline stereo export exactly matches running effects, linked compression and channel cursors',()=>{
 const rate=8000,channels=[Float32Array.from({length:731},(_,i)=>.3*Math.sin(i*.13)),Float32Array.from({length:731},(_,i)=>.17*Math.sin(i*.23))];
 const voice=new BufferVoice(monoMix(channels),.375);voice.channels=channels;
 const fx=new TrackEffectDSP(rate,1),rightFX=new TrackEffectDSP(rate,1),gain=new GainState(.72),master=new GainState(.51),limiter=new SnapshotCompressor(rate);
 for(const f of [fx,rightFX])f.setState({drive:{enabled:true,drive:.65,fuzz:.7,tone:2300,mix:.6},delay:{enabled:true,time:.083,mix:.4,feedback:.6}});
 const block=frame=>{
  const out=[new Float32Array(128),new Float32Array(128)];
  for(let i=0;i<128;i++){
   voice.next(frame+i);const g=gain.next(rate),m=master.next(rate);
   const l=Math.fround(Math.fround(fx.next(Math.fround(voice.left),(frame+i)/rate))*g),r=Math.fround(Math.fround(rightFX.next(Math.fround(voice.right),(frame+i)/rate))*g);
   limiter.nextStereo(Math.fround(l*m),Math.fround(r*m));out[0][i]=limiter.left;out[1][i]=limiter.right;
  }
  return out;
 };
 for(let frame=0;frame<8192;frame+=128)block(frame);
 const snapshot={stereo:true,sampleRate:rate,frame:8192,startFrame:8365,frames:4096,master:{gain:cloneState(master),compressor:cloneState(limiter)},tracks:[{kind:'buffer',voice:cloneState(voice),effects:{...fx.snapshot(),right:rightFX.snapshot()},gain:cloneState(gain)}]};
 const actual=renderOfflineAudio(snapshot),expected=[new Float32Array(4096),new Float32Array(4096)];
 for(let frame=snapshot.frame;frame<snapshot.startFrame+snapshot.frames;frame+=128){const samples=block(frame),first=Math.max(0,snapshot.startFrame-frame),last=Math.min(128,snapshot.startFrame+snapshot.frames-frame);if(last>first)expected.forEach((c,i)=>c.set(samples[i].subarray(first,last),frame+first-snapshot.startFrame));}
 assert.deepEqual(actual.channels,expected);
});

test('actual worklets preserve independent channels through gains, mixing, playback, effects and both recorders',async t=>{
 const names=['AudioWorkletProcessor','registerProcessor','currentFrame','currentTime','sampleRate'],saved=names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]),processors=new Map();
 t.after(()=>{for(const [n,d] of saved){if(d)Object.defineProperty(globalThis,n,d);else delete globalThis[n];}});
 globalThis.currentFrame=0;globalThis.currentTime=0;globalThis.sampleRate=8000;
 globalThis.AudioWorkletProcessor=class{constructor(){this.messages=[];this.port={postMessage:data=>this.messages.push(data)};}};
 globalThis.registerProcessor=(name,Type)=>processors.set(name,Type);
 await import('../stateful-worklet.js');await import('../effects-worklet.js');await import('../recorder-worklet.js');await import('../recording-export-worklet.js');
 const input=[Float32Array.of(.2,.4,.6,.8),Float32Array.of(-.1,0,.3,.5)],outputs=()=>[[new Float32Array(4),new Float32Array(4)]];
 const Gain=processors.get('stateful-gain'),gain=new Gain();gain.port.onmessage({data:{type:'gain',value:.5,constant:0}});const g=outputs();gain.process([input],g);
 assert.deepEqual(g[0],input.map(c=>c.map(v=>v*.5)));
 const Mix=processors.get('stateful-track-mix'),mix=new Mix(),mixed=outputs();mix.process([input,input],mixed);assert.deepEqual(mixed[0],input.map(c=>c.map(v=>v*2)));
 const Buffer=processors.get('stateful-buffer'),buffer=new Buffer();buffer.port.onmessage({data:{type:'start',when:0,offset:0,samples:monoMix(input),channels:input}});const played=outputs();buffer.process([],played);assert.deepEqual(played[0],input);
 const Effects=processors.get('track-effects'),effects=new Effects({processorOptions:{duration:1}}),processed=outputs();effects.process([input],processed);assert.deepEqual(processed[0],input);
 for(const [name,start,stop] of [['live-pcm-recorder','start','stop'],['mix-export-recorder',{type:'start',when:0,frames:4},{type:'stop'}]]){
  const Recorder=processors.get(name),recorder=new Recorder(),silent=outputs();recorder.port.onmessage({data:start});recorder.process([input],silent);recorder.port.onmessage({data:stop});
  const chunk=recorder.messages.find(m=>m.type==='chunk');assert.deepEqual(chunk.channels,input);assert.deepEqual(chunk.samples,monoMix(input));assert.ok(silent[0].every(c=>c.every(v=>v===0)));
 }
 const Master=processors.get('stateful-master'),master=new Master();master.port.onmessage({data:{type:'gain',value:1,constant:0}});
 const constant=[new Float32Array(128).fill(.2),new Float32Array(128).fill(.1)],out=[...outputs(),...outputs()].map(()=>[new Float32Array(128),new Float32Array(128)]);
 master.process([constant,constant],out);close(out[0][0][100],.2);close(out[0][1][100],.1);close(out[1][0][100],.2);close(out[1][1][100],.1);
});
