import test from 'node:test';
import assert from 'node:assert/strict';
import { planCycleExport, encodeWav, MixCapture, loadExportModule } from '../recording-export.js';
import { LoopRecorder } from '../loops.js';

const track=(id,seconds,extra={})=>({id,buffer:{duration:seconds,length:Math.round(seconds*48000)},startedAt:1.25,volume:1,muted:false,solo:false,...extra});
test('cycle export starts at the anchor’s next beginning and includes every audible page',()=>{
  const tracks=[track(1,4),track(2,6),track(3,2),track(4,3),track(5,5)];
  const plan=planCycleExport(tracks,2,48000,8);
  assert.equal(plan.when,13.25);assert.equal(plan.duration,60);assert.equal(plan.frames,2880000);
  assert.deepEqual(plan.trackIds,[1,2,3,4,5]);
  for(const item of tracks)assert.equal(plan.frames%item.buffer.length,0);
});
test('cycle export respects volume, mute and Solo and uses actual rendered speed durations',()=>{
  const tracks=[track(1,4,{muted:true}),track(2,3,{solo:true}),track(3,2,{solo:true}),track(4,5),track(5,1,{volume:0,solo:true})];
  const plan=planCycleExport(tracks,1,48000,1.2);
  assert.equal(plan.duration,6);assert.equal(plan.anchorId,2);assert.deepEqual(plan.trackIds,[2,3]);assert.equal(plan.when,4.25);
  assert.throws(()=>planCycleExport([track(1,4,{muted:true})],1,48000),/exportNoTracks/);
  assert.throws(()=>planCycleExport([track(1,4,{worker:{}})],1,48000),/exportTrackBusy/);
});
test('long common periods explicitly truncate at 10 minutes while keeping the anchor alignment',()=>{
  const plan=planCycleExport([track(1,31),track(2,29)],1,48000,5);
  assert.equal(plan.truncated,true);assert.equal(plan.duration,600);assert.equal(plan.frames,600*48000);assert.equal(plan.when,32.25);
  assert.equal(planCycleExport([track(1,4),track(2,6)],1,48000).truncated,false);
});
test('WAV is a valid mono 16-bit PCM stream with correct sample rate, length and clipping',()=>{
  const view=new DataView(encodeWav(Float32Array.of(-2,-1,0,.5,1,2,NaN),48000));
  const str=(a,n)=>String.fromCharCode(...Array.from({length:n},(_,i)=>view.getUint8(a+i)));
  assert.equal(str(0,4),'RIFF');assert.equal(str(8,4),'WAVE');assert.equal(str(36,4),'data');
  assert.equal(view.getUint32(4,true)+8,view.byteLength);assert.equal(view.getUint32(40,true),14);
  assert.equal(view.getUint16(20,true),1);assert.equal(view.getUint16(22,true),1);assert.equal(view.getUint32(24,true),48000);
  assert.equal(view.getUint32(28,true),96000);assert.equal(view.getUint16(34,true),16);
  assert.deepEqual(Array.from({length:7},(_,i)=>view.getInt16(44+i*2,true)),[-32768,-32768,0,16384,32767,32767,0]);
});
test('export worklet starts inside an audio block, ends at the exact frame, and never doubles playback',async t=>{
  const names=['AudioWorkletProcessor','registerProcessor','currentFrame','sampleRate'],saved=names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]);
  t.after(()=>{for(const [name,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
  let Processor;const messages=[];
  globalThis.sampleRate=100;globalThis.currentFrame=0;
  globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage:data=>messages.push(data)};}};
  globalThis.registerProcessor=(_name,type)=>{Processor=type;};await import('../recording-export-worklet.js');
  const processor=new Processor();processor.port.onmessage({data:{type:'start',when:.03,frames:7}});
  const output=new Float32Array(8);processor.process([[Float32Array.from({length:8},(_,i)=>i)]],[[output]]);
  globalThis.currentFrame=8;processor.process([[Float32Array.from({length:8},(_,i)=>8+i)]],[[output]]);
  assert.deepEqual([...messages.find(item=>item.type==='chunk').samples],[3,4,5,6,7,8,9]);
  assert.deepEqual([...output],Array(8).fill(0));assert.equal(messages.at(-1).type,'done');
  assert.equal(processor.process([],[[output]]),false);
  const waiting=new Processor();waiting.port.onmessage({data:{type:'start',when:10,frames:5}});
  const count=messages.filter(item=>item.type==='chunk').length;
  waiting.process([[Float32Array.of(1,2)]],[[new Float32Array(2)]]);waiting.port.onmessage({data:{type:'stop'}});
  assert.equal(messages.filter(item=>item.type==='chunk').length,count);
});

