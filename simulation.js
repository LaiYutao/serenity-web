// The original Serenity field/height/music model, adapted to a regular JS grid.
export const WIDTH = 240, HEIGHT = 150, STEP = 0.1, SPEED = 10;
export const GLYPHS = ' .,:;*o%&#H$@';
export const NOTES = [261.63,277.18,293.66,311.13,329.63,349.23,0,369.99,392,415.30,440,466.16,493.88];
const TAU = Math.PI * 2;
export function gridForViewport(width,height,cells=WIDTH*HEIGHT){
  if(width<=0||height<=0)return {width:WIDTH,height:HEIGHT};
  const ratio=width/height,rows=Math.max(16,Math.round(Math.sqrt(cells/ratio)));
  return {width:Math.max(16,Math.round(rows*ratio)),height:rows};
}
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
  constructor(type, x, y, amplitude, frequency, time, width, height, direction=1) {
    Object.assign(this, { type, x, y, amplitude, frequency, revisionTime: time });
    this.history=[{amplitude,frequency,time}];
    this.direction=direction;this.initialDirection=direction;this.directionHistory=[];
    const length = width * height;
    this.distances = new Float32Array(length);
    this.angularPhase = new Float32Array(length);
    this.active = new Uint8Array(length);
    this.activeCount=0;
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
    this.history.push({amplitude:this.amplitude,frequency:this.frequency,time});
    this.active.fill(0);this.activeCount=0;
  }
  setDirection(direction,time){
    if(direction===this.direction)return;
    const from=this.direction;
    for(let i=0;i<this.phases.length;i++)this.phases[i]+=TAU*this.freqs[i]*(from-direction)*time;
    this.directionHistory.push({time,from,to:direction});this.direction=direction;
  }
  resized(width,height,oldWidth,oldHeight,dx,dy,time){
    const field=new Field(this.type,this.x+dx,this.y+dy,this.amplitude,this.frequency,this.revisionTime,width,height,this.initialDirection);
    field.history=this.history.map(revision=>({...revision}));
    field.direction=this.direction;field.directionHistory=this.directionHistory.map(event=>({...event}));
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=y*width+x,ox=x-dx,oy=y-dy;
      if(ox>=0&&ox<oldWidth&&oy>=0&&oy<oldHeight){
        const old=oy*oldWidth+ox;
        field.amps[i]=this.amps[old];field.freqs[i]=this.freqs[old];field.phases[i]=this.phases[old];field.active[i]=this.active[old];
      }else{
        // New viewport cells replay propagation and direction changes in their original order.
        const events=this.directionHistory.map(event=>({...event,kind:'direction'}));
        for(let r=0;r<this.history.length;r++){
          const revision=this.history[r],until=Math.min(time,this.history[r+1]?.time??time);
          const steps=Math.max(1,Math.ceil(field.distances[i]/SPEED/STEP-1e-6)),arrival=revision.time+steps*STEP;
          if(arrival<=until+1e-9)events.push({kind:'arrival',time:arrival,revision,last:r===this.history.length-1});
        }
        let direction=this.initialDirection;
        events.sort((a,b)=>a.time-b.time||(a.kind==='arrival'?-1:1));
        for(const event of events){
          if(event.time>time+1e-9)continue;
          if(event.kind==='direction'){
            field.phases[i]+=TAU*field.freqs[i]*(direction-event.to)*event.time;direction=event.to;
          }else{
            const revision=event.revision;
            field.phases[i]=revision.frequency===0?TAU*direction*field.freqs[i]*event.time+field.phases[i]:Math.PI/2+field.angularPhase[i]-TAU*direction*revision.frequency*event.time;
            field.amps[i]=revision.amplitude;field.freqs[i]=revision.frequency;
            if(event.last)field.active[i]=1;
          }
        }
      }
      field.activeCount+=field.active[i];
    }
    return field;
  }
  accumulate(time, output) {
    const radius=(time-this.revisionTime)*SPEED;
    for(let i=0;i<output.length;i++) {
      if(!this.active[i] && this.distances[i]<=radius+1e-6) {
        // Freeze the current local phase at zero frequency. Parameter changes
        // reach cells in an expanding front; unreached cells keep vibrating.
        this.phases[i]=this.frequency===0
          ? TAU*this.direction*this.freqs[i]*time+this.phases[i]
          : Math.PI/2+this.angularPhase[i]-TAU*this.direction*this.frequency*time;
        this.amps[i]=this.amplitude;
        this.freqs[i]=this.frequency;
        this.active[i]=1;this.activeCount++;
      }
      output[i]+=this.amps[i]*Math.cos(TAU*this.direction*this.freqs[i]*time+this.phases[i]);
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
  reset() { this.direction=1;this.time=0;this.fields=[];this.heights.fill(0);this.bins.fill(6);this.distribution.fill(0);this.distribution[6]=this.heights.length; }
  resize(width,height){
    if(width===this.width&&height===this.height)return {dx:0,dy:0};
    const oldWidth=this.width,oldHeight=this.height,dx=Math.floor(width/2)-Math.floor(oldWidth/2),dy=Math.floor(height/2)-Math.floor(oldHeight/2);
    this.fields=this.fields.map(field=>field.resized(width,height,oldWidth,oldHeight,dx,dy,this.time));
    this.width=width;this.height=height;this.heights=new Float64Array(width*height);this.bins=new Uint8Array(width*height);this.selectionMask=new Uint8Array(width*height);
    this.distribution.fill(0);
    for(const field of this.fields)for(let i=0;i<this.heights.length;i++)this.heights[i]+=field.amps[i]*Math.cos(TAU*field.direction*field.freqs[i]*this.time+field.phases[i]);
    for(let i=0;i<this.heights.length;i++){const bin=heightBin(this.heights[i]);this.bins[i]=bin;this.distribution[bin]++;}
    return {dx,dy};
  }
  at(x,y) { return this.fields.find(f=>f.x===Math.round(x) && f.y===Math.round(y)); }
  distributionFor(selection=null) {
    const regions=selection?(Array.isArray(selection)?selection:[selection]):[];
    if(!regions.length)return this.distribution;
    const result=new Uint32Array(13);
    this.selectionMask.fill(0);
    for(const region of regions){
      for(let y=Math.max(0,region.top);y<=Math.min(this.height-1,region.bottom);y++) {
        for(let x=Math.max(0,region.left);x<=Math.min(this.width-1,region.right);x++){
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
    const field=new Field(type,x,y,amplitude,frequency,this.time,this.width,this.height,this.direction);
    this.fields.push(field);return field;
  }
  setDirection(direction){
    direction=direction<0?-1:1;
    for(const field of this.fields)field.setDirection(direction,this.time);
    this.direction=direction;
  }
  step(dt=STEP) { this.time+=dt;this.heights.fill(0);for(const field of this.fields) field.accumulate(this.time,this.heights);this.distribution.fill(0);for(let i=0;i<this.heights.length;i++){const bin=heightBin(this.heights[i]);this.bins[i]=bin;this.distribution[bin]++;} }
}

// Read intermediate field phases without changing propagation or the visible grid.
export function sampleDistribution(sim,regions=[],offset=0){
  if(!offset)return sim.distributionFor(regions);
  const distribution=new Uint32Array(13),time=sim.time+offset;
  for(let i=0;i<sim.heights.length;i++){
    const x=i%sim.width,y=Math.floor(i/sim.width);
    if(regions.length&&!regions.some(r=>x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom))continue;
    let height=0;for(const f of sim.fields)height+=f.amps[i]*Math.cos(TAU*f.direction*f.freqs[i]*time+f.phases[i]);
    distribution[heightBin(height)]++;
  }
  return distribution;
}
