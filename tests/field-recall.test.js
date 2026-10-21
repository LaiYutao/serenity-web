import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../simulation.js';
import { captureFieldScene, restoreFieldScene, fieldRecallElapsed } from '../field-recall.js';

const near=(a,b)=>{assert.equal(a.length,b.length);for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]-b[i])<1e-7,`cell ${i}: ${a[i]} / ${b[i]}`);};
const setup=()=>{const s=new Simulation(24,14);s.plant('circle',2,3,3,.25);s.plant('spiral',19,9,2,-.2);for(let i=0;i<6;i++)s.step();return s;};

test('recall replaces the scene and independently restores source geometry, mode, regions and parameters',()=>{
 const original=setup(),settings={speed:-1,mode:'average',waveform:'triangle',point:{x:2,y:3},regions:[{left:1,right:5,top:2,bottom:7}],accumulator:0};
 const captured=captureFieldScene(original,settings),expected=original.heights.slice();
 original.fields[0].change(6,0,original.time);settings.regions[0].left=20;
 const target=new Simulation(24,14);target.plant('circle',5,5);const restored=restoreFieldScene(target,captured);
 assert.equal(target.fields.length,2);assert.equal(target.fields[1].type,'spiral');assert.equal(target.fields[0].amplitude,3);
 assert.equal(restored.mode,'average');assert.equal(restored.waveform,'triangle');assert.equal(restored.regions[0].left,1);
 near(target.heights,expected);target.fields[0].change(5,.5,target.time);assert.equal(captured.fields[0].amplitude,3);
 restoreFieldScene(target,captured);near(target.heights,expected);
});
test('recall advances pending propagation, parameter changes and reversal on the fixed simulation clock',()=>{
 for(const frequency of [0,.4,-.3]){
  const expected=setup();expected.setDirection(-1);expected.fields[0].change(1,frequency,expected.time);expected.step();
  const captured=captureFieldScene(expected,{speed:-2,accumulator:.03});
  const target=new Simulation(24,14),result=restoreFieldScene(target,captured,.4);
  for(let i=0;i<8;i++)expected.step();
  near(target.heights,expected.heights);assert.ok(Math.abs(result.accumulator-.03)<1e-9);
  assert.equal(target.direction,-1);
  target.step();expected.step();near(target.heights,expected.heights);
 }
});
test('settled motion can skip many cycles without replaying source operations or changing phase',()=>{
 const expected=setup();for(let i=0;i<40;i++)expected.step();
 const captured=captureFieldScene(expected,{speed:1,accumulator:0});
 const target=new Simulation(24,14);restoreFieldScene(target,captured,35.2);
 for(let i=0;i<352;i++)expected.step();near(target.heights,expected.heights);
 assert.equal(target.fields.length,2);assert.equal(target.fields[0].history.length,1);
});
test('recall into a changed viewport keeps cells square and offsets sources, point and regions together',()=>{
 const original=setup();const captured=captureFieldScene(original,{speed:1,point:{x:2,y:3},regions:[{left:1,right:5,top:2,bottom:7}]});
 original.resize(32,20);const target=new Simulation(32,20),state=restoreFieldScene(target,captured);
 near(target.heights,original.heights);assert.equal(target.fields[0].x,6);assert.deepEqual(state.point,{x:6,y:6});
 assert.deepEqual(state.regions,[{left:5,right:9,top:5,bottom:10}]);
});
test('recall follows the actual audio-thread playhead after track rate changes',async()=>{
 const sound={context:{currentTime:10,sampleRate:48000},snapshotContinuous:async(slots,frame)=>{
  assert.deepEqual(slots,[3]);sound.context.currentTime=frame/48000+.02;
  return {frame,tracks:[{state:{profile:{elapsed:7.25},rate:1.5}}]};
 }};
 const elapsed=await fieldRecallElapsed(sound,{continuous:true,source:{slot:3}});
 assert.ok(Math.abs(elapsed-7.28)<1e-10);
});
test('fallback field recall maps rendered speed to the original scene period',async()=>{
 assert.equal(await fieldRecallElapsed({context:{currentTime:7}},{buffer:{duration:2},baseDuration:4,startedAt:4}),2);
});
