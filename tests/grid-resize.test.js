import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, gridForViewport } from '../simulation.js';

test('screen aspect changes grid counts so horizontal and vertical cells remain square',()=>{
 for(const [w,h] of [[861,580],[1100,580],[360,300],[1600,700]]){
  const grid=gridForViewport(w,h);
  assert.ok(Math.abs((w/grid.width)/(h/grid.height)-1)<.01);
  assert.ok(Math.abs(grid.width*grid.height/36000-1)<.02);
 }
 assert.notDeepEqual(gridForViewport(861,580),gridForViewport(1100,580));
});
test('expanding the grid preserves the current field and reconstructs new cells including old parameter changes',()=>{
 const small=new Simulation(8,6),large=new Simulation(24,16);
 small.plant('circle',3,2,2,.25);large.plant('circle',11,7,2,.25);
 small.plant('spiral',5,4,1,-.2);large.plant('spiral',13,9,1,-.2);
 const advance=count=>{for(let i=0;i<count;i++){small.step();large.step();}};
 advance(12);small.fields[0].change(3,0,small.time);large.fields[0].change(3,0,large.time);
 advance(6);small.fields[1].change(2,.4,small.time);large.fields[1].change(2,.4,large.time);advance(4);
 const time=small.time;assert.deepEqual(small.resize(24,16),{dx:8,dy:5});assert.equal(small.time,time);
 for(let i=0;i<large.heights.length;i++)assert.ok(Math.abs(small.heights[i]-large.heights[i])<1e-7,`cell ${i}`);
 for(let frame=0;frame<10;frame++){
  small.step();large.step();
  for(let i=0;i<large.heights.length;i++)assert.ok(Math.abs(small.heights[i]-large.heights[i])<1e-7,`future frame ${frame}, cell ${i}`);
 }
});
test('odd-size resize round trips do not move sources or selection coordinates',()=>{
 const sim=new Simulation(240,150);sim.plant('circle',119,69);
 for(let i=0;i<5;i++){sim.resize(223,161);sim.resize(240,150);}
 assert.equal(sim.fields[0].x,119);assert.equal(sim.fields[0].y,69);
});
test('regions remain safe when a smaller viewport leaves part or all of a region offscreen',()=>{
 const sim=new Simulation(8,6);
 assert.equal(sim.distributionFor({left:-5,right:2,top:-2,bottom:1}).reduce((a,b)=>a+b),6);
 assert.equal(sim.distributionFor({left:20,right:25,top:1,bottom:2}).reduce((a,b)=>a+b),0);
});
