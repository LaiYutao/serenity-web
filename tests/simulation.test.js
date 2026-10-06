import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, heightBin, musicMapping, NOTES, selectionBounds } from '../simulation.js';

test('height bins match C++ signed rounding and saturate at the bounds',()=>{
  assert.deepEqual([-99,-.5,-.49,0,.49,.5,99].map(heightBin),[0,5,6,6,6,7,12]);
});
test('wave travels at 10 cells/sec and independent fields superpose',()=>{
  const a=new Simulation(30,20),b=new Simulation(30,20),both=new Simulation(30,20);
  a.plant('circle',5,5,2,.25);b.plant('spiral',10,10,3,-.2);
  both.plant('circle',5,5,2,.25);both.plant('spiral',10,10,3,-.2);
  a.step();assert.equal(a.heights[5*30+10],0);
  b.step();both.step();
  for(let step=0;step<25;step++){a.step();b.step();both.step();}
  for(let i=0;i<a.heights.length;i++)assert.ok(Math.abs(both.heights[i]-a.heights[i]-b.heights[i])<1e-10);
  assert.equal(both.distribution.reduce((x,y)=>x+y),600);
});
test('parameter change travels outward and zero amplitude really clears cells',()=>{
  const sim=new Simulation(20,20);const f=sim.plant('circle',0,0,2,.25);
  for(let i=0;i<40;i++)sim.step();
  f.change(0,.25,sim.time);sim.step();
  assert.equal(f.amps[0],0);assert.equal(f.amps[19*20+19],2);
  for(let i=0;i<30;i++)sim.step();assert.ok(sim.heights.every(x=>x===0));
});
test('zero-frequency spiral freezes without Infinity/NaN, then resumes in reverse',()=>{
  const sim=new Simulation(12,12),f=sim.plant('spiral',6,6,3,.25);
  for(let i=0;i<20;i++)sim.step();f.change(3,0,sim.time);
  for(let i=0;i<20;i++)sim.step();const frozen=sim.heights.slice();
  sim.step();assert.deepEqual(sim.heights,frozen);assert.ok(sim.heights.every(Number.isFinite));
  f.change(3,-.25,sim.time);for(let i=0;i<20;i++)sim.step();
  assert.ok(sim.heights.every(Number.isFinite));assert.notDeepEqual(sim.heights,frozen);
});
test('clusters include all twelve pitches, retaining rare bins and a silent center',()=>{
  const d=new Uint32Array([12,11,10,9,8,7,100,6,5,4,3,2,1]);
  const result=musicMapping(d);
  assert.deepEqual(Array.from(result.weights).map((w,i)=>w?i:-1).filter(i=>i>=0),[0,1,2,3,4,5,7,8,9,10,11,12]);
  assert.equal(result.weights[0],12/178);
  assert.equal(result.weights[12],1/178);
  assert.equal(result.weights[6],0);
  assert.ok(Math.abs(result.weights.reduce((a,b)=>a+b)-78/178)<1e-10);
  assert.ok(Math.abs(result.hertz-d.reduce((sum,count,i)=>sum+count*NOTES[i],0)/178)<1e-10);
  const silent=musicMapping(new Simulation(4,4).distribution);
  assert.equal(silent.hertz,0);assert.ok(silent.weights.every(w=>w===0));
  const sparse=musicMapping(new Uint32Array([1,0,0,0,0,0,2,0,0,0,0,0,1]));
  assert.equal(sparse.weights[0],.25);assert.equal(sparse.weights[12],.25);
  assert.equal(sparse.weights.filter(w=>w>0).length,2);
});
test('planting avoids duplicates, clamps edges, and reset clears all simulation state',()=>{
  const sim=new Simulation(10,10);sim.plant('circle',-4,100);assert.ok(sim.at(0,9));
  assert.equal(sim.plant('spiral',0,9),null);sim.step();sim.reset();
  assert.equal(sim.fields.length,0);assert.equal(sim.time,0);assert.equal(sim.distribution[6],100);
});
test('a field planted at zero frequency starts flat and stays finite',()=>{
  const sim=new Simulation(12,12);sim.plant('spiral',6,6,3,0);
  for(let i=0;i<20;i++)sim.step();
  assert.ok(sim.heights.every(x=>Number.isFinite(x)&&Math.abs(x)<1e-12));
  assert.equal(sim.distribution[6],144);
});

