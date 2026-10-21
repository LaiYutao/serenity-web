import { Simulation, Field, STEP, heightBin } from './simulation.js';
import { cloneState } from './stateful-dsp.js';

// Include cells outside listening regions, propagation fronts and parameter history.
export function captureFieldScene(sim,settings={}){
  return {width:sim.width,height:sim.height,time:sim.time,direction:sim.direction,
    fields:sim.fields.map(field=>cloneState({...field})),settings:cloneState(settings)};
}

export function restoreFieldScene(sim,scene,elapsed=0){
  const width=sim.width,height=sim.height,restored=new Simulation(scene.width,scene.height);
  restored.time=scene.time;restored.direction=scene.direction;
  restored.fields=scene.fields.map(field=>Object.assign(Object.create(Field.prototype),cloneState(field)));
  const settings=cloneState(scene.settings),advance=Math.max(0,settings.accumulator??0)+Math.max(0,elapsed)*Math.abs(settings.speed??1);
  let steps=Math.floor((advance+1e-9)/STEP);
  const accumulator=Math.max(0,advance-steps*STEP);
  // Preserve fixed-step arrival timing before skipping ahead through settled motion.
  while(steps>0&&restored.fields.some(field=>field.activeCount<restored.heights.length)){restored.step();steps--;}
  if(steps>0)restored.step(steps*STEP);
  const {dx,dy}=restored.resize(width,height);
  restored.heights.fill(0);restored.distribution.fill(0);
  for(const field of restored.fields)for(let i=0;i<restored.heights.length;i++)restored.heights[i]+=field.amps[i]*Math.cos(2*Math.PI*field.direction*field.freqs[i]*restored.time+field.phases[i]);
  for(let i=0;i<restored.heights.length;i++){const bin=heightBin(restored.heights[i]);restored.bins[i]=bin;restored.distribution[bin]++;}
  Object.assign(sim,restored);
  settings.point={x:Math.max(0,Math.min(width-1,(settings.point?.x??scene.width/2)+dx)),y:Math.max(0,Math.min(height-1,(settings.point?.y??scene.height/2)+dy))};
  settings.regions=(settings.regions??[]).map(region=>({...region,left:region.left+dx,right:region.right+dx,top:region.top+dy,bottom:region.bottom+dy}));
  return {...settings,accumulator};
}

export async function fieldRecallElapsed(sound,track){
  if(track.continuous&&sound.snapshotContinuous){
    const ctx=sound.context,frame=Math.ceil((ctx.currentTime+.03)*ctx.sampleRate/128)*128;
    const snapshot=await sound.snapshotContinuous([track.source.slot],frame);
    const voice=snapshot.tracks[0]?.state;
    if(voice?.profile)return voice.profile.elapsed+Math.max(0,ctx.currentTime-snapshot.frame/ctx.sampleRate)*(voice.rate??1);
  }
  const duration=track.buffer.duration,position=((sound.context.currentTime-track.startedAt)%duration+duration)%duration;
  return position/duration*(track.baseDuration??duration);
}
