import test from 'node:test';
import assert from 'node:assert/strict';
import { joinChunks, softenLoopEdges, LiveRecording } from '../recording.js';
import { analyseRecording, filterRecording } from '../recording-dsp.js';

test('direct recording preserves ordered chunks and duration, with only short click-prevention fades',()=>{
 const samples=joinChunks([Float32Array.of(1,2),Float32Array.of(3,4,5)]);assert.deepEqual([...samples],[1,2,3,4,5]);
 const original=new Float32Array(1000).fill(.5),soft=softenLoopEdges(original,1000);
 assert.equal(soft.length,original.length);assert.equal(soft[0],0);assert.equal(soft.at(-1),0);assert.equal(soft[50],.5);assert.equal(original[0],.5);
});
test('recorded audio filtering keeps in-range audio, removes out-of-range audio, and never resynthesizes',()=>{
 const rate=8192,samples=Float32Array.from({length:8192},(_,i)=>.3*Math.sin(2*Math.PI*256*i/rate)+.2*Math.sin(2*Math.PI*1024*i/rate));
 const neutral=filterRecording(samples,rate);assert.deepEqual(neutral,samples);
 const low=filterRecording(samples,rate,0,72),high=filterRecording(samples,rate,72,127);
 const amplitude=(data,hz)=>Math.abs(data.reduce((sum,x,i)=>sum+x*Math.sin(2*Math.PI*hz*i/rate),0)*2/data.length);
 assert.equal(low.length,samples.length);assert.ok(amplitude(low,256)>.29);assert.ok(amplitude(low,1024)<.001);
 assert.ok(amplitude(high,1024)>.19);assert.ok(amplitude(high,256)<.001);
 assert.ok(analyseRecording(samples,rate).levels.some(row=>row.some(value=>value>.01)));
});
test('capture worklet records speed/timbre changes as received and flushes the final partial chunk',async t=>{
 const names=['AudioWorkletProcessor','registerProcessor','currentTime'],saved=names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]);
 t.after(()=>{for(const [name,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
 let Processor;globalThis.currentTime=3.5;
 const messages=[];globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage:data=>messages.push(data)};}};
 globalThis.registerProcessor=(_name,type)=>{Processor=type;};await import('../recorder-worklet.js');
 const recorder=new Processor();recorder.port.onmessage({data:'start'});
 const input=Float32Array.from({length:4300},(_,i)=>i<2100?Math.sin(i*.1):Math.sin(i*.23)*.3);
 for(let i=0;i<input.length;i+=128)recorder.process([[input.slice(i,i+128)]]);
 recorder.port.onmessage({data:'stop'});
 assert.equal(messages[0].time,3.5);assert.equal(messages.at(-1).type,'done');
 assert.deepEqual(joinChunks(messages.filter(item=>item.type==='chunk').map(item=>item.samples)),input);
});
test('direct recording taps only the live bus, leaving saved-loop/master playback outside the input',async t=>{
 const old=globalThis.AudioWorkletNode;t.after(()=>{if(old===undefined)delete globalThis.AudioWorkletNode;else globalThis.AudioWorkletNode=old;});
 const connections=[];
 globalThis.AudioWorkletNode=class{constructor(){this.port={postMessage:()=>queueMicrotask(()=>this.port.onmessage({data:{type:'started',time:2}}))};}connect(node){return node;}};
 const sound={live:{connect(node){connections.push(['live',node]);}},master:{connect(){throw new Error('must not record master');}},context:{audioWorklet:{async addModule(){}},createGain:()=>({gain:{value:1},connect(){}}),destination:{}},async start(){}};
 const recorder=new LiveRecording(sound);await recorder.start();assert.equal(connections.length,1);assert.equal(connections[0][0],'live');assert.equal(recorder.startedAt,2);
});