test('audio region excludes outside cells and normalizes music by selected area',()=>{
  const sim=new Simulation(4,3);
  sim.bins.set([0,0,0,0, 0,7,8,0, 0,6,8,0]);
  const region=selectionBounds({x:1,y:1},{x:2,y:2},4,3);
  const distribution=sim.distributionFor(region);
  assert.equal(distribution.reduce((a,b)=>a+b),4);
  assert.equal(distribution[0],0);
  assert.equal(distribution[6],1);assert.equal(distribution[7],1);assert.equal(distribution[8],2);
  const mapping=musicMapping(distribution);
  assert.equal(mapping.weights[7],.25);assert.equal(mapping.weights[8],.5);
  assert.equal(mapping.hertz,(NOTES[7]+2*NOTES[8])/4);
  sim.bins[5]=12;
  assert.equal(sim.distributionFor(region)[12],1);
});
test('region supports reverse drags, single cells and drags past canvas edges',()=>{
  const sim=new Simulation(4,3);sim.bins[11]=12;
  assert.deepEqual(selectionBounds({x:3,y:2},{x:1,y:0},4,3),{left:1,top:0,right:3,bottom:2});
  const cell=selectionBounds({x:3,y:2},{x:3,y:2},4,3);
  const mapping=musicMapping(sim.distributionFor(cell));
  assert.equal(mapping.hertz,NOTES[12]);assert.equal(mapping.weights[12],1);
  assert.deepEqual(selectionBounds({x:500,y:500},{x:-100,y:-100},4,3),{left:0,top:0,right:3,bottom:2});
});
test('default audio stays global and full-canvas selection matches global statistics',()=>{
  const sim=new Simulation(24,15);
  sim.plant('spiral',8,5,3,.25);sim.plant('circle',15,10,2,-.2);
  for(let i=0;i<30;i++)sim.step();
  const full=selectionBounds({x:0,y:0},{x:23,y:14},24,15);
  assert.equal(sim.distributionFor(),sim.distribution);
  assert.deepEqual(sim.distributionFor(full),sim.distribution);
  sim.reset();assert.equal(sim.distributionFor()[6],360);
  assert.equal(sim.distributionFor(full)[6],360);
});

test('disjoint sound regions combine counts using their total area',()=>{
  const sim=new Simulation(5,2);
  sim.bins.set([7,7,0,12,12, 7,7,0,12,12]);
  const first=selectionBounds({x:0,y:0},{x:1,y:1},5,2);
  const second=selectionBounds({x:3,y:0},{x:4,y:1},5,2);
  const regions=[first];
  assert.equal(musicMapping(sim.distributionFor(regions)).weights[7],1);
  regions.push(second);
  const distribution=sim.distributionFor(regions), mapping=musicMapping(distribution);
  assert.equal(distribution.reduce((a,b)=>a+b),8);
  assert.equal(distribution[0],0);
  assert.equal(mapping.weights[7],.5);assert.equal(mapping.weights[12],.5);
  assert.equal(mapping.hertz,(NOTES[7]+NOTES[12])/2);
  // Canceling a new draft must leave the committed regions intact.
  assert.deepEqual(sim.distributionFor(regions.slice(0,1)),sim.distributionFor(first));
  assert.equal(sim.distributionFor([]),sim.distribution);
});
test('overlapping, nested and repeated sound regions count each grid cell once',()=>{
  const sim=new Simulation(4,2);
  sim.bins.set([7,8,9,12, 7,8,9,12]);
  const a=selectionBounds({x:0,y:0},{x:2,y:1},4,2);
  const b=selectionBounds({x:1,y:0},{x:3,y:1},4,2);
  const nested=selectionBounds({x:1,y:0},{x:1,y:0},4,2);
  const distribution=sim.distributionFor([a,b,a,nested]);
  assert.equal(distribution.reduce((sum,count)=>sum+count),8);
  for(const bin of [7,8,9,12])assert.equal(distribution[bin],2);
  assert.deepEqual(sim.distributionFor([b,a]),distribution);
  assert.deepEqual(sim.distributionFor([nested]),sim.distributionFor(nested));
});
