import { STEP, SPEED, heightBin, musicMapping } from './simulation.js';
const TAU=2*Math.PI;
// Preserve pending propagation as well as the values already reached at capture time.
export class FieldEvolution{
  constructor(snapshot){
    this.time=snapshot.time;this.speed=snapshot.speed??1;this.selected=snapshot.selected;
    this.spatialPositions=snapshot.spatialPositions;
    const base=snapshot.simulationTime??snapshot.time;let lastArrival=snapshot.time;
    this.fields=snapshot.fields.map(field=>{
      const arrivals=new Float64Array(this.selected.length),futurePhases=new Float64Array(this.selected.length);
      arrivals.fill(Infinity);
      if(field.active)for(let n=0;n<this.selected.length;n++){
        const i=this.selected[n];if(field.active[i])continue;
        const arrival=base+Math.max(1,Math.ceil((field.revisionTime+field.distances[i]/SPEED-base)/STEP-1e-6))*STEP;
        arrivals[n]=arrival;lastArrival=Math.max(lastArrival,arrival);
        futurePhases[n]=field.targetFrequency===0?TAU*(field.direction??1)*field.freqs[i]*arrival+field.phases[i]:Math.PI/2+field.angularPhase[i]-TAU*(field.direction??1)*field.targetFrequency*arrival;
      }
      return {...field,arrivals,futurePhases};
    });
    this.settleAfter=Math.max(0,(lastArrival-this.time)/this.speed);
  }
  mappingAt(elapsed){
    const time=this.time+elapsed*this.speed,distribution=new Uint32Array(13),panSums=this.spatialPositions?new Float64Array(13):null;
    for(let n=0;n<this.selected.length;n++){
      const i=this.selected[n];let height=0;
      for(const f of this.fields){
        const reached=time+1e-9>=f.arrivals[n];
        const amp=reached?f.targetAmplitude:f.amps[i],frequency=reached?Math.fround(f.targetFrequency):f.freqs[i],phase=reached?f.futurePhases[n]:f.phases[i];
        height+=amp*Math.cos(TAU*(f.direction??1)*frequency*time+phase);
      }
      const bin=heightBin(height);distribution[bin]++;if(panSums)panSums[bin]+=this.spatialPositions[n];
    }
    return musicMapping(panSums?{counts:distribution,panSums}:distribution);
  }
  continuation(duration){
    const introFrames=Math.ceil(this.settleAfter/.05-1e-9),introDuration=introFrames*.05;
    const loopFrames=Math.max(20,Math.ceil(duration*20));
    const frequencies=new Float64Array(introFrames+loopFrames);
    const panFrames=this.spatialPositions?new Float64Array(frequencies.length):undefined;
    for(let i=0;i<frequencies.length;i++){
      const elapsed=i<introFrames?i*.05:introDuration+(i-introFrames)*duration/loopFrames;
      const mapping=this.mappingAt(elapsed);frequencies[i]=mapping.hertz;if(panFrames)panFrames[i]=mapping.pan;
    }
    return {frequencies,...(panFrames?{panFrames}:{}),introFrames,introDuration,loopDuration:duration};
  }
}
