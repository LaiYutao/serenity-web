import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldPeriod, renderCycle, snapshotField, processCycle } from '../cycle-dsp.js';
import { Simulation } from '../simulation.js';

test('common field period includes every active local frequency, including reverse and prior values',()=>{
 const fields=[{amps:[1,1,1,0],freqs:[.25,.2,-.15,.123]}];
 assert.equal(fieldPeriod(fields),20);
 assert.equal(fieldPeriod([{amps:[1],freqs:[0]}]),1);
});
test('snapshot copies only field state and deduplicates overlapping listening regions',()=>{
 const sim=new Simulation(4,3);sim.plant('circle',1,1,1,.25);sim.step(2);
 const saved=snapshotField(sim,[{left:0,right:2,top:0,bottom:1},{left:1,right:3,top:0,bottom:1}]);
 assert.equal(saved.selected.length,8);
 const original=saved.fields[0].amps[0];sim.fields[0].amps[0]=6;
 assert.equal(saved.fields[0].amps[0],original);assert.ok(!('tracks' in saved));
});
test('cycle length comes from the field and generation ignores all external audio tracks',()=>{
 const snapshot={time:0,fields:[{amps:[1],freqs:[.25],phases:[0]}],selected:[0]};
 const a=renderCycle(snapshot,'cluster','sine',48000);
 const b=renderCycle({...snapshot,tracks:[{samples:new Float32Array(900).fill(1)}]},'cluster','sine',48000);
 assert.equal(a.pitchMap.mode,'cluster');assert.equal(a.pitchMap.weights.length,a.pitchMap.frames);assert.equal(a.pitchMap.weights[0].length,12);assert.ok(a.pitchMap.frequencies.every(Number.isFinite));
 assert.equal(a.duration,4);assert.equal(a.samples.length,192000);assert.deepEqual(a.samples,b.samples);
 assert.ok(Math.abs(a.samples[0]-a.samples.at(-1))<.03);
 assert.ok(a.samples.some(value=>Math.abs(value)>.01));
});
test('masks wrap across the boundary, preserve cycle length and are nondestructive',()=>{
 const original=new Float32Array(1000).fill(.25),result=processCycle(original,{start:.8,end:.2});
 assert.equal(result.length,1000);assert.equal(result[0],0);assert.equal(result[999],0);assert.equal(result[500],.25);assert.equal(original[0],.25);
 assert.deepEqual(processCycle(original),original);
});
test('signed upper/lower amplitude masks remove selected heights',()=>{
 const original=Float32Array.from([-.8,-.2,0,.2,.8]);
 assert.deepEqual([...processCycle(original,{low:-.3,high:.3})],[0,original[1],0,original[3],0]);
});

test('dragging across cycles creates the same wrapping time mask in either direction',async()=>{
 const {maskFromDrag}=await import('../cycle-dsp.js');
 const a=maskFromDrag(.85,1.15),b=maskFromDrag(1.15,.85);
 assert.deepEqual(a,b);assert.ok(Math.abs(a.start-.85)<1e-9);assert.ok(Math.abs(a.end-.15)<1e-9);
 const samples=processCycle(new Float32Array(1000).fill(.5),a);
 assert.equal(samples[0],0);assert.equal(samples[950],0);assert.equal(samples[500],.5);
 assert.deepEqual(maskFromDrag(.3,1.6),{start:0,end:1});
 assert.ok(processCycle(new Float32Array(1000).fill(.5),maskFromDrag(.3,1.6)).every(value=>value===0));
});

test('pitch mask removes a note without attenuating an in-range note or changing loop length',async()=>{
 const {renderPitchMask}=await import('../cycle-dsp.js');
 const weights=Array(12).fill(0);weights[0]=.5;weights[9]=.5;
 const map={mode:'cluster',frames:2,weights:[weights,weights],frequencies:[350,350]};
 const full=renderPitchMask(map,1,'sine',8000);
 const highOnly=renderPitchMask(map,1,'sine',8000,69,127);
 const lowOnly=renderPitchMask(map,1,'sine',8000,0,60);
 const amplitude=(data,hz)=>Math.abs(data.reduce((sum,x,i)=>sum+x*Math.sin(2*Math.PI*hz*i/8000),0)*2/data.length);
 assert.equal(highOnly.samples.length,full.samples.length);
 assert.ok(amplitude(full.samples,262)>.1);assert.ok(amplitude(full.samples,440)>.1);
 assert.ok(amplitude(highOnly.samples,262)<1e-5);assert.ok(amplitude(highOnly.samples,440)>.1);
 assert.ok(amplitude(lowOnly.samples,440)<1e-5);assert.ok(amplitude(lowOnly.samples,262)>.1);
});
test('microtone pitch mask silences an out-of-range tone, with a reversible neutral range',async()=>{
 const {renderPitchMask}=await import('../cycle-dsp.js');
 const map={mode:'average',frames:2,weights:[Array(12).fill(0),Array(12).fill(0)],frequencies:[440,440]};
 assert.ok(renderPitchMask(map,1,'sine',8000,0,68).samples.every(x=>x===0));
 assert.ok(renderPitchMask(map,1,'sine',8000,69,127).samples.some(x=>Math.abs(x)>.1));
});

test('field speed changes loop duration while retaining the same evolution and initial phase',()=>{
 const sim=new Simulation(4,3);sim.plant('circle',1,1,1,.25);sim.step(2);
 const normal=renderCycle(snapshotField(sim,[]),'cluster','sine',2000);
 const fast=renderCycle(snapshotField(sim,[],2),'cluster','sine',2000);
 const slow=renderCycle(snapshotField(sim,[],.5),'cluster','sine',2000);
 assert.equal(fast.duration,normal.duration/2);
 assert.equal(slow.duration,normal.duration*2);
 assert.equal(fast.samples.length,normal.samples.length/2);
 for(let i=0;i<fast.pitchMap.frames;i++)assert.deepEqual(fast.pitchMap.weights[i],normal.pitchMap.weights[i*2]);
 assert.deepEqual(slow.pitchMap.weights[0],normal.pitchMap.weights[0]);
 assert.equal(sim.fields[0].frequency,.25);
});

test('recorded pitch speed is baked into the loop and retained during later mask processing',async()=>{
 const {renderPitchMask}=await import('../cycle-dsp.js');
 const snapshot={time:0,speed:2,fields:[{amps:[1],freqs:[.25],phases:[0]}],selected:[0]};
 const recorded=renderCycle(snapshot,'cluster','sine',4000);
 assert.equal(recorded.duration,2);assert.equal(recorded.pitchMap.pitchRate,2);
 const restored=renderPitchMask(recorded.pitchMap,recorded.duration,'sine',4000);
 assert.deepEqual(restored.samples,recorded.samples);
 assert.equal(restored.pitchMap.pitchRate,2);
});
