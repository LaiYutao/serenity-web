import test from 'node:test';
import assert from 'node:assert/strict';
import { envelope, loopGain, paginateTracks, LoopRecorder } from '../loops.js';

test('solo never unmutes a muted loop and leaves unsoloed loops silent',()=>{
  const a={volume:.7,muted:false,solo:false},b={volume:.4,muted:false,solo:false};
  assert.equal(loopGain(a,[a,b]),.7);b.solo=true;
  assert.equal(loopGain(a,[a,b]),0);assert.equal(loopGain(b,[a,b]),.4);
  b.muted=true;assert.equal(loopGain(b,[a,b]),0);
});
test('abstract envelope retains quiet sections and handles silence',()=>{
  assert.deepEqual([...envelope(new Float32Array(20),4)],[0,0,0,0]);
  const values=envelope(Float32Array.from([0,0,1,-1,0,0,.25,-.25]),4);
  assert.equal(values[0],0);assert.equal(values[1],1);assert.equal(values[2],0);assert.ok(values[3]>0&&values[3]<1);
});

test('three tracks per page, including an empty last slot and page clamping after deletion',()=>{
 const tracks=Array.from({length:7},(_,id)=>({id}));
 assert.deepEqual(paginateTracks(tracks,0).tracks.map(t=>t.id),[0,1,2]);
 assert.deepEqual(paginateTracks(tracks,1).tracks.map(t=>t.id),[3,4,5]);
 assert.deepEqual(paginateTracks(tracks,2).tracks.map(t=>t.id),[6]);
 assert.equal(paginateTracks(tracks.slice(0,6),2).page,1);
 assert.deepEqual(paginateTracks([],3),{page:0,pages:1,tracks:[]});
});


test('new loops compensate synthesis delay using the field clock, including pause and cycle wrapping',async t=>{
 const previousWorker=globalThis.Worker;
 t.after(()=>{if(previousWorker===undefined)delete globalThis.Worker;else globalThis.Worker=previousWorker;});
 for(const advanced of [.75,4.75,0]){
  const starts=[];
  const ctx={currentTime:5,sampleRate:100,
   createBuffer:(_channels,length,rate)=>({duration:length/rate,copyToChannel(){}}),
   createBufferSource:()=>({playbackRate:{setValueAtTime(){}},connect(node){return node;},start(when,offset){starts.push({when,offset});}}),
   createGain:()=>({connect(node){return node;},gain:{cancelScheduledValues(){},setTargetAtTime(){}}})};
  globalThis.Worker=class{
   postMessage(){queueMicrotask(()=>{ctx.currentTime=8.25;this.onmessage({data:{samples:new Float32Array(200),pitchMap:null}});});}
   terminate(){}
  };
  const recorder=new LoopRecorder({context:ctx,waveform:'sine',mode:'cluster',master:{},async start(){}},{effectsFactory:()=>({input:{},output:{connect(){}},setOrigin(){}})});
  await recorder.capture({},()=>advanced);
  assert.equal(starts[0].when,8.25);
  assert.equal(starts[0].offset,advanced%2);
  // The playhead and later buffer edits use the same phase origin as the audio.
  assert.equal((ctx.currentTime-recorder.tracks[0].startedAt)%2,advanced%2);
  assert.equal(recorder.tracks[0].buffer.duration,2);
 }
});
