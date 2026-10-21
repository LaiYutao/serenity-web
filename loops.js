import { TrackEffects } from './effects.js';
import { createFXState } from './effects-dsp.js';
import { LiveRecording } from './recording.js';
import { processCycle } from './cycle-dsp.js';
export function envelope(samples, bins=180) {
  const result=new Float32Array(bins);
  for(let i=0;i<bins;i++){
    const start=Math.floor(i*samples.length/bins),end=Math.floor((i+1)*samples.length/bins);
    let energy=0;for(let j=start;j<end;j++)energy+=samples[j]*samples[j];
    result[i]=Math.sqrt(energy/Math.max(1,end-start));
  }
  const max=Math.max(.001,...result);
  return result.map(value=>Math.sqrt(value/max));
}
export function loopGain(track, tracks) {
  return track.muted || (tracks.some(item=>item.solo)&&!track.solo) ? 0 : track.volume;
}
export function formatTime(seconds) {
  const whole=Math.max(0,Math.floor(seconds));
  return `${String(Math.floor(whole/60)).padStart(2,'0')}:${String(whole%60).padStart(2,'0')}`;
}
export class LoopRecorder {
  constructor(sound,{effectsFactory=(ctx,duration,origin)=>new TrackEffects(ctx,duration,origin)}={}){this.effectsFactory=effectsFactory;this.sound=sound;this.recording=false;this.tracks=[];this.nextId=1;this.onchange=()=>{};}
  async capture(snapshot,elapsed=null){
    if(this.recording)return;
    if(this.tracks.length>=16)throw new Error('recordLimit');
    await this.sound.start();const capturedAt=this.sound.context.currentTime,waveform=this.sound.waveform,liveKey=this.sound.liveKey;this.recording=true;this.onchange();
    try{
      const result=await new Promise((resolve,reject)=>{
        const worker=new Worker(new URL('./cycle-worker.js',import.meta.url),{type:'module'});
        worker.onmessage=({data})=>{worker.terminate();data.error?reject(new Error(data.error)):resolve(data);};
        worker.onerror=error=>{worker.terminate();reject(error);};
        worker.postMessage({snapshot,mode:this.sound.mode,waveform,sampleRate:this.sound.context.sampleRate});
      });
      const ctx=this.sound.context,buffer=ctx.createBuffer(1,result.samples.length,ctx.sampleRate);
      buffer.copyToChannel(result.samples,0);
      const continuous=!!result.pitchMap&&!!this.sound.createContinuousLoop;
      const source=continuous?this.sound.createContinuousLoop(result.pitchMap,buffer.duration,waveform,liveKey):ctx.createBufferSource(),gain=ctx.createGain(),playbackGain=ctx.createGain();
      if(!continuous){source.buffer=buffer;source.loop=true;}source.connect(playbackGain);
      const track={id:this.nextId++,buffer,original:result.samples,settings:{start:0,end:0,lowPitch:0,highPitch:127},speed:1,appliedSpeed:1,speedMode:'stretch',appliedMode:'stretch',baseDuration:buffer.duration,waveform,pitchKey:'0:127@1:stretch',pitchSamples:result.samples,source,gain,playbackGain,continuous,volume:1,muted:false,solo:false,startedAt:ctx.currentTime,peaks:envelope(result.samples),pitchMap:result.pitchMap,pitchCorrection:result.pitchCorrection};
      this.connectEffects(track);gain.gain.value=0;this.tracks.push(track);this.mix();
      // Align to the field clock after synthesis and buffer preparation have finished.
      const when=ctx.currentTime,advanced=elapsed?elapsed():when-capturedAt;
      const offset=((advanced%buffer.duration)+buffer.duration)%buffer.duration;
      track.startedAt=when-offset;track.effects.setOrigin(track.startedAt);
      source.start(when,offset);
    }finally{this.recording=false;this.onchange();}
  }
  async startDirect(){
    if(this.recording)return;
    if(this.tracks.length>=16)throw new Error('recordLimit');
    this.recording=true;this.inputRecorder=new LiveRecording(this.sound);this.onchange();
    try{await this.inputRecorder.start();this.directRecording=true;this.onchange();}
    catch(error){this.recording=false;this.inputRecorder=null;this.onchange();throw error;}
  }
  async stopDirect(){
    if(!this.directRecording)return;
    this.directRecording=false;this.finishing=true;this.onchange();
    try{
      const samples=await this.inputRecorder.stop();
      const pitchMap=await new Promise((resolve,reject)=>{
        const worker=new Worker(new URL('./recording-worker.js',import.meta.url),{type:'module'});
        worker.onmessage=({data})=>{worker.terminate();data.error?reject(new Error(data.error)):resolve(data.pitchMap);};
        worker.onerror=error=>{worker.terminate();reject(error);};
        worker.postMessage({type:'analyse',samples,sampleRate:this.sound.context.sampleRate});
      });
      const ctx=this.sound.context,buffer=ctx.createBuffer(1,samples.length,ctx.sampleRate);buffer.copyToChannel(samples,0);
      const source=ctx.createBufferSource(),gain=ctx.createGain(),playbackGain=ctx.createGain();
      source.buffer=buffer;source.loop=true;source.connect(playbackGain);
      const track={id:this.nextId++,buffer,original:samples,settings:{start:0,end:0,lowPitch:0,highPitch:127},speed:1,appliedSpeed:1,speedMode:'stretch',appliedMode:'stretch',baseDuration:buffer.duration,waveform:'recording',pitchKey:'0:127@1:stretch',pitchSamples:samples,source,gain,playbackGain,continuous:false,volume:1,muted:false,solo:false,startedAt:ctx.currentTime,peaks:envelope(samples),pitchMap,pitchCorrection:0};
      this.connectEffects(track);gain.gain.value=0;this.tracks.push(track);this.mix();track.startedAt=ctx.currentTime;track.effects.setOrigin(track.startedAt);source.start(track.startedAt,0);
    }finally{this.recording=false;this.finishing=false;this.inputRecorder=null;this.onchange();}
  }
  connectEffects(track){
    track.fx=createFXState();track.effects=this.effectsFactory(this.sound.context,track.buffer.duration,track.startedAt);
    track.playbackGain.connect(track.effects.input);track.effects.output.connect(track.gain);track.gain.connect(this.sound.tracksBus??this.sound.master);
  }
  setEffects(track,group,values){Object.assign(track.fx[group],values);track.effects.setState(track.fx);}
  resetEffects(track){track.fx=createFXState();track.effects.setState(track.fx);track.effects.reset();}
  setSpeed(track,value){
    track.speed=Math.round(Math.max(.25,Math.min(4,Number(value)||1))*100)/100;
    this.edit(track,{});
  }
  setSpeedMode(track,mode){track.speedMode=mode==='normal'?'normal':'stretch';this.edit(track,{});}
  edit(track,settings){
    Object.assign(track.settings,settings);
    if(track.continuous)track.source.edit({...track.settings});
    this.onchange();
    const revision=track.editRevision=(track.editRevision||0)+1;
    track.worker?.terminate();track.worker=null;
    const {lowPitch,highPitch}=track.settings,speed=track.speed??1,speedMode=track.speedMode??'stretch',key=`${lowPitch}:${highPitch}@${speed}:${speedMode}`;
    const apply=samples=>{
      if(track.editRevision!==revision||!this.tracks.includes(track))return;
      track.pitchSamples=samples;track.pitchKey=key;
      this.swap(track,processCycle(samples,{start:track.settings.start,end:track.settings.end}),speed,speedMode);
    };
    if(key===track.pitchKey){apply(track.pitchSamples);return;}
    if(lowPitch===0&&highPitch===127&&speed===1){apply(track.original);return;}
    const worker=track.worker=new Worker(new URL('./tempo-worker.js',import.meta.url),{type:'module'});
    worker.onmessage=({data})=>{worker.terminate();if(track.worker===worker)track.worker=null;if(data.error)this.onerror?.('recordUnavailable');else apply(data.samples);};
    worker.onerror=()=>{worker.terminate();if(track.worker===worker)track.worker=null;this.onerror?.('recordUnavailable');};
    worker.postMessage({samples:track.waveform==='recording'?track.original:undefined,pitchMap:track.pitchMap,duration:track.baseDuration??track.original.length/this.sound.context.sampleRate,speed,speedMode,waveform:track.waveform,sampleRate:this.sound.context.sampleRate,lowPitch,highPitch});
  }
  swap(track,samples,speed=track.appliedSpeed??1,speedMode=track.appliedMode??'stretch'){
    const ctx=this.sound.context;
    const buffer=ctx.createBuffer(1,samples.length,ctx.sampleRate);buffer.copyToChannel(samples,0);
    if(track.continuous){
      const now=ctx.currentTime,position=((now-track.startedAt)%track.buffer.duration+track.buffer.duration)%track.buffer.duration/track.buffer.duration;
      track.startedAt=now-position*buffer.duration;track.source.setRate((track.baseDuration??track.original.length/ctx.sampleRate)/buffer.duration,speedMode!=='normal');track.appliedSpeed=speed;track.appliedMode=speedMode;
      track.buffer=buffer;track.effects.setDuration?.(buffer.duration);track.effects.setOrigin(track.startedAt);track.peaks=envelope(samples);this.onchange();return;
    }
    const next=ctx.createBufferSource(),fade=ctx.createGain();next.buffer=buffer;next.loop=true;next.connect(fade).connect(track.effects.input);
    const when=ctx.currentTime+.01,position=((when-track.startedAt)%track.buffer.duration+track.buffer.duration)%track.buffer.duration/track.buffer.duration,offset=position*buffer.duration;
    fade.gain.setValueAtTime(0,when);fade.gain.linearRampToValueAtTime(1,when+.01);next.start(when,offset);
    const previous=track.source,previousGain=track.playbackGain;previousGain.gain.cancelScheduledValues(when);previousGain.gain.setValueAtTime(previousGain.gain.value,when);previousGain.gain.linearRampToValueAtTime(0,when+.01);previous.stop(when+.012);previous.onended=()=>{previous.disconnect();previousGain.disconnect();};
    track.startedAt=when-offset;track.appliedSpeed=speed;track.appliedMode=speedMode;track.effects.setDuration?.(buffer.duration);track.effects.setOrigin(track.startedAt);track.source=next;track.playbackGain=fade;track.buffer=buffer;track.peaks=envelope(samples);this.onchange();
  }
  mix(){const now=this.sound.context.currentTime;for(const track of this.tracks){track.gain.gain.cancelScheduledValues(now);track.gain.gain.setTargetAtTime(loopGain(track,this.tracks),now,.015);}}
  remove(id){const index=this.tracks.findIndex(track=>track.id===id);if(index<0)return;const [track]=this.tracks.splice(index,1);track.worker?.terminate();track.source.stop();track.source.disconnect();track.playbackGain.disconnect();track.effects.destroy();track.gain.disconnect();this.mix();this.onchange();}
}

export function paginateTracks(tracks,page=0){
  const pages=Math.max(1,Math.ceil(tracks.length/3));
  const current=Math.max(0,Math.min(pages-1,page));
  return {page:current,pages,tracks:tracks.slice(current*3,current*3+3)};
}
