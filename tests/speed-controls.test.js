import test from 'node:test';
import assert from 'node:assert/strict';
import { SoundEngine,fieldSoundKey } from '../audio.js';
import { Simulation } from '../simulation.js';
import { ContinuousTone,LivePluckCluster } from '../continuous-dsp.js';

test('waveform changes during asynchronous audio startup are retained until voices are ready',()=>{
 const sound=new SoundEngine();sound.context={}; // AudioContext exists while worklet modules are still loading.
 for(const type of ['bubble','electric','square']){
  assert.doesNotThrow(()=>sound.setWaveform(type));assert.equal(sound.waveform,type);
 }
 const oscillator={type:'sine'};sound.voices=[{oscillator},null];
 sound.setWaveform(sound.waveform);assert.equal(oscillator.type,'square');
});

function harness(waveform,mode){
 const sound=new SoundEngine(),messages=[],tone=new ContinuousTone(),cluster=new LivePluckCluster();
 sound.context={currentTime:0};sound.waveform=waveform;sound.mode=mode;sound.running=true;sound.stepRate=.25;
 sound.master={gain:{}};sound.live={gain:{}};sound.averageGain={gain:{}};sound.voices=[];sound.smooth=(param,value)=>param.value=value;
 sound.continuous={port:{postMessage(data){
  messages.push(structuredClone(data));if(data.type!=='live')return;
  Object.assign(tone,{target:data.hz,speed:data.speed,waveform:data.waveform,pluckInterval:data.pluckInterval});
  Object.assign(cluster,{weights:data.weights,pitchRate:data.pitchRate,waveform:data.waveform,pluckInterval:data.pluckInterval});
 }}};
 return {sound,messages,next(){return mode==='cluster'?cluster.next(8000):tone.next(8000);}};
}
test('Normal/Step selection cannot change audio identity, but actual parameter edits do',()=>{
 const sim=new Simulation(20,16),sound=new SoundEngine(),key=fieldSoundKey(sim,sound,[]);
 sound.samplingMode='step';assert.equal(fieldSoundKey(sim,sound,[]),key);
 sound.stepRate=.05;assert.notEqual(fieldSoundKey(sim,sound,[]),key);
 sound.stepRate=1;sound.speed=2;assert.notEqual(fieldSoundKey(sim,sound,[]),key);
});
test('switching Normal/Step preserves held mappings, sampling clock, pluck pulses and every audio sample',()=>{
 for(const waveform of ['bubble','electric'])for(const mode of ['cluster','average']){
  const reference=harness(waveform,mode),switched=harness(waveform,mode),sim=new Simulation(20,16);
  for(let block=0;block<80;block++){
   for(const h of [reference,switched]){
    h.sound.context.currentTime=block*128/8000;
    if(h===switched)h.sound.samplingMode=block%2?'normal':'step';
    h.sound.setLiveKey(fieldSoundKey(sim,h.sound,[]));
    h.sound.update(()=>{const distribution=new Uint32Array(13);distribution[block%5]=100;return distribution;});
   }
   assert.equal(switched.sound.sampleClock.next,reference.sound.sampleClock.next);
   assert.deepEqual(switched.sound.sampleClock.mapping,reference.sound.sampleClock.mapping);
   assert.deepEqual(switched.messages,reference.messages);
   for(let i=0;i<128;i++)assert.equal(switched.next(),reference.next());
  }
 }
});
test('Step remains active while editing Normal and does not alter the stored scene speed',()=>{
 const h=harness('bubble','average');h.sound.samplingMode='normal';h.sound.stepRate=.05;h.sound.speed=2;
 const distribution=hzBin=>{const values=new Uint32Array(13);values[hzBin]=1;return values;};
 h.sound.update(distribution(0));const first=h.messages.at(-1);
 h.sound.context.currentTime=.8;h.sound.update(distribution(4));assert.equal(h.messages.at(-1).hz,first.hz);
 h.sound.context.currentTime=1;h.sound.update(distribution(4));assert.notEqual(h.messages.at(-1).hz,first.hz);
 assert.equal(h.sound.speed,2);assert.equal(h.sound.stepRate,.05);
});
