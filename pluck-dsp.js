import { electricStringNext } from './electric-string.js';
// Two basic short voices: round Bubble and a clean modal-string Electric.
// Field voices excite once per sampled frame, including small/held values.
const TAU=2*Math.PI;
export const isPluckedWaveform=type=>['pluck','bubble','electric'].includes(type);
export function pluckState(){return {age:1,weight:0,triggerWeight:0,pitch:0,level:0};}
export function pluckNext(state,phase,hz,weight,sampleRate,advance=true,tick,interval=.1,timbre='bubble'){
  if(!advance)return 0;
  const electric=timbre==='electric';
  const previous=state.triggerWeight??state.weight;
  const onset=state.weight<=.0005&&weight>.0005;
  const changed=Math.abs(weight-previous)>Math.max(.0015,previous*.08);
  const pitchChange=state.pitch>0&&Math.abs(Math.log2(Math.max(1,hz)/state.pitch))>1/96;
  const trigger=tick===undefined?state.age>=.008&&(onset||changed||pitchChange||!state.pitch):tick!==state.tick;
  state.tick=tick;
  if(weight>0&&trigger){
    if(electric){state.previousAge=state.age;state.previousElectric=state.level>0;}
    state.age=0;state.level=weight;state.pitch=Math.max(1,hz);state.triggerWeight=weight;
  }
  state.weight=weight;
  const age=state.age;state.age+=1/sampleRate;
  if(electric)return electricStringNext(state,phase,hz,weight,sampleRate);
  if(!state.level||age+1e-9>=.09||hz<=0||hz>=sampleRate*.45)return 0;
  const attack=Math.min(1,age/.0015),decay=Math.exp(-age/.022),release=Math.min(1,(.09-age)/.01);
  let value=Math.sin(TAU*phase);
  if(2*hz<sampleRate*.45)value+=.06*Math.sin(TAU*phase*2)*Math.exp(-age*35);
  return value*attack*decay*release*state.level*2.9*Math.max(.5,Math.min(1.5,Math.sqrt(interval/.1)));
}
