import { FieldEvolution } from './field-evolution.js';
import { heightBin, musicMapping, NOTES } from './simulation.js';
const TAU=2*Math.PI;
export function fieldPeriod(fields){
  const gcd=(a,b)=>b?gcd(b,a%b):a;
  let divisor=0;
  for(const field of fields)for(let i=0;i<field.freqs.length;i++)if(field.amps[i])divisor=gcd(divisor,Math.round(Math.abs(field.freqs[i])*100));
  return divisor?100/divisor:1;
}
export function snapshotField(sim,regions,speed=1){
  const selected=[];
  for(let i=0;i<sim.heights.length;i++){
    const x=i%sim.width,y=Math.floor(i/sim.width);
    if(!regions.length||regions.some(r=>x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom))selected.push(i);
  }
  return {time:sim.time,simulationTime:sim.time,speed,fields:sim.fields.map(f=>({direction:f.direction,amps:f.amps.slice(),freqs:f.freqs.slice(),phases:f.phases.slice(),active:f.active.slice(),distances:f.distances.slice(),angularPhase:f.angularPhase.slice(),targetAmplitude:f.amplitude,targetFrequency:f.frequency,revisionTime:f.revisionTime})),selected};
}
export function renderCycle(snapshot,mode,waveform,sampleRate,options={}){
  const duration=options.duration??fieldPeriod(snapshot.fields.map(f=>mode==='average'&&f.active?{amps:[f.targetAmplitude],freqs:[f.targetFrequency]}:f))/(snapshot.speed??1),length=Math.round(duration*sampleRate),frames=options.pitchMap?.frames??Math.max(20,Math.ceil(duration*20));
  const pitchRate=options.pitchMap?.pitchRate??snapshot?.speed??1;
  const mappings=[],evolution=snapshot?new FieldEvolution(mode==='average'?snapshot:{...snapshot,fields:snapshot.fields.map(({amps,freqs,phases,direction})=>({amps,freqs,phases,direction}))}):null;
  const continuation=options.pitchMap?.continuation??(mode==='average'&&evolution?evolution.continuation(duration):null);
  if(options.pitchMap){
    for(let f=0;f<frames;f++){const weights=options.pitchMap.weights[f].slice();weights.splice(6,0,0);mappings.push({weights,hertz:options.pitchMap.frequencies[f]});}
  }else for(let frame=0;frame<frames;frame++)mappings.push(evolution.mappingAt(frame*duration/frames));
  const lowHz=options.lowHz??0,highHz=options.highHz??Infinity;
  const table=new Float32Array(8192),type=waveform==='original'&&mode==='average'?'sine':waveform;
  for(let i=0;i<table.length;i++){
    const p=TAU*i/table.length;
    if(type==='original')table[i]=Math.sin(p)+.1*Math.sin(2*p)+.056*Math.sin(3*p)+.042*Math.sin(4*p)+.037*Math.sin(5*p);
    else if(type==='triangle')table[i]=2/Math.PI*Math.asin(Math.sin(p));
    else if(type==='sawtooth')table[i]=i/table.length*2-1;
    else if(type==='square')table[i]=i<table.length/2?1:-1;
    else table[i]=Math.sin(p);
  }
  const samples=new Float32Array(length);
  const value=phase=>{const p=((phase%1)+1)%1*table.length,index=Math.floor(p);return table[index]*(1-(p-index))+table[(index+1)%table.length]*(p-index);};
  const phases=mode==='average'?new Float64Array(length+1):null;
  if(phases)for(let n=0;n<length;n++){
    const position=n/length*frames,index=Math.floor(position),fraction=position-index;
    phases[n+1]=phases[n]+(mappings[index].hertz*(1-fraction)+mappings[(index+1)%frames].hertz*fraction)*pitchRate/sampleRate;
  }
  // Microtone playback keeps accumulating phase across field periods; no pitch retuning.
  for(let n=0;n<length;n++){
    const position=n/length*frames,index=Math.floor(position),fraction=position-index,a=mappings[index],b=mappings[(index+1)%frames];
    if(mode==='average'){
      const hz=(a.hertz*(1-fraction)+b.hertz*fraction)*pitchRate;
      samples[n]=hz>0&&hz>=lowHz&&hz<=highHz?value(phases[n])*10000/32768:0;
    }else{
      let sum=0;for(let i=0;i<NOTES.length;i++)if(NOTES[i]){
        const note=60+(i>6?i-1:i)+12*Math.log2(pitchRate);if(note<(options.lowPitch??0)||note>(options.highPitch??127))continue;
        // Integer carrier cycles close the audio phase over the field's evolution period.
        const cycles=Math.round(NOTES[i]*pitchRate*duration),weight=a.weights[i]*(1-fraction)+b.weights[i]*fraction;
        sum+=weight*value(n/length*cycles);
      }
      samples[n]=sum*12000/32768;
    }
  }
  return {samples,duration,pitchMap:{mode,frames,pitchRate,continuation,weights:mappings.map(m=>Array.from(m.weights).filter((_,i)=>i!==6)),frequencies:mappings.map(m=>m.hertz)},pitchCorrection:mode==='average'?0:Math.max(...NOTES.filter(Boolean).map(hz=>Math.abs(Math.round(hz*pitchRate*duration)/duration-hz*pitchRate)))};
}
export function processCycle(original,settings={}){
  const {start=0,end=0,low=-1,high=1}=settings,result=original.slice(),size=result.length;
  const ramp=Math.max(1,Math.min(128,Math.floor(size*.002)));
  for(let i=0;i<size;i++){
    const p=i/size;
    const inside=start<end?p>=start&&p<end:start>end&&(p>=start||p<end);
    let gain=1;
    if(start!==end){
      if(inside)gain=0;
      else{
        const distance=Math.min((start-p+1)%1,(p-end+1)%1)*size;
        gain=Math.min(1,distance/ramp);
      }
    }
    // Signed amplitude band removal, distinct from normalizing or clipping peaks.
    const sample=original[i];result[i]=(sample<low||sample>high?0:sample)*gain;
  }
  return result;
}

// Coordinates are unwrapped cycle positions, so a drag across 1.0 retains its direction in time.
export function maskFromDrag(a,b){
  const low=Math.min(a,b),high=Math.max(a,b);
  if(high-low>=1-1e-9)return {start:0,end:1};
  const wrap=x=>((x%1)+1)%1;
  return {start:wrap(low),end:wrap(high)};
}

export const midiHz=note=>440*2**((note-69)/12);
export function renderPitchMask(pitchMap,duration,waveform,sampleRate,lowPitch=0,highPitch=127){
  return renderCycle(null,pitchMap.mode,waveform,sampleRate,{pitchMap,duration,lowPitch,highPitch,lowHz:lowPitch===0?0:midiHz(lowPitch),highHz:highPitch===127?Infinity:midiHz(highPitch)});
}
