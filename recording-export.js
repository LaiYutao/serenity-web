import { joinChunks } from './recording.js';
import { loopGain } from './loops.js';

export const MAX_EXPORT_SECONDS=600;

export async function loadExportModule(sound){
  sound.exportModule??=sound.context.audioWorklet.addModule(new URL('./recording-export-worklet.js',import.meta.url)).catch(error=>{sound.exportModule=null;throw error;});
  await sound.exportModule;
}

// PCM frame counts keep the cycle calculation honest, including rendered speed changes.
export function planCycleExport(tracks,anchorId,sampleRate,now=0){
  const audible=tracks.filter(track=>loopGain(track,tracks)>0);
  if(!audible.length)throw new Error('exportNoTracks');
  if(audible.some(track=>track.worker))throw new Error('exportTrackBusy');
  const anchor=audible.find(track=>track.id===anchorId)??audible[0];
  const gcd=(a,b)=>{while(b){[a,b]=[b,a%b];}return a;};
  let frames=1n,truncated=false;
  const limit=BigInt(Math.floor(MAX_EXPORT_SECONDS*sampleRate));
  for(const track of audible){
    const length=BigInt(track.buffer.length??Math.round(track.buffer.duration*sampleRate));
    if(length<=0n)throw new Error('exportNoTracks');
    frames=frames/gcd(frames,length)*length;
    if(frames>limit){frames=limit;truncated=true;break;}
  }
  const duration=Number(frames)/sampleRate,period=anchor.buffer.duration;
  const earliest=now+.15;
  const cycle=Math.ceil((earliest-anchor.startedAt)/period);
  return {anchorId:anchor.id,when:anchor.startedAt+cycle*period,duration,frames:Number(frames),truncated,trackIds:audible.map(track=>track.id)};
}

export function encodeWav(samples,sampleRate){
  const bytes=new ArrayBuffer(44+samples.length*2),view=new DataView(bytes);
  const label=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  label(0,'RIFF');view.setUint32(4,36+samples.length*2,true);label(8,'WAVE');label(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
  label(36,'data');view.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++){
    const value=Number.isFinite(samples[i])?Math.max(-1,Math.min(1,samples[i])):0;
    view.setInt16(44+i*2,Math.round(value*(value<0?32768:32767)),true);
  }
  return bytes;
}

export class MixCapture{
  constructor(sound){this.sound=sound;this.chunks=[];this.active=false;}
  async start({input,when,duration}={}){
    await this.sound.start();const ctx=this.sound.context;
    await loadExportModule(this.sound);
    this.input=input??this.sound.limiter;
    this.startedAt=Math.max(ctx.currentTime,when??ctx.currentTime);
    const frames=duration===undefined?Math.floor(MAX_EXPORT_SECONDS*ctx.sampleRate):Math.round(duration*ctx.sampleRate);
    if(frames<1)throw new Error('exportEmpty');
    this.node=new AudioWorkletNode(ctx,'mix-export-recorder',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],channelCount:1,channelCountMode:'explicit'});
    this.silent=ctx.createGain();this.silent.gain.value=0;
    this.node.connect(this.silent).connect(ctx.destination);this.input.connect(this.node);this.active=true;
    this.done=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});
    this.done.catch(()=>{});
    // A processor failure must restore the UI as well as disconnect the capture branch.
    this.node.onprocessorerror=()=>{
      if(!this.active)return;
      this.cleanup();const error=new Error('exportFailed');this.rejectStart?.(error);this.reject(error);
    };
    await new Promise((resolve,reject)=>{
      this.rejectStart=reject;
      this.node.port.onmessage=({data})=>{
        if(data.type==='armed')resolve();
        else if(data.type==='chunk')this.chunks.push(data.samples);
        else if(data.type==='done'){
          this.cleanup();const samples=joinChunks(this.chunks);this.chunks=[];
          this.resolve({samples,sampleRate:ctx.sampleRate});
        }
      };
      this.node.port.postMessage({type:'start',when:this.startedAt,frames});
    });
  }
  stop(){if(this.active)this.node.port.postMessage({type:'stop'});return this.done;}
  cleanup(){
    if(!this.active)return;
    this.active=false;this.input.disconnect(this.node);this.node.disconnect();this.silent.disconnect();this.node.port.close();
  }
}

// Resample one track after its effects, with its own volume/mute, before the mix.
// Other tracks' Solo settings and the master/live buses cannot enter this branch.
export class TrackCapture extends MixCapture{
  constructor(sound,track){super(sound);this.track=track;}
  async start(){
    await this.sound.start();
    const ctx=this.sound.context;this.tap=ctx.createGain();this.track.recordCapture=this;
    this.syncGain(ctx.currentTime,true);this.track.effects.output.connect(this.tap);
    try{await super.start({input:this.tap});}
    catch(error){this.release();throw error;}
  }
  syncGain(now=this.sound.context.currentTime,immediate=false){
    if(!this.tap)return;
    const value=this.track.muted?0:this.track.volume;
    this.tap.gain.cancelScheduledValues(now);
    if(immediate)this.tap.gain.value=value;else this.tap.gain.setTargetAtTime(value,now,.015);
  }
  release(){
    if(!this.tap)return;
    this.track.effects.output.disconnect(this.tap);this.tap.disconnect();this.tap=null;
    if(this.track.recordCapture===this)delete this.track.recordCapture;
  }
  cleanup(){super.cleanup();this.release();}
}