test('mix capture taps post-limiter output or an explicit track-only bus, cleans up, and reports processor failure',async t=>{
  const previous=globalThis.AudioWorkletNode;t.after(()=>{if(previous===undefined)delete globalThis.AudioWorkletNode;else globalThis.AudioWorkletNode=previous;});
  const connections=[],disconnections=[];let failOnStart=false;
  globalThis.AudioWorkletNode=class{
    constructor(){this.port={close(){},postMessage:message=>queueMicrotask(()=>{
      if(message.type==='start'){if(failOnStart)this.onprocessorerror();else this.port.onmessage({data:{type:'armed'}});}
      else {this.port.onmessage({data:{type:'chunk',samples:Float32Array.of(.2,.4)}});this.port.onmessage({data:{type:'done'}});}
    })};}
    connect(target){return target;}disconnect(){}
  };
  const bus=name=>({connect(node){connections.push([name,node]);},disconnect(node){disconnections.push([name,node]);}});
  const sound={limiter:bus('master limiter'),live:bus('live'),context:{currentTime:2,sampleRate:48000,audioWorklet:{async addModule(){}},createGain:()=>({gain:{value:1},connect(){},disconnect(){}}),destination:{}},async start(){}};
  const capture=new MixCapture(sound);await capture.start();assert.equal(connections[0][0],'master limiter');
  const recorded=await capture.stop();assert.deepEqual([...recorded.samples],[...Float32Array.of(.2,.4)]);
  assert.equal(recorded.sampleRate,48000);assert.equal(capture.active,false);assert.equal(disconnections[0][0],'master limiter');
  const tracks=bus('track-only limiter'),cycle=new MixCapture(sound);await cycle.start({input:tracks,when:3,duration:1});
  assert.equal(cycle.startedAt,3);assert.equal(connections.at(-1)[0],'track-only limiter');
  const failed=assert.rejects(cycle.done,/exportFailed/);cycle.node.onprocessorerror();await failed;
  assert.equal(cycle.active,false);assert.equal(disconnections.at(-1)[0],'track-only limiter');
  failOnStart=true;const startup=new MixCapture(sound);await assert.rejects(startup.start(),/exportFailed/);assert.equal(startup.active,false);
});

test('a failed export module load can be retried without reloading the page',async()=>{
  let calls=0;const sound={context:{audioWorklet:{async addModule(){if(++calls===1)throw new Error('network');}}}};
  await assert.rejects(loadExportModule(sound),/network/);assert.equal(sound.exportModule,null);
  await loadExportModule(sound);await loadExportModule(sound);assert.equal(calls,2);
});

test('saved loops connect to the isolated track bus without changing the live output path',()=>{
  const trackBus={},master={},connections=[];
  const recorder=new LoopRecorder({context:{},tracksBus:trackBus,master},{effectsFactory:()=>({input:{},output:{connect(target){return target;}}})});
  const track={buffer:{duration:1},startedAt:0,playbackGain:{connect(){}},gain:{connect(target){connections.push(target);}}};
  recorder.connectEffects(track);assert.deepEqual(connections,[trackBus]);
});
