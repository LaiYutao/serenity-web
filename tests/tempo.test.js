import test from 'node:test';
import assert from 'node:assert/strict';
import { stretchRecording, resampleRecording } from '../tempo-dsp.js';
import { ContinuousTone, ContinuousCluster, profileFrequency } from '../continuous-dsp.js';
import { LoopRecorder } from '../loops.js';

const wrap=(x,p)=>((x%p)+p)%p;
function dominant(samples,sampleRate,centre){
 let best=0,hz=0;
 for(let f=centre-8;f<=centre+8;f+=.5){let a=0,b=0;for(let i=0;i<samples.length;i++){a+=samples[i]*Math.cos(2*Math.PI*f*i/sampleRate);b+=samples[i]*Math.sin(2*Math.PI*f*i/sampleRate);}if(a*a+b*b>best){best=a*a+b*b;hz=f;}}
 return hz;
}
test('direct recordings change duration without shifting a sustained pitch, including circular seams',()=>{
 const sr=8000,input=Float32Array.from({length:sr},(_,i)=>.5*Math.sin(2*Math.PI*440*i/sr));
 assert.deepEqual(stretchRecording(input,sr,1),input);
 for(const rate of [.25,.5,1.37,2,4]){
  const out=stretchRecording(input,sr,rate);
  assert.equal(out.length,Math.round(input.length/rate));assert.ok(out.every(Number.isFinite));
  assert.ok(Math.abs(dominant(out,sr,440)-440)<=1,`rate ${rate}`);
  assert.ok(Math.abs(out.at(-1)-out[0])<.25,`circular seam ${rate}`);
 }
 assert.ok(stretchRecording(new Float32Array(100),sr,2).every(x=>x===0));
 assert.throws(()=>stretchRecording(input,sr,0),RangeError);
});
test('direct recording events move with tempo rather than remaining at their original times',()=>{
 const sr=8000,input=Float32Array.from({length:sr*2},(_,i)=>{const t=i/sr;return t>.6&&t<.8?.6*Math.sin(2*Math.PI*440*t):0;});
 for(const rate of [.5,2]){
  const out=stretchRecording(input,sr,rate);let sum=0,centroid=0;
  for(let i=0;i<out.length;i++){const energy=out[i]*out[i];sum+=energy;centroid+=i/sr*energy;}
  assert.ok(sum>0);assert.ok(Math.abs(centroid/sum-.7/rate)<.04,`event centre at ${rate}`);
 }
});
test('microtone tempo advances only the envelope clock, retaining carrier frequency and phase',()=>{
 const tone=new ContinuousTone();tone.install({duration:2,offset:.3,frequencies:new Float64Array([220,330,440,330])},.28);tone.rate=2;
 const expectedHz=profileFrequency(tone.profile,.3),phase=tone.phase;
 tone.next(8000);assert.ok(Math.abs(tone.frequency-expectedHz)<1e-8);
 assert.ok(Math.abs(tone.phase-wrap(phase+expectedHz/8000,1))<1e-12);
 assert.ok(Math.abs(tone.profile.elapsed-(.3+2/8000))<1e-12);
 const oldPosition=tone.profile.position;tone.rate=.5;tone.next(8000);
 assert.ok(Math.abs(tone.profile.position-(oldPosition+.5/8000))<1e-12);
});
test('twelve-tone tempo preserves its carrier pitch at all speeds, including the original harmonics',()=>{
 const weights=Array.from({length:4},()=>Array.from({length:12},(_,i)=>i===9?1:0));
 for(const rate of [.5,1,2,4]){
  const tone=new ContinuousCluster();tone.waveform='original';tone.rate=rate;tone.install({duration:2,offset:0,weights,pitchRate:1});
  const out=Float32Array.from({length:8000},()=>tone.next(8000));
  assert.equal(dominant(out,8000,440),440);assert.ok(Math.min(wrap(tone.profile.position-rate,2),wrap(rate-tone.profile.position,2))<1e-9);
  tone.settings.lowPitch=80;assert.equal(tone.next(8000),0);
 }
});
test('changing a saved track tempo preserves its playhead phase and updates effect timing independently',()=>{
 const calls=[],ctx={currentTime:3,sampleRate:100,createBuffer:(_,length,rate)=>({duration:length/rate,copyToChannel(){}})};
 const recorder=new LoopRecorder({context:ctx});
 const track={continuous:true,baseDuration:4,buffer:{duration:4},original:new Float32Array(400),startedAt:0,source:{setRate:v=>calls.push(['rate',v])},effects:{setDuration:v=>calls.push(['duration',v]),setOrigin:v=>calls.push(['origin',v])}};
 recorder.swap(track,new Float32Array(200),2);
 assert.equal(track.buffer.duration,2);assert.equal(track.startedAt,1.5);assert.equal(track.appliedSpeed,2);
 assert.deepEqual(calls,[['rate',2],['duration',2],['origin',1.5]]);
});


test('Normal doubles pitch as well as tempo, while Stretch keeps the same pitch at the same duration',()=>{
 const sr=8000,input=Float32Array.from({length:sr},(_,i)=>.5*Math.sin(2*Math.PI*440*i/sr));
 const normal=resampleRecording(input,2),stretch=stretchRecording(input,sr,2);
 assert.equal(normal.length,stretch.length);
 assert.equal(dominant(normal,sr,880),880);assert.equal(dominant(stretch,sr,440),440);
 const micro=new ContinuousTone();micro.install({duration:2,offset:0,frequencies:[440]},0);micro.rate=2;micro.pitchSpeed=2;micro.next(sr);
 assert.equal(micro.frequency,880);assert.ok(Math.abs(micro.phase-880/sr)<1e-12);
 const cluster=new ContinuousCluster();cluster.install({duration:2,offset:0,pitchRate:1,weights:[Array.from({length:12},(_,i)=>i===9?1:0)]});cluster.rate=2;cluster.pitchSpeed=2;
 assert.equal(dominant(Float32Array.from({length:sr},()=>cluster.next(sr)),sr,880),880);
});
