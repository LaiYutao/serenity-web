import test from 'node:test';
import assert from 'node:assert/strict';
import { SampleClock, sampleInterval, stepRateAt, stepRatePosition } from '../sampling.js';
import { Simulation,sampleDistribution } from '../simulation.js';
import { profileFrequency,ContinuousTone,ContinuousCluster } from '../continuous-dsp.js';
import { pluckState,pluckNext } from '../pluck-dsp.js';
import { snapshotField,renderCycle,renderPitchMask } from '../cycle-dsp.js';
import { encodeProject,decodeProject } from '../project.js';
import { fixture } from './fixtures/project.js';

test('Step holds sound between audio-clock samples, without drifting at irregular frame times',()=>{
 const clock=new SampleClock();let reads=0;const read=()=>++reads;
 assert.equal(sampleInterval(.05),2);assert.equal(sampleInterval(.1),1);assert.equal(sampleInterval(.25),.4);assert.equal(sampleInterval(4),.025);assert.equal(sampleInterval(.25,2),.2);
 assert.equal(clock.sample(0,.25,read),1);assert.equal(clock.sample(.39,.25,read),1);assert.equal(clock.sample(.41,.25,read),2);
 assert.equal(clock.sample(.8,.25,read),3);assert.ok(Math.abs(clock.next-1.2)<1e-12);
 clock.sample(.9,4,read);assert.equal(reads,4);
});
test('logarithmic Step slider covers 0.05×–4× with extra low-rate travel',()=>{
 for(const rate of [.05,.075,.1,.25,.5,1,2,4])assert.ok(Math.abs(stepRateAt(stepRatePosition(rate))-rate)<1e-12);
 assert.ok(stepRatePosition(.5)>.5);assert.equal(stepRateAt(0),.05);assert.equal(stepRateAt(1),4);
});
test('sampling an intermediate field does not step, reverse or modify the displayed simulation',()=>{
 const sim=new Simulation(20,16);sim.plant('circle',8,7,4,.5);sim.step(4);sim.setDirection(-1);
 const before=sim.time,heights=sim.heights.slice(),phases=sim.fields[0].phases.slice();
 const sampled=sampleDistribution(sim,[],.07);
 assert.equal(sampled.reduce((a,b)=>a+b,0),320);assert.equal(sim.time,before);assert.deepEqual(sim.heights,heights);assert.deepEqual(sim.fields[0].phases,phases);
});
test('recorded Step frequency is held between boundaries while its oscillator keeps continuous phase',()=>{
 const profile={frequencies:[200,300,400,500],duration:1,sampleInterval:.25};
 assert.equal(profileFrequency(profile,.1),200);assert.equal(profileFrequency(profile,.249),200);assert.equal(profileFrequency(profile,.25),300);
 const voice=new ContinuousTone();voice.install({...profile,offset:0});
 for(let i=0;i<2000;i++)assert.ok(Number.isFinite(voice.next(8000)));
 assert.ok(Math.abs(voice.phase)<1e-9||Math.abs(voice.phase-1)<1e-9);
});
test('Pluck has a short attack and decaying harmonic body, remains bounded and respects silence',()=>{
 const state=pluckState(),rate=16000,samples=[];
 for(let i=0;i<4000;i++)samples.push(pluckNext(state,(i*330/rate)%1,330,1,rate));
 const energy=(a,b)=>samples.slice(a,b).reduce((v,x)=>v+x*x,0)/(b-a);
 assert.equal(samples[0],0);assert.ok(energy(80,480)>energy(2800,3200)*8);assert.ok(samples.every(x=>Number.isFinite(x)&&Math.abs(x)<3.6));
 assert.equal(pluckNext(pluckState(),0,400,0,rate),0);
});
test('basic pluck ends within 90 ms, never repeats a held field, and retriggers on rapid changes',()=>{
 const rate=16000,state=pluckState();let energy=0;
 for(let i=0;i<rate;i++){
  const value=pluckNext(state,(i*330/rate)%1,330,1,rate);
  if(i<rate*.09)energy+=value*value;else assert.ok(value===0);
 }
 assert.ok(energy>1);
 // No old 280 ms repeating clock; both rising and falling field changes trigger.
 for(const [hz,weight] of [[350,1],[350,.7],[350,1]]){
  pluckNext(state,.2,hz,weight,rate);assert.ok(state.age<.001);
  let body=0;for(let i=0;i<320;i++)body+=Math.abs(pluckNext(state,(i*hz/rate)%1,hz,weight,rate));
  assert.ok(body>1); // 20 ms notes remain audible before the previous tail would finish.
 }
});
test('pluck masks fully silence voices and saved string states resume without losing phase or decay',()=>{
 for(const Type of [ContinuousTone,ContinuousCluster]){
  const voice=new Type();voice.waveform='pluck';voice.install({mode:Type===ContinuousTone?'average':'cluster',frequencies:[330,350],weights:[Array(12).fill(.05),Array(12).fill(.08)],duration:1,offset:.2});
  for(let i=0;i<330;i++)voice.next(8000);
  const restored=Object.assign(new Type(),structuredClone(voice));
  for(let i=0;i<1000;i++)assert.equal(voice.next(8000),restored.next(8000));
  voice.settings={start:0,end:1,lowPitch:0,highPitch:127};for(let i=0;i<800;i++)assert.ok(voice.next(8000)===0);
 }
});
test('pluck and Step remain editable in pitch masks, tempo render and self-contained projects',async()=>{
 const sim=new Simulation(20,16);sim.plant('circle',8,7,3,.5);sim.step(4);
 const snapshot=snapshotField(sim,[]);snapshot.sampleInterval=.4;
 for(const mode of ['average','cluster']){
  const result=renderCycle(snapshot,mode,'pluck',8000);assert.equal(result.pitchMap.sampleInterval,.4);assert.ok(result.samples.some(v=>Math.abs(v)>.001));assert.ok(result.samples.every(Number.isFinite));
  const faster=renderPitchMask(result.pitchMap,result.duration/2,'pluck',8000);assert.equal(faster.samples.length,result.samples.length/2);
 }
 const project=fixture();project.scene.settings.samplingMode='step';project.scene.settings.stepRate=.05;project.scene.settings.waveform='pluck';project.tracks[0].waveform='pluck';project.tracks[0].voice.waveform='pluck';
 const restored=await decodeProject(encodeProject(project));assert.equal(restored.scene.settings.stepRate,.05);assert.equal(restored.tracks[0].waveform,'pluck');
});

