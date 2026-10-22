import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, musicMapping } from '../simulation.js';
import { snapshotField, renderCycle } from '../cycle-dsp.js';
import { fieldSoundKey } from '../audio.js';

test('actual worklet messages keep live and recorded samples aligned through propagation and repeated captures',async t=>{
 const names=['AudioWorkletProcessor','registerProcessor','sampleRate','currentTime'];
 const originals=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 t.after(()=>{for(const name of names){const old=originals.get(name);if(old)Object.defineProperty(globalThis,name,old);else delete globalThis[name];}});
 let Processor;globalThis.sampleRate=4000;globalThis.currentTime=0;
 globalThis.AudioWorkletProcessor=class{constructor(){this.port={onmessage:null};}};
 globalThis.registerProcessor=(_name,type)=>{Processor=type;};
 await import('../continuous-worklet.js');
 const processor=new Processor(),send=data=>processor.port.onmessage({data});
 const sim=new Simulation(24,12);sim.plant('spiral',2,3,2,.35);sim.step(.1);
 const sound={mode:'average',waveform:'sine',speed:1},key=fieldSoundKey(sim,sound,[]);
 const recording=renderCycle(snapshotField(sim,[]),'average','sine',4000),map=recording.pitchMap;
 send({type:'live',hz:musicMapping(sim.distribution).hertz,speed:1,running:true,waveform:'sine'});
 send({type:'add',when:0,slot:1,waveform:'sine',adopt:true,profile:{...map.continuation,frequencies:map.continuation.frequencies,duration:recording.duration,offset:0}});
 let maxResidual=0;
 for(let block=0;block<400;block++){
  const outputs=Array.from({length:17},()=>[new Float32Array(128)]);
  processor.process([],outputs);
  for(let i=0;i<128;i++)maxResidual=Math.max(maxResidual,Math.abs(outputs[0][0][i]*10000/32768-outputs[1][0][i]));
  globalThis.currentTime+=128/4000;
  if(block%3===0){sim.step();assert.equal(fieldSoundKey(sim,sound,[]),key);send({type:'live',hz:musicMapping(sim.distribution).hertz,speed:1,running:true,waveform:'sine'});}
  if(block===100)send({type:'add',when:currentTime,slot:2,waveform:'sine',adopt:true,profile:{...map.continuation,frequencies:map.continuation.frequencies,duration:recording.duration,offset:.02}});
  if(block>100)for(let i=0;i<128;i++)maxResidual=Math.max(maxResidual,Math.abs(outputs[1][0][i]-outputs[2][0][i]));
 }
 assert.ok(maxResidual<6e-8,`live/recorded residual ${maxResidual}`);
 // Reversing the live field installs a new curve only for live/new captures.
 const savedProfile=processor.tracks.get(1).profile,savedElapsed=savedProfile.elapsed;
 sim.setDirection(-1);
 const reverse=renderCycle(snapshotField(sim,[]),'average','sine',4000);
 send({type:'invalidate'});
 send({type:'live',hz:musicMapping(sim.distribution).hertz,speed:1,running:true,waveform:'sine'});
 send({type:'add',when:currentTime,slot:3,waveform:'sine',adopt:true,profile:{...reverse.pitchMap.continuation,frequencies:reverse.pitchMap.continuation.frequencies,duration:reverse.duration,offset:0}});
 for(let block=0;block<150;block++){
  const outputs=Array.from({length:17},()=>[new Float32Array(128)]);processor.process([],outputs);
  for(let i=0;i<128;i++)assert.ok(Math.abs(outputs[0][0][i]*10000/32768-outputs[3][0][i])<6e-8);
  globalThis.currentTime+=128/4000;
 }
 assert.equal(processor.tracks.get(1).profile,savedProfile);
 assert.ok(savedProfile.elapsed>savedElapsed);
 // Cluster tracks use the same per-track rate messages without changing live speed.
 send({type:'add',when:currentTime,slot:4,waveform:'original',adopt:false,profile:{mode:'cluster',duration:2,offset:0,pitchRate:1,frequencies:[440],weights:[Array.from({length:12},(_,i)=>i===9?1:0)]}});
 send({type:'rate',slot:4,rate:2});
 const clusterOutputs=Array.from({length:17},()=>[new Float32Array(128)]);processor.process([],clusterOutputs);
 assert.ok(clusterOutputs[4][0].some(value=>Math.abs(value)>.01));
 assert.ok(Math.abs(processor.tracks.get(4).profile.elapsed-256/4000)<1e-9);
 assert.equal(processor.live.rate,1);assert.equal(processor.tracks.get(1).rate,1);
 // Combined track controls can cancel tempo while retaining a pitch change.
 send({type:'rate',slot:4,rate:1,preservePitch:true,pitchSpeed:2});
 const combined=processor.tracks.get(4),oldPhase=combined.phases[9],oldElapsed=combined.profile.elapsed;
 processor.process([],Array.from({length:17},()=>[new Float32Array(128)]));
 assert.equal(combined.rate,1);assert.equal(combined.pitchSpeed,2);
 assert.ok(Math.abs(combined.profile.elapsed-oldElapsed-128/4000)<1e-9);
 assert.ok(Math.abs(combined.phases[9]-((oldPhase+880*128/4000)%1))<1e-9);
 // Muting the live field must leave recorded oscillators advancing independently.
 const phase=processor.tracks.get(1).phase;send({type:'live',hz:100,speed:2,running:false,waveform:'sine'});
 processor.process([],Array.from({length:17},()=>[new Float32Array(128)]));
 assert.notEqual(processor.tracks.get(1).phase,phase);
 // A stable mapping must still emit each sampled field frame at Normal 1×.
 for(const waveform of ['pluck','bubble','electric'])for(const mode of ['cluster','average']){
  send({type:'invalidate'});
  send({type:'live',hz:330,speed:1,running:true,waveform,mode,weights:Array.from({length:12},(_,i)=>i===4?.15:0),pitchRate:1,pluckInterval:.1});
  const energies=Array(10).fill(0);
  for(let block=0;block<32;block++){
   const outputs=Array.from({length:17},()=>[new Float32Array(128)]);processor.process([],outputs);
   for(let i=0;i<128;i++){const window=Math.floor((block*128+i)/400);if(window<10)energies[window]+=outputs[0][0][i]**2;}
  }
  assert.ok(energies.every(energy=>energy>.01),`${mode} must stay audible through every frame`);
 }

});
