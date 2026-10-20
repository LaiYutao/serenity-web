import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, musicMapping } from '../simulation.js';
import { snapshotField, renderCycle } from '../cycle-dsp.js';
import { FieldEvolution } from '../field-evolution.js';
import { profileFrequency, ContinuousTone } from '../continuous-dsp.js';
import { fieldSoundKey } from '../audio.js';

test('a recording made during outward propagation predicts the same future as the original field',()=>{
 const sim=new Simulation(24,12);sim.plant('spiral',2,3,2,.35);sim.step(.1);
 const evolution=new FieldEvolution(snapshotField(sim,[]));
 assert.ok(evolution.settleAfter>1);
 for(let i=0;i<80;i++){
  assert.ok(Math.abs(evolution.mappingAt(i*.1).hertz-musicMapping(sim.distribution).hertz)<1e-8,`future frame ${i}`);
  sim.step();
 }
});
test('pending parameter changes, including a frozen zero-frequency wave, survive capture',()=>{
 for(const next of [0,-.2,.45]){
  const sim=new Simulation(16,10);const field=sim.plant('circle',1,1,3,.25);sim.step(4);
  field.change(1,next,sim.time);sim.step();
  const evolution=new FieldEvolution(snapshotField(sim,[],2));
  for(let i=0;i<60;i++){
   assert.ok(Math.abs(evolution.mappingAt(i*.1/2).hertz-musicMapping(sim.distribution).hertz)<1e-8,`frequency ${next}, frame ${i}`);
   sim.step();
  }
 }
});
test('normal propagation cannot invalidate the shared live/recorded curve, but user changes do',()=>{
 const sim=new Simulation(24,12);const field=sim.plant('circle',1,1,2,.25);
 const sound={mode:'average',waveform:'sine',speed:1};
 const key=fieldSoundKey(sim,sound,[]);
 for(let i=0;i<30;i++){sim.step();assert.equal(fieldSoundKey(sim,sound,[]),key);}
 field.change(3,.25,sim.time);assert.notEqual(fieldSoundKey(sim,sound,[]),key);
});
test('the propagation intro plays once, then only the settled evolution repeats without a phase reset',()=>{
 const sim=new Simulation(20,10);sim.plant('circle',1,1,2,.25);sim.step(.1);
 const snapshot=snapshotField(sim,[]),evolution=new FieldEvolution(snapshot);
 const map=evolution.continuation(4);
 assert.ok(map.introDuration>0);
 for(let i=0;i<40;i++){
  const at=map.introDuration+i*.1;
  assert.ok(Math.abs(profileFrequency({...map,duration:4},at)-evolution.mappingAt(at).hertz)<1e-6);
  assert.ok(Math.abs(profileFrequency({...map,duration:4},at+4)-profileFrequency({...map,duration:4},at))<1e-6);
 }
 const rendered=renderCycle(snapshot,'average','sine',1000);
 assert.ok(rendered.pitchMap.continuation.introFrames>0);
 assert.equal(rendered.pitchCorrection,0);
 const live=new ContinuousTone(),saved=new ContinuousTone();
 live.install({...map,duration:4,offset:.2},.37);saved.install({...map,duration:4,offset:.2},.37);
 for(let i=0;i<12000;i++)assert.equal(live.next(1000),saved.next(1000));
});