test('1× Pluck stays audible for tiny field changes and 4× no longer wins through loudness',()=>{
 const rms=a=>Math.sqrt(a.reduce((sum,v)=>sum+v*v,0)/a.length);
 for(const mode of ['cluster','average']){
  const ratios=[];
  for(const speed of [.25,1,4]){
   const sim=new Simulation(30,20);sim.plant('circle',14,9,3,.25);for(let i=0;i<200;i++)sim.step();
   const snapshot=snapshotField(sim,[],speed),sine=renderCycle(snapshot,mode,'sine',8000),pluck=renderCycle(snapshot,mode,'pluck',8000);
   ratios.push(rms(pluck.samples)/rms(sine.samples));
   assert.ok(Math.abs(pluck.pitchMap.pluckInterval-.1/speed)<1e-12);
  }
  assert.ok(ratios[0]>.5);assert.ok(ratios[1]>.8&&ratios[1]<1.1);assert.ok(ratios[2]>.8&&ratios[2]<1.1);
 }
 const tone=new ContinuousTone();tone.waveform='pluck';tone.install({frequencies:[330,330],duration:1,offset:0,pluckInterval:.1});
 for(let frame=0;frame<8;frame++){
  let energy=0;for(let i=0;i<800;i++)energy+=tone.next(8000)**2;assert.ok(energy>10);
 }
});

