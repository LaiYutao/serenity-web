// Shared by the audio thread and offline worker. Snapshots contain state, not a replay recipe.
export class GainState {
  constructor(value=1){this.value=value;this.target=value;this.constant=.015;}
  set(value,constant=0){this.target=value;this.constant=constant;if(!constant)this.value=value;}
  next(rate){if(this.constant)this.value+=(this.target-this.value)*(1-Math.exp(-1/(rate*this.constant)));return this.value;}
}
export class BufferVoice {
  constructor(samples=new Float32Array(),position=0){this.samples=samples;this.position=position;this.active=false;this.startFrame=0;this.stopFrame=Infinity;}
  next(frame){
    if(this.paused||frame<this.startFrame||frame>=this.stopFrame||!this.samples.length){this.left=0;this.right=0;return 0;}
    this.active=true;const n=this.samples.length,p=((this.position%n)+n)%n,i=Math.floor(p),fraction=p-i;
    const value=this.samples[i]*(1-fraction)+this.samples[(i+1)%n]*fraction;
    this.left=this.channels?this.channels[0][i]*(1-fraction)+this.channels[0][(i+1)%n]*fraction:value;
    this.right=this.channels?this.channels[1][i]*(1-fraction)+this.channels[1][(i+1)%n]*fraction:value;
    this.position=p+1;return value;
  }
}
export class SnapshotCompressor {
  constructor(rate){
    this.rate=rate;this.threshold=-3;this.knee=3;this.ratio=12;this.attack=.003;this.release=.15;
    this.gain=1;this.cursor=0;this.buffer=new Float32Array(Math.max(1,Math.round(rate*.005)));
  }
  next(input){
    const db=20*Math.log10(Math.max(1e-12,Math.abs(input))),over=db-this.threshold,half=this.knee/2;
    const reduction=over<=-half?0:over>=half?over*(1-1/this.ratio):(1-1/this.ratio)*(over+half)**2/(2*this.knee);
    const target=10**(-reduction/20),constant=target<this.gain?this.attack:this.release;
    this.gain+=(target-this.gain)*(1-Math.exp(-1/(this.rate*constant)));
    const delayed=this.buffer[this.cursor];this.buffer[this.cursor]=input;this.cursor=(this.cursor+1)%this.buffer.length;
    return delayed*this.gain;
  }
  nextStereo(left,right){
    this.leftBuffer??=this.buffer.slice();this.rightBuffer??=this.buffer.slice();
    const index=this.cursor,l=this.leftBuffer[index],r=this.rightBuffer[index];
    this.leftBuffer[index]=left;this.rightBuffer[index]=right;
    this.next(Math.max(Math.abs(left),Math.abs(right)));
    this.left=l*this.gain;this.right=r*this.gain;
  }
}
export function cloneState(value){
  if(ArrayBuffer.isView(value))return value.slice();
  if(Array.isArray(value))return value.map(cloneState);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,cloneState(item)]));
  return value;
}
export function restoreState(Type,state){return Object.assign(Object.create(Type.prototype),cloneState(state));}
