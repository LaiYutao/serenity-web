import { Simulation } from '../../simulation.js';
import { captureFieldScene } from '../../field-recall.js';
import { createFXState } from '../../effects-dsp.js';
import { renderCycle,snapshotField } from '../../cycle-dsp.js';
import { ContinuousTone } from '../../continuous-dsp.js';
import { analyseRecording } from '../../recording-dsp.js';
export function fixture(){
  const sim=new Simulation(20,16);sim.plant('spiral',5,7,2,.5);sim.step(2.3);sim.setDirection(-1);
  const scene=captureFieldScene(sim,{speed:-1.25,mode:'average',waveform:'sawtooth',regions:[{left:1,right:14,top:2,bottom:11}],point:{x:5,y:7},type:'spiral',amplitude:2,frequency:.5,accumulator:.03});
  const result=renderCycle(snapshotField(sim,[]),'average','sawtooth',8000),map=result.pitchMap;map.continuation.introDuration=0;map.continuation.introFrames=0;
  const tone=new ContinuousTone();tone.waveform='sawtooth';tone.install({...map.continuation,mode:'average',weights:map.weights,duration:result.duration,offset:.23});
  for(let i=0;i<123;i++)tone.next(8000);
  const fx=createFXState();fx.fade.enabled=true;fx.fade.inTime=.2;fx.filter.cutoff=420;fx.delay.enabled=true;
  const track={original:result.samples,samples:result.samples,pitchSamples:result.samples,pitchKey:'0:127@1:stretch',settings:{start:.7,end:.1,lowPitch:0,highPitch:127},speed:1,speedMode:'stretch',baseDuration:result.duration,waveform:'sawtooth',continuous:true,volume:1.2,muted:false,solo:true,position:tone.profile.position,pitchMap:map,pitchCorrection:0,fx,fieldScene:scene,voice:{...tone}};
  return {format:'serenity-project',version:1,sampleRate:8000,scene,volume:.25,muted:true,recordMode:'audio',selectedTrack:0,tracks:[track,{...track,continuous:false,waveform:'recording',fieldScene:null,voice:null,pitchMap:analyseRecording(result.samples,8000),position:.8,muted:true,solo:false}]};
}