test('Bubble stays short while Electric retains a clean string body',()=>{
 const rate=48000,hz=400,tones={};
 for(const type of ['bubble','electric']){
  const state=pluckState(),samples=new Float32Array(rate/5);
  for(let i=0;i<samples.length;i++)samples[i]=pluckNext(state,(i*hz/rate)%1,hz,1,rate,true,0,.1,type);
  if(type==='bubble')assert.ok(samples.slice(Math.ceil(rate*.09)).every(v=>v===0));
  else assert.ok(samples.slice(Math.ceil(rate*.15)).some(v=>Math.abs(v)>.01));
  const partial=frequency=>{
   let real=0,imag=0;for(let i=0;i<rate*.09;i++){const a=2*Math.PI*frequency*i/rate;real+=samples[i]*Math.cos(a);imag+=samples[i]*Math.sin(a);}
   return Math.hypot(real,imag);
  };
  tones[type]={second:partial(hz*2)/partial(hz),energy:samples.reduce((v,x)=>v+x*x,0)};
 }
 assert.ok(tones.electric.second>tones.bubble.second*4);
 assert.ok(tones.electric.energy/tones.bubble.energy>.5&&tones.electric.energy/tones.bubble.energy<2);
});
test('both new timbres support field capture, speed edits, masks and project restoration',async()=>{
 const sim=new Simulation(20,16);sim.plant('circle',8,7,3,.5);sim.step(4);
 for(const type of ['bubble','electric']){
  for(const mode of ['average','cluster']){
   const result=renderCycle(snapshotField(sim,[]),mode,type,8000);assert.ok(result.samples.every(Number.isFinite));assert.ok(result.samples.some(v=>Math.abs(v)>.01));
   const faster=renderPitchMask(result.pitchMap,result.duration/2,type,8000);assert.equal(faster.samples.length,result.samples.length/2);
   const silent=renderPitchMask(result.pitchMap,result.duration,type,8000,120,127);assert.ok(silent.samples.every(v=>v===0));
  }
  const project=fixture();project.scene.settings.waveform=type;project.tracks[0].waveform=type;project.tracks[0].voice.waveform=type;
  const restored=await decodeProject(encodeProject(project));assert.equal(restored.scene.settings.waveform,type);assert.equal(restored.tracks[0].voice.waveform,type);
 }
});

test('Electric retains even and odd string modes without aliasing',()=>{
 const rate=48000,hz=400,state=pluckState(),samples=new Float32Array(rate*.09);
 for(let i=0;i<samples.length;i++)samples[i]=pluckNext(state,(i*hz/rate)%1,hz,1,rate,true,0,.1,'electric');
 const partial=harmonic=>{
  let a=0,b=0;for(let i=rate*.01;i<rate*.04;i++){const phase=2*Math.PI*hz*harmonic*i/rate;a+=samples[i]*Math.cos(phase);b+=samples[i]*Math.sin(phase);}return Math.hypot(a,b);
 };
 assert.ok(partial(2)/partial(1)>.25);assert.ok(partial(3)/partial(1)>.3);assert.ok(partial(9)/partial(1)<.12);
 // At low audio rates/high pitches the extra partials must stay below Nyquist.
 const high=pluckState();for(let i=0;i<800;i++)assert.ok(Number.isFinite(pluckNext(high,(i*1500/8000)%1,1500,1,8000,true,0,.1,'electric')));
});

test('Electric sustains past 200 ms and reconnects sampled frames without restarting from zero',()=>{
 const state=pluckState(),rate=16000,hz=493.88;
 let previous;
 for(let i=0;i<3200;i++)previous=pluckNext(state,.25,hz,1,rate,true,0,.2,'electric');
 assert.ok(Math.abs(previous)>.1);
 const next=pluckNext(state,.25,hz,1,rate,true,1,.2,'electric');
 assert.ok(Math.abs(next-previous)<.002);
 const phase=i=>(i*hz/rate)%1;let early=0,body=0;
 const single=pluckState();
 for(let i=0;i<4800;i++){
  const value=pluckNext(single,phase(i),hz,1,rate,true,0,.2,'electric');
  if(i>=rate*.02&&i<rate*.06)early+=value*value;
  if(i>=rate*.18&&i<rate*.22)body+=value*value;
 }
 assert.ok(body/early>.3&&body/early<1);
 for(let i=0;i<1600;i++)pluckNext(single,phase(i),hz,0,rate,true,0,.2,'electric');
 assert.ok(single.electricWeight<1e-5); // Tracking follows the new field instead of dragging a prior note.
});
