import test from 'node:test';
import assert from 'node:assert/strict';
import { TrackCapture } from '../recording-export.js';
import { LoopRecorder } from '../loops.js';
import { analyseRecording } from '../recording-dsp.js';
import { TrackEffectDSP } from '../effects-dsp.js';

class Node {
  constructor(){this.outputs=new Set();}
  connect(node){this.outputs.add(node);node.input=this;return node;}
  disconnect(node){if(node)this.outputs.delete(node);else this.outputs.clear();}
}
class Gain extends Node {
  constructor(){super();const gain=this.gain={value:1,cancelScheduledValues(){},setTargetAtTime(value){gain.value=value;}};}
  sample(i){return (this.input?.sample(i)??0)*this.gain.value;}
}
function workletMock(t){
  const original=globalThis.AudioWorkletNode;
  t.after(()=>{if(original===undefined)delete globalThis.AudioWorkletNode;else globalThis.AudioWorkletNode=original;});
  globalThis.AudioWorkletNode=class extends Node {
    constructor(){
      super();this.closed=false;this.port={close:()=>this.closed=true,postMessage:message=>queueMicrotask(()=>{
        if(message.type==='start'){this.frames=message.frames;this.port.onmessage({data:{type:'armed'}});}
        else this.port.onmessage({data:{type:'done'}});
      })};
    }
    record(start,count){const samples=Float32Array.from({length:count},(_,i)=>this.input.sample(start+i));this.port.onmessage({data:{type:'chunk',samples}});return samples;}
  };
}
function soundMock(){
  return {context:{currentTime:0,sampleRate:8000,audioWorklet:{async addModule(){}},createGain:()=>new Gain(),destination:{}},
    live:{connect(){assert.fail('must not tap the live field');}},
    limiter:{connect(){assert.fail('must not tap the master mix');}},async start(){}};
}

test('track recording captures post-effect edits and its own gain, excluding the live field and other Solo tracks',async t=>{
  workletMock(t);const sound=soundMock(),dsp=new TrackEffectDSP(8000),output=new Node(),playback=new Node();
  output.connect(playback);output.sample=i=>dsp.next(.2*Math.sin(i*.17),i/8000);
  const track={volume:.7,muted:false,solo:false,gain:new Gain(),effects:{output}},other={volume:2,muted:false,solo:true,gain:new Gain()};
  const recorder=new LoopRecorder(sound);recorder.tracks=[track,other];
  const capture=new TrackCapture(sound,track);await capture.start();
  const tap=capture.tap;assert.equal(output.outputs.size,2);assert.equal(tap.input,output);assert.equal(capture.node.input,tap);
  assert.equal(capture.node.frames,600*8000);
  recorder.mix();assert.equal(track.gain.gain.value,0);assert.equal(tap.gain.value,.7);
  const before=capture.node.record(0,1000);
  dsp.setState({drive:{enabled:true,drive:1,fuzz:1,mix:1}});track.volume=.3;other.volume=0;recorder.mix();
  assert.equal(tap.gain.value,.3);const after=capture.node.record(1000,1000);
  track.muted=true;recorder.mix();const muted=capture.node.record(2000,1000);assert.ok(muted.every(v=>v===0));
  const result=await capture.stop();assert.deepEqual(result.samples,new Float32Array([...before,...after,...muted]));
  assert.ok(before.some(v=>Math.abs(v)>.01)&&after.some(v=>Math.abs(v)>.01));
  assert.equal(track.recordCapture,undefined);assert.deepEqual([...output.outputs],[playback]);assert.equal(tap.outputs.size,0);
});

test('a failed track recorder startup disconnects only its private tap and allows a retry',async t=>{
  workletMock(t);const sound=soundMock();let attempts=0;
  sound.context.audioWorklet.addModule=async()=>{if(++attempts===1)throw new Error('load failed');};
  const output=new Node(),playback=new Node();output.connect(playback);
  const track={volume:1,muted:false,effects:{output}},failed=new TrackCapture(sound,track);
  await assert.rejects(failed.start(),/load failed/);assert.deepEqual([...output.outputs],[playback]);assert.equal(track.recordCapture,undefined);
  const retry=new TrackCapture(sound,track);await retry.start();await retry.stop();
  assert.equal(attempts,2);assert.deepEqual([...output.outputs],[playback]);
});

test('recorded track PCM becomes a separate editable loop without modifying its source or copying its effects',async t=>{
  const oldWorker=globalThis.Worker;t.after(()=>{if(oldWorker===undefined)delete globalThis.Worker;else globalThis.Worker=oldWorker;});
  const samples=Float32Array.from({length:8000},(_,i)=>.2*Math.sin(i*.1)),starts=[];
  globalThis.Worker=class {postMessage(data){assert.equal(data.samples,samples);queueMicrotask(()=>this.onmessage({data:{pitchMap:analyseRecording(data.samples,8000)}}));}terminate(){}};
  const ctx={sampleRate:8000,currentTime:5,createGain:()=>new Gain(),createBuffer:(_channels,n,r)=>({length:n,duration:n/r,data:null,copyToChannel(data){this.data=data.slice();}})};
  const sound={context:ctx,master:{},createTrackGain:()=>new Gain(),createBufferLoop:()=>Object.assign(new Node(),{start:(_when,offset)=>starts.push(offset)})};
  const recorder=new LoopRecorder(sound,{effectsFactory:()=>({input:new Node(),output:new Node(),setOrigin(){}})});
  const original={id:99,buffer:{duration:2},settings:{start:.2,end:.4},volume:.8,muted:false,solo:false,gain:new Gain()};
  recorder.tracks.push(original);const saved=structuredClone({buffer:original.buffer,settings:original.settings});
  const created=await recorder.addRecording(samples);
  assert.equal(recorder.tracks.length,2);assert.deepEqual(original.buffer,saved.buffer);assert.deepEqual(original.settings,saved.settings);
  assert.equal(created.waveform,'recording');assert.equal(created.continuous,false);assert.equal(created.fieldScene,undefined);
  assert.deepEqual(created.original,samples);assert.deepEqual(created.buffer.data,samples);assert.equal(created.buffer.duration,1);
  assert.deepEqual(created.settings,{start:0,end:0,lowPitch:0,highPitch:127});assert.equal(created.fx.drive.enabled,false);assert.equal(created.fx.delay.enabled,false);
  assert.deepEqual(starts,[0]);
  original.recordCapture={};recorder.remove(original.id);assert.ok(recorder.tracks.includes(original));
});

test('new recording loops enforce the track count and minimum duration',async()=>{
  const recorder=new LoopRecorder({context:{sampleRate:8000}});
  await assert.rejects(recorder.addRecording(new Float32Array(3999)),/recordEmpty/);
  recorder.tracks=Array.from({length:16},()=>({}));await assert.rejects(recorder.addRecording(new Float32Array(8000)),/recordLimit/);
});
