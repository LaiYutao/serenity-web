import { TrackEffects } from './effects.js';
import { createFXState } from './effects-dsp.js';
import { LiveRecording } from './recording.js';
import { processCycle } from './cycle-dsp.js';
import { initializeTrackTempo, trackTempo, selectedTrackSpeed } from './track-tempo.js';
import { audioBuffer, bufferChannels, monoMix } from './stereo.js';
import { advanceTrackState } from './track-state.js';
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
  return track.paused || track.muted || (tracks.some(item=>item.solo)&&!track.solo) ? 0 : track.volume;
}
export function trackPosition(track,now){
  const duration=track.buffer.duration;
  return track.paused?track.pausePosition??0:((Math.max(now,track.scheduledAt??-Infinity)-track.startedAt)%duration+duration)%duration;
}
export function formatTime(seconds) {
  const whole=Math.max(0,Math.floor(seconds));
  return `${String(Math.floor(whole/60)).padStart(2,'0')}:${String(whole%60).padStart(2,'0')}`;
}
export class LoopRecorder {
  constructor(sound,{effectsFactory=(ctx,duration,origin)=>new TrackEffects(ctx,duration,origin)}={}){this.effectsFactory=effectsFactory;this.sound=sound;this.recording=false;this.tracks=[];this.nextId=1;this.onchange=()=>{};}
  async capture(snapshot,elapsed=null,fieldScene=null){
    if(this.recording)return;
    if(this.tracks.length>=16)throw new Error('recordLimit');
    await this.sound.start();const capturedAt=this.sound.context.currentTime,waveform=this.sound.waveform,mode=this.sound.mode,liveKey=this.sound.liveKey;this.recording=true;this.onchange();
    try{
      const result=await new Promise((resolve,reject)=>{
        const worker=new Worker(new URL('./cycle-worker.js',import.meta.url),{type:'module'});
        worker.onmessage=({data})=>{worker.terminate();data.error?reject(new Error(data.error)):resolve(data);};
        worker.onerror=error=>{worker.terminate();reject(error);};
        worker.postMessage({snapshot,mode,waveform,sampleRate:this.sound.context.sampleRate});
      });
      const ctx=this.sound.context,buffer=audioBuffer(ctx,result.samples,result.channels);
      const continuous=!!result.pitchMap&&!!this.sound.createContinuousLoop;
      const source=continuous?this.sound.createContinuousLoop(result.pitchMap,buffer.duration,waveform,liveKey):(this.sound.createBufferLoop?.(buffer)??ctx.createBufferSource()),gain=this.sound.createTrackGain?.()??ctx.createGain(),playbackGain=ctx.createGain();
      if(!continuous){source.buffer=buffer;source.loop=true;}source.connect(playbackGain);
      const track={id:this.nextId++,buffer,original:result.samples,settings:{start:0,end:0,lowPitch:0,highPitch:127},speed:1,appliedSpeed:1,speedMode:'stretch',appliedMode:'stretch',baseDuration:buffer.duration,waveform,pitchKey:'0:127@1:stretch',pitchSamples:result.samples,source,gain,playbackGain,continuous,volume:1,muted:false,solo:false,startedAt:ctx.currentTime,peaks:envelope(result.samples),pitchMap:result.pitchMap,pitchCorrection:result.pitchCorrection};
      track.fieldScene=fieldScene;track.originalChannels=result.channels;track.pitchChannels=result.channels;
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
      const result=await this.inputRecorder.stop();
      await this.addRecording(result.samples??result,result.channels);
    }finally{this.recording=false;this.finishing=false;this.inputRecorder=null;this.onchange();}
  }
  async addRecording(samples,channels){
    if(this.tracks.length>=16)throw new Error('recordLimit');
    if(samples.length<this.sound.context.sampleRate*.5)throw new Error('recordEmpty');
    const pitchMap=await new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./recording-worker.js',import.meta.url),{type:'module'});
      worker.onmessage=({data})=>{worker.terminate();data.error?reject(new Error(data.error)):resolve(data.pitchMap);};
      worker.onerror=error=>{worker.terminate();reject(error);};
      worker.postMessage({type:'analyse',samples,sampleRate:this.sound.context.sampleRate});
    });
    const ctx=this.sound.context,buffer=audioBuffer(ctx,samples,channels);
    const source=this.sound.createBufferLoop?.(buffer)??ctx.createBufferSource(),gain=this.sound.createTrackGain?.()??ctx.createGain(),playbackGain=ctx.createGain();
    source.buffer=buffer;source.loop=true;source.connect(playbackGain);
    const track={id:this.nextId++,buffer,original:samples,settings:{start:0,end:0,lowPitch:0,highPitch:127},speed:1,appliedSpeed:1,speedMode:'stretch',appliedMode:'stretch',baseDuration:buffer.duration,waveform:'recording',pitchKey:'0:127@1:stretch',pitchSamples:samples,source,gain,playbackGain,continuous:false,volume:1,muted:false,solo:false,startedAt:ctx.currentTime,peaks:envelope(samples),pitchMap,pitchCorrection:0};
    track.originalChannels=channels;track.pitchChannels=channels;
    this.connectEffects(track);gain.gain.value=0;this.tracks.push(track);this.mix();track.startedAt=ctx.currentTime;track.effects.setOrigin(track.startedAt);source.start(track.startedAt,0);
    return track;
  }
  restoreProjectTrack(saved){
    const ctx=this.sound.context,buffer=audioBuffer(ctx,saved.samples,saved.channels);
    const source=saved.continuous?this.sound.createContinuousLoop(saved.pitchMap,saved.baseDuration,saved.waveform):this.sound.createBufferLoop(buffer);
    const gain=this.sound.createTrackGain(),playbackGain=ctx.createGain();source.connect(playbackGain);
    const track={...saved,id:this.nextId++,buffer,source,gain,playbackGain,
      appliedSpeed:saved.speed,appliedMode:saved.speedMode,startedAt:ctx.currentTime-saved.position,
      peaks:envelope(saved.samples),projectVoice:saved.voice};
    track.paused=!!saved.paused;track.pausePosition=saved.position;
    initializeTrackTempo(track);track.appliedNormalSpeed=track.normalSpeed;track.appliedStretchSpeed=track.stretchSpeed;
    delete track.samples;delete track.channels;delete track.voice;delete track.position;
    this.connectEffects(track);track.fx={...createFXState(),...saved.fx};track.effects.setState(track.fx);
    this.tracks.push(track);
    if(track.continuous)source.restore(saved.voice);else source.start(ctx.currentTime,saved.position);
    if(track.paused){source.setPaused(true,ctx.currentTime);track.effects.setPaused(true,ctx.currentTime);}
    return track;
  }
  async duplicate(track){
    if(this.copying||this.recording||track.worker||!this.tracks.includes(track))throw new Error('exportTrackBusy');
    if(this.tracks.length>=16)throw new Error('recordLimit');
    this.copying=true;this.onchange();
    try{
      await this.sound.start();
      const ctx=this.sound.context,rate=ctx.sampleRate,frame=Math.ceil((ctx.currentTime+.08)*rate/128)*128;
      const [source,effects,gain]=await Promise.all([
        track.continuous?this.sound.snapshotContinuous([track.source.slot],frame):track.source.snapshot(frame),track.effects.snapshot(frame),track.gain.snapshot(frame)
      ]);
      if([source,effects,gain].some(value=>value.frame!==frame))throw new Error('exportSnapshotMismatch');
      const channels=bufferChannels(track.buffer),kind=track.continuous?(track.pitchMap.mode==='cluster'?'cluster':'tone'):'buffer';
      let state={frame,kind,voice:track.continuous?source.tracks.find(v=>v.slot===track.source.slot).state:{...source.state,samples:channels?monoMix(channels):track.buffer.getChannelData(0).slice(),channels},effects:effects.state,gain:gain.state};
      const copy={...track,id:this.nextId++,settings:{...track.settings},fx:structuredClone(track.fx),fieldScene:structuredClone(track.fieldScene),pitchMap:structuredClone(track.pitchMap),
        worker:null,editRevision:0,recordCapture:undefined,display:null,canvas:null,mapCanvas:null,mapBuffer:null,paused:!!track.paused};
      let when;
      for(let attempt=0;attempt<3;attempt++){
        const target=Math.ceil((ctx.currentTime+.3)*rate/128)*128;
        state=advanceTrackState(state,target,rate);when=target/rate;
        if(ctx.currentTime<when-.08)break;
        if(attempt===2)throw new Error('exportSnapshotTimeout');
      }
      const position=track.continuous?state.voice.profile.position/state.voice.rate:((state.voice.position/rate)%track.buffer.duration+track.buffer.duration)%track.buffer.duration;
      copy.startedAt=when-position;copy.scheduledAt=when;copy.pausePosition=position;
      copy.source=track.continuous?this.sound.createContinuousLoop(copy.pitchMap,copy.baseDuration,copy.waveform):this.sound.createBufferLoop(copy.buffer);
      copy.gain=this.sound.createTrackGain();copy.playbackGain=ctx.createGain();copy.source.connect(copy.playbackGain);
      this.connectEffects(copy);copy.fx=structuredClone(track.fx);copy.effects.restore(state.effects,when);copy.gain.restore(state.gain,when);copy.source.restore(state.voice,when);
      this.tracks.splice(this.tracks.indexOf(track)+1,0,copy);this.mix();return copy;
    }finally{this.copying=false;this.onchange();}
  }
  setPaused(track,paused){
    if(this.copying||!this.tracks.includes(track)||!!track.paused===paused)return;
    const ctx=this.sound.context,when=Math.ceil((ctx.currentTime+.03)*ctx.sampleRate/128)*128/ctx.sampleRate;
    if(paused)track.pausePosition=trackPosition(track,when);
    else track.startedAt=when-(track.pausePosition??0);
    track.paused=paused;track.scheduledAt=when;
    track.source.setPaused(paused,when);track.effects.setPaused(paused,when);this.mix();this.onchange();
  }
  connectEffects(track){
    initializeTrackTempo(track);
    track.appliedNormalSpeed??=track.normalSpeed;track.appliedStretchSpeed??=track.stretchSpeed;
    track.fx=createFXState();track.effects=this.effectsFactory(this.sound.context,track.buffer.duration,track.startedAt);
    track.playbackGain.connect(track.effects.input);track.effects.output.connect(track.gain);
    if(this.sound.connectTrack)track.mixSlot=this.sound.connectTrack(track.gain);else track.gain.connect(this.sound.tracksBus??this.sound.master);
  }
  setEffects(track,group,values){Object.assign(track.fx[group],values);track.effects.setState(track.fx);}
  resetEffects(track){track.fx=createFXState();track.effects.setState(track.fx);track.effects.reset();}
  setSpeed(track,value){
    initializeTrackTempo(track);
    const next=Math.round(Math.max(.25,Math.min(4,Number(value)||1))*100)/100;
    if(next===selectedTrackSpeed(track))return;
    track[track.speedMode==='normal'?'normalSpeed':'stretchSpeed']=next;
    track.speed=track.normalSpeed*track.stretchSpeed;
    this.edit(track,{});
  }
  setSpeedMode(track,mode){initializeTrackTempo(track);track.speedMode=mode==='normal'?'normal':'stretch';this.onchange();}
  edit(track,settings){
    Object.assign(track.settings,settings);
    if(track.continuous)track.source.edit({...track.settings});
    this.onchange();
    const revision=track.editRevision=(track.editRevision||0)+1;
    track.worker?.terminate();track.worker=null;
    const {lowPitch,highPitch}=track.settings,{normal,stretch,rate:speed}=trackTempo(track),key=`${lowPitch}:${highPitch}@${normal}:${stretch}`;
    const apply=(samples,channels)=>{
      if(track.editRevision!==revision||!this.tracks.includes(track))return;
      track.pitchSamples=samples;track.pitchChannels=channels;track.pitchKey=key;
      this.swap(track,processCycle(samples,{start:track.settings.start,end:track.settings.end}),speed,normal,channels?.map(c=>processCycle(c,{start:track.settings.start,end:track.settings.end,low:-Infinity,high:Infinity})));
    };
    if(key===track.pitchKey){apply(track.pitchSamples,track.pitchChannels);return;}
    if(lowPitch===0&&highPitch===127&&speed===1&&normal===1){apply(track.original,track.originalChannels);return;}
    const worker=track.worker=new Worker(new URL('./tempo-worker.js',import.meta.url),{type:'module'});
    worker.onmessage=({data})=>{worker.terminate();if(track.worker===worker)track.worker=null;if(data.error)this.onerror?.('recordUnavailable');else apply(data.samples,data.channels);};
    worker.onerror=()=>{worker.terminate();if(track.worker===worker)track.worker=null;this.onerror?.('recordUnavailable');};
    worker.postMessage({samples:track.waveform==='recording'?track.original:undefined,channels:track.waveform==='recording'?track.originalChannels:undefined,pitchMap:track.pitchMap,duration:track.baseDuration??track.original.length/this.sound.context.sampleRate,normalSpeed:normal,stretchSpeed:stretch,waveform:track.waveform,sampleRate:this.sound.context.sampleRate,lowPitch,highPitch});
  }
  swap(track,samples,speed=track.appliedSpeed??1,normal=track.appliedNormalSpeed??(track.appliedMode==='normal'?track.appliedSpeed??1:1),channels){
    const ctx=this.sound.context;
    const buffer=audioBuffer(ctx,samples,channels);
    if(track.continuous){
      const now=ctx.currentTime,position=trackPosition(track,now)/track.buffer.duration;
      track.startedAt=now-position*buffer.duration;if(track.paused)track.pausePosition=position*buffer.duration;track.source.setRate((track.baseDuration??track.original.length/ctx.sampleRate)/buffer.duration,true,normal);track.appliedSpeed=speed;track.appliedNormalSpeed=normal;track.appliedStretchSpeed=speed/normal;
      track.buffer=buffer;track.effects.setDuration?.(buffer.duration);track.effects.setOrigin(track.startedAt);track.peaks=envelope(samples);this.onchange();return;
    }
    const next=this.sound.createBufferLoop?.(buffer)??ctx.createBufferSource(),fade=ctx.createGain();next.buffer=buffer;next.loop=true;next.connect(fade).connect(track.effects.input);
    const when=ctx.currentTime+.01,position=trackPosition(track,when)/track.buffer.duration,offset=position*buffer.duration;
    fade.gain.setValueAtTime(0,when);fade.gain.linearRampToValueAtTime(1,when+.01);next.start(when,offset);if(track.paused){next.setPaused(true,when);track.pausePosition=offset;}
    const previous=track.source,previousGain=track.playbackGain;previousGain.gain.cancelScheduledValues(when);previousGain.gain.setValueAtTime(previousGain.gain.value,when);previousGain.gain.linearRampToValueAtTime(0,when+.01);previous.stop(when+.012);previous.onended=()=>{previous.disconnect();previousGain.disconnect();};
    track.startedAt=when-offset;track.appliedSpeed=speed;track.appliedNormalSpeed=normal;track.appliedStretchSpeed=speed/normal;track.effects.setDuration?.(buffer.duration);track.effects.setOrigin(track.startedAt,when);track.source=next;track.playbackGain=fade;track.buffer=buffer;track.peaks=envelope(samples);this.onchange();
  }
  mix(){const now=this.sound.context.currentTime;for(const track of this.tracks){track.gain.gain.cancelScheduledValues(now);track.gain.gain.setTargetAtTime(loopGain(track,this.tracks),now,.015);track.recordCapture?.syncGain(now);}}
  remove(id){const index=this.tracks.findIndex(track=>track.id===id);if(index<0||this.tracks[index].recordCapture)return;const [track]=this.tracks.splice(index,1);track.worker?.terminate();track.source.stop();track.source.disconnect();track.playbackGain.disconnect();track.effects.destroy();if(track.gain.destroy)track.gain.destroy();else track.gain.disconnect();this.sound.releaseTrack?.(track.mixSlot);this.mix();this.onchange();}
}

export function paginateTracks(tracks,page=0){
  const pages=Math.max(1,Math.ceil(tracks.length/3));
  const current=Math.max(0,Math.min(pages-1,page));
  return {page:current,pages,tracks:tracks.slice(current*3,current*3+3)};
}
