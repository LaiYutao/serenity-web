import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, musicMapping } from '../simulation.js';
import { snapshotField, renderCycle } from '../cycle-dsp.js';
import { FieldEvolution } from '../field-evolution.js';
import { ContinuousTone } from '../continuous-dsp.js';
import { fieldSoundKey } from '../audio.js';

const close=(a,b,message)=>{for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]-b[i])<1e-7,`${message}: cell ${i}`);};
test('reverse retraces the settled field without rewinding source history or removing sources',()=>{
 const sim=new Simulation(16,10);sim.plant('circle',3,4,2,.25);sim.plant('spiral',12,6,3,-.2);
 for(let i=0;i<30;i++)sim.step();
 const frames=[sim.heights.slice()];for(let i=0;i<20;i++){sim.step();frames.push(sim.heights.slice());}
 const before=sim.heights.slice(),time=sim.time,fields=sim.fields.slice();sim.setDirection(-1);
 close(sim.heights,before,'toggle continuity');
 for(let i=19;i>=0;i--){sim.step();close(sim.heights,frames[i],'reverse trajectory');}
 assert.ok(sim.time>time);assert.deepEqual(sim.fields,fields);assert.equal(sim.fields.length,2);
 for(let i=0;i<100;i++)sim.step();assert.equal(sim.fields.length,2);
 const reverseFrame=sim.heights.slice();sim.setDirection(1);close(sim.heights,reverseFrame,'resume continuity');
 sim.reset();assert.equal(sim.direction,1);
});
test('reverse snapshots predict live audio mapping including pending propagation and zero frequency',()=>{
 for(const mode of ['cluster','average']){
  const sim=new Simulation(20,12);const f=sim.plant('spiral',1,2,3,.35);sim.step(3);
  sim.setDirection(-1);f.change(2,0,sim.time);sim.step();
  const snapshot=snapshotField(sim,[]),evolution=new FieldEvolution(snapshot);
  for(let i=0;i<60;i++){
   assert.ok(Math.abs(evolution.mappingAt(i*.1).hertz-musicMapping(sim.distribution).hertz)<1e-8,`frame ${i}`);sim.step();
  }
  const rendered=renderCycle(snapshot,mode,'sine',1000);
  assert.ok(rendered.samples.every(Number.isFinite));assert.ok(rendered.duration>0);
 }
});
test('reverse microtone captures retain the reversed pitch curve and align their carrier with live sound',()=>{
 const sim=new Simulation(16,10);sim.plant('spiral',2,3,3,.35);sim.step(3);
 const sound={mode:'average',speed:1,waveform:'sine'},forwardKey=fieldSoundKey(sim,sound,[]);
 sim.setDirection(-1);assert.notEqual(fieldSoundKey(sim,sound,[]),forwardKey);
 const snapshot=snapshotField(sim,[]),rendered=renderCycle(snapshot,'average','sine',1000);
 const live=new ContinuousTone(),track=new ContinuousTone();
 const profile={...rendered.pitchMap.continuation,duration:rendered.duration,offset:.137};
 live.install(profile,.387);track.install(profile,.387);
 for(let i=0;i<10000;i++)assert.equal(live.next(1000),track.next(1000));
 const savedPhase=track.phase;sim.setDirection(1);track.next(1000);assert.notEqual(track.phase,savedPhase);
});
test('resizing after direction changes reconstructs the same field, including new viewport cells',()=>{
 const small=new Simulation(8,6),large=new Simulation(24,16);
 small.plant('spiral',3,2,2,.25);large.plant('spiral',11,7,2,.25);
 const advance=n=>{for(let i=0;i<n;i++){small.step();large.step();}};
 advance(15);small.setDirection(-1);large.setDirection(-1);advance(8);
 small.fields[0].change(3,0,small.time);large.fields[0].change(3,0,large.time);advance(12);
 small.setDirection(1);large.setDirection(1);advance(5);
 small.resize(24,16);close(small.heights,large.heights,'resized reverse field');
 advance(10);close(small.heights,large.heights,'continued reverse field');
});
