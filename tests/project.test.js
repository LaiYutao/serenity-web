import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../simulation.js';
import { captureFieldScene,restoreFieldScene } from '../field-recall.js';
import { encodeProject,decodeProject,captureProjectTracks } from '../project.js';
import { createFXState } from '../effects-dsp.js';
import { renderCycle,snapshotField } from '../cycle-dsp.js';
import { ContinuousTone } from '../continuous-dsp.js';
import { analyseRecording } from '../recording-dsp.js';
import { LoopRecorder } from '../loops.js';
import { fixture } from './fixtures/project.js';
test('lossless self-contained archive preserves PCM, oscillator phase, offsets, FX and recall scenes',async()=>{
 const project=fixture(),restored=await decodeProject(encodeProject(project));
 assert.deepEqual(restored,project);
 const a=Object.assign(new ContinuousTone(),project.tracks[0].voice),b=Object.assign(new ContinuousTone(),restored.tracks[0].voice);
 for(let i=0;i<1000;i++)assert.equal(a.next(8000),b.next(8000));
 const sim=new Simulation(20,16);restoreFieldScene(sim,restored.scene);assert.equal(sim.time,project.scene.time);assert.deepEqual(sim.fields[0].phases,project.scene.fields[0].phases);
 // Original PCM is packed once even if shared by current and unprocessed buffers.
 assert.ok(encodeProject(project).size<project.tracks[0].original.byteLength*3+100000);
});
test('rejects foreign, truncated, unsupported-version and malformed archives before loading',async()=>{
 const blob=encodeProject(fixture());
 for(const bad of [new Blob(['wrong']),blob.slice(0,100),blob.slice(0,blob.size-7)])await assert.rejects(decodeProject(bad),/projectInvalid/);
 for(const mutate of [p=>p.version=2,p=>p.tracks[0].position=-1,p=>p.scene.fields[0].phases=new Float64Array(1),p=>p.tracks[0].samples[0]=NaN]){
  const p=fixture();mutate(p);assert.throws(()=>encodeProject(p),/projectInvalid/);
 }
});
test('capture uses the audio cursor at one shared frame, not wall time or track creation order',async()=>{
 const p=fixture(),calls=[],buffer={duration:2,sampleRate:8000,getChannelData:()=>new Float32Array(16000)};
 const tracks=p.tracks.map((saved,i)=>({...saved,buffer,appliedSpeed:1,appliedMode:'stretch',source:{slot:1,snapshot:async frame=>{calls.push(frame);return {state:{position:6400}};}}}));
 const sound={context:{sampleRate:8000,currentTime:10},snapshotContinuous:async(_slots,frame)=>{calls.push(frame);return {tracks:[{slot:1,state:p.tracks[0].voice}]};}};
 const captured=await captureProjectTracks(sound,tracks);
 assert.equal(calls[0],calls[1]);assert.equal(captured.time,calls[0]/8000);assert.ok(Math.abs(captured.tracks[1].position-.8)<1e-12);
});
test('restore reconstructs editable continuous and direct tracks with independent phase origins',()=>{
 const restored=[],starts=[],ctx={sampleRate:8000,currentTime:0,createBuffer:(_c,n,r)=>({duration:n/r,copyToChannel(){}}),createGain:()=>({connect(){}})};
 const gain=()=>({gain:{value:1},connect(){}});
 const sound={context:ctx,createContinuousLoop:()=>({connect(){},restore:v=>restored.push(v)}),createBufferLoop:()=>({connect(){},start:(_when,offset)=>starts.push(offset)}),createTrackGain:gain,connectTrack:()=>0};
 const recorder=new LoopRecorder(sound,{effectsFactory:()=>({input:{},output:{connect(){}},setState(){}})}),p=fixture();
 for(const saved of p.tracks)recorder.restoreProjectTrack(saved);
 assert.equal(recorder.tracks.length,2);assert.equal(restored[0],p.tracks[0].voice);assert.deepEqual(starts,[.8]);
 assert.equal(recorder.tracks[1].startedAt,-.8);assert.equal(recorder.tracks[0].fx.fade.inTime,.2);assert.ok(recorder.tracks[0].fieldScene);
});

test('projects preserve both track rates, the selected editor and the actual pitch independently',async()=>{
 const p=fixture();
 for(const track of p.tracks){track.normalSpeed=2;track.stretchSpeed=.5;track.speed=1;track.speedMode='stretch';}
 const restored=await decodeProject(encodeProject(p));assert.deepEqual(restored,p);
 const saved=p.tracks[0],track={...saved,appliedNormalSpeed:2,appliedStretchSpeed:.5,baseDuration:2,
  buffer:{duration:2,getChannelData:()=>saved.samples},source:{slot:1},projectVoice:saved.voice};
 const captured=await captureProjectTracks({context:{currentTime:0,sampleRate:8000}},[track],{frozen:true});
 assert.equal(captured.tracks[0].voice.pitchSpeed,2);assert.equal(captured.tracks[0].voice.rate,1);
 assert.equal(captured.tracks[0].speedMode,'stretch');assert.equal(captured.tracks[0].normalSpeed,2);assert.equal(captured.tracks[0].stretchSpeed,.5);
 for(const value of [.25,4]){
  const project=fixture();for(const t of project.tracks){t.normalSpeed=value;t.stretchSpeed=value;t.speed=value*value;}
  assert.equal((await decodeProject(encodeProject(project))).tracks[0].speed,value*value);
 }
 for(const mutate of [t=>t.normalSpeed=0,t=>t.stretchSpeed=5,t=>t.speed=2]){
  const project=structuredClone(p);mutate(project.tracks[0]);assert.throws(()=>encodeProject(project),/projectInvalid/);
 }
});

test('Drive settings survive project storage and projects saved before Drive remain readable',async()=>{
 const p=fixture();p.tracks[0].fx.drive={enabled:true,drive:.8,fuzz:.9,tone:3300,mix:.6};p.fxPage='drive';
 assert.deepEqual(await decodeProject(encodeProject(p)),p);
 delete p.tracks[0].fx.drive;assert.ok((await decodeProject(encodeProject(p))).tracks[0]);
 p.tracks[0].fx.drive={enabled:true,drive:2,fuzz:.9,tone:3300,mix:.6};assert.throws(()=>encodeProject(p),/projectInvalid/);
});
