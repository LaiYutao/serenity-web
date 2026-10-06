// The original Serenity field/height/music model, adapted to a regular JS grid.
export const WIDTH = 240, HEIGHT = 150, STEP = 0.1, SPEED = 10;
export const GLYPHS = ' .,:;*o%&#H$@';
export const NOTES = [261.63,277.18,293.66,311.13,329.63,349.23,0,369.99,392,415.30,440,466.16,493.88];
const TAU = Math.PI * 2;
export const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
export function heightBin(value) {
  // C++ rounds halves away from zero; Math.round does not for negative values.
  return clamp(Math.sign(value) * Math.floor(Math.abs(value) + 0.5), -6, 6) + 6;
}
export function selectionBounds(start, end, width=WIDTH, height=HEIGHT) {
  const x1=clamp(Math.floor(start.x),0,width-1), y1=clamp(Math.floor(start.y),0,height-1);
  const x2=clamp(Math.floor(end.x),0,width-1), y2=clamp(Math.floor(end.y),0,height-1);
  return { left:Math.min(x1,x2), top:Math.min(y1,y2), right:Math.max(x1,x2), bottom:Math.max(y1,y2) };
}
export function musicMapping(distribution) {
  const total = distribution.reduce((a, b) => a + b, 0) || 1;
  const weights = new Float64Array(13);
  for (let i=0; i<NOTES.length; i++) if (NOTES[i]) weights[i] = distribution[i] / total;
  return { weights, hertz: distribution.reduce((sum, count, i) => sum + count * NOTES[i], 0) / total };
}

export class Field {
  constructor(type, x, y, amplitude, frequency, time, width, height) {
    Object.assign(this, { type, x, y, amplitude, frequency, revisionTime: time });
    const length = width * height;
    this.distances = new Float32Array(length);
    this.angularPhase = new Float32Array(length);
    this.active = new Uint8Array(length);
    this.amps = new Float32Array(length);
    this.freqs = new Float32Array(length);
    this.phases = new Float64Array(length);
    this.phases.fill(Math.PI/2);
    for (let i=0; i<length; i++) {
      const dx=i%width-x, dy=Math.floor(i/width)-y;
      this.distances[i]=Math.hypot(dx,dy);
      const angle=(Math.atan2(dy,dx)+TAU)%TAU;
      // Original spiral delay: 10.05 / f * rayFraction / speed.
      // Cancel f algebraically so the angular phase stays finite at f = 0.
      this.angularPhase[i]=type==='spiral' ? -(10.05/SPEED)*angle : 0;
    }
  }
  change(amplitude, frequency, time) {
    if (this.amplitude===amplitude && this.frequency===frequency) return;
    this.amplitude=clamp(amplitude,0,6);
    this.frequency=clamp(frequency,-1,1);
    this.revisionTime=time;
    this.active.fill(0);
  }
  accumulate(time, output) {
    const radius=(time-this.revisionTime)*SPEED;
    for(let i=0;i<output.length;i++) {
      if(!this.active[i] && this.distances[i]<=radius+1e-6) {
        // Freeze the current local phase at zero frequency. Parameter changes
        // reach cells in an expanding front; unreached cells keep vibrating.
        this.phases[i]=this.frequency===0
          ? TAU*this.freqs[i]*time+this.phases[i]
          : Math.PI/2+this.angularPhase[i]-TAU*this.frequency*time;
        this.amps[i]=this.amplitude;
        this.freqs[i]=this.frequency;
        this.active[i]=1;
      }
      output[i]+=this.amps[i]*Math.cos(TAU*this.freqs[i]*time+this.phases[i]);
    }
  }
}

export class Simulation {
  constructor(width=WIDTH,height=HEIGHT) {
    this.width=width;this.height=height;
    this.heights=new Float64Array(width*height);
    this.bins=new Uint8Array(width*height);
    this.distribution=new Uint32Array(13);
    this.selectionMask=new Uint8Array(width*height);
    this.reset();
  }
  reset() { this.time=0;this.fields=[];this.heights.fill(0);this.bins.fill(6);this.distribution.fill(0);this.distribution[6]=this.heights.length; }
  at(x,y) { return this.fields.find(f=>f.x===Math.round(x) && f.y===Math.round(y)); }
  distributionFor(selection=null) {
    const regions=selection?(Array.isArray(selection)?selection:[selection]):[];
    if(!regions.length)return this.distribution;
    const result=new Uint32Array(13);
    this.selectionMask.fill(0);
    for(const region of regions){
      for(let y=region.top;y<=region.bottom;y++) {
        for(let x=region.left;x<=region.right;x++){
          const index=y*this.width+x;
          if(!this.selectionMask[index]){
            this.selectionMask[index]=1;
            result[this.bins[index]]++;
          }
        }
      }
    }
    return result;
  }
  plant(type,x,y,amplitude=1,frequency=.25) {
    x=clamp(Math.round(x),0,this.width-1);y=clamp(Math.round(y),0,this.height-1);
    if(this.at(x,y) || this.fields.length>=32) return null;
    const field=new Field(type,x,y,amplitude,frequency,this.time,this.width,this.height);
    this.fields.push(field);return field;
  }
  step(dt=STEP) { this.time+=dt;this.heights.fill(0);for(const field of this.fields) field.accumulate(this.time,this.heights);this.distribution.fill(0);for(let i=0;i<this.heights.length;i++){const bin=heightBin(this.heights[i]);this.bins[i]=bin;this.distribution[bin]++;} }
}
