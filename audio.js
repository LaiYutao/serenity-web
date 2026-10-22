import { isPluckedWaveform } from './pluck-dsp.js';
import { SampleClock, sampleInterval } from './sampling.js';
import { NOTES, musicMapping } from './simulation.js';
import { createGainNode, createBufferNode } from './stateful-audio.js';

export function fieldSoundKey(sim,sound,regions){
  return JSON.stringify([sound.mode,sound.waveform,sound.speed,sound.stepRate??1,sim.direction,sim.width,sim.height,sim.fields.map(f=>[f.type,f.x,f.y,f.amplitude,f.frequency,f.revisionTime]),regions]);
}
export class SoundEngine {
  constructor({sampleRate}={}) { this.sampleRate=sampleRate;this.context=null;this.voices=[];this.muted=false;this.volume=.25;this.mode='cluster';this.running=false;this.waveform='original';this.speed=1;this.samplingMode='normal';this.stepRate=1;this.sampleClock=new SampleClock(); }
  start(){
    if(!this.starting)this.starting=this.initialize().catch(error=>{this.context?.close();this.context=null;throw error;}).finally(()=>{this.starting=null;});
    return this.starting;
  }
  async initialize() {
    if (!this.context) {
      const AudioContext=window.AudioContext || window.webkitAudioContext;
      if(!AudioContext) throw new Error('此浏览器不支持 Web Audio');
      const ctx=this.context=new AudioContext(this.sampleRate?{sampleRate:this.sampleRate}:undefined);
      await Promise.all(['continuous-worklet.js','effects-worklet.js','stateful-worklet.js'].map(path=>ctx.audioWorklet.addModule(new URL(path,import.meta.url))));
      this.master=this.limiter=createGainNode(ctx,{master:true});this.master.connect(ctx.destination);
      this.tracksBus=new AudioWorkletNode(ctx,'stateful-track-mix',{numberOfInputs:16,numberOfOutputs:1,outputChannelCount:[1],channelCount:1,channelCountMode:'explicit'});
      this.mixSlots=new Set();this.tracksBus.connect(this.master);this.tracksBus.connect(this.master,0,1);
      this.tracksOutput={connect:node=>this.master.connect(node,1),disconnect:node=>this.master.disconnect(node,1)};
      this.live=ctx.createGain();this.live.gain.value=0;this.live.connect(this.master);
      // Match the original fundamental + four partials. Oscillators run on
      // the browser audio thread independently of the visual frame rate.
      const wave=this.originalWave=ctx.createPeriodicWave(new Float32Array(6),new Float32Array([0,1,.1,.056,.042,.037]),{disableNormalization:true});
      this.voices=NOTES.map(hz=>{
        if(!hz) return null;
        const oscillator=ctx.createOscillator(), gain=ctx.createGain();
        oscillator.setPeriodicWave(wave);oscillator.frequency.value=hz;gain.gain.value=0;
        oscillator.connect(gain).connect(this.live);oscillator.start();return {oscillator,gain};
      });
      this.continuous=new AudioWorkletNode(ctx,'continuous-field',{numberOfInputs:0,numberOfOutputs:17,outputChannelCount:Array(17).fill(1)});
      this.continuousSnapshots=new Map();this.continuousRequest=0;
      this.continuous.port.onmessage=({data})=>{
        if(data.type!=='snapshot')return;const request=this.continuousSnapshots.get(data.id);if(!request)return;
        clearTimeout(request.timer);this.continuousSnapshots.delete(data.id);request.resolve(data);
      };
      this.continuousSlots=new Set();this.averageGain=ctx.createGain();this.averageGain.gain.value=0;
      this.continuous.connect(this.averageGain,0);this.averageGain.connect(this.live);
      this.setWaveform(this.waveform);
    }
    await this.context.resume();
  }
  setWaveform(type) {
    if(type==='pluck')type='bubble';
    if(!['original','sine','triangle','sawtooth','square','pluck','bubble','electric'].includes(type))return;
    this.waveform=type;if(!this.context)return;
    for(const voice of this.voices){if(!voice)continue;if(type==='original')voice.oscillator.setPeriodicWave(this.originalWave);else if(!isPluckedWaveform(type))voice.oscillator.type=type;}
    this.sampleClock.reset();this.invalidateContinuous();
  }
  createTrackGain(){return createGainNode(this.context);}
  connectTrack(gain){const slot=Array.from({length:16},(_,i)=>i).find(i=>!this.mixSlots.has(i));if(slot===undefined)throw new Error('recordLimit');this.mixSlots.add(slot);gain.connect(this.tracksBus,0,slot);return slot;}
  releaseTrack(slot){this.mixSlots.delete(slot);}
  createBufferLoop(buffer){const node=createBufferNode(this.context);node.buffer=buffer;return node;}
  snapshotContinuous(slots,frame){
    return new Promise((resolve,reject)=>{
      const id=++this.continuousRequest,timer=setTimeout(()=>{this.continuousSnapshots.delete(id);reject(new Error('exportSnapshotTimeout'));},5000);
      this.continuousSnapshots.set(id,{resolve,reject,timer});this.continuous.port.postMessage({type:'snapshot',id,slots,frame});
    });
  }
  invalidateContinuous(){this.continuous?.port.postMessage({type:'invalidate'});}
  setLiveKey(key){if(this.liveKey!==key){this.liveKey=key;this.invalidateContinuous();}}
  createContinuousLoop(map,duration,waveform,liveKey){
    const slot=Array.from({length:16},(_,i)=>i+1).find(i=>!this.continuousSlots.has(i));
    if(!slot)throw new Error('recordLimit');
    this.continuousSlots.add(slot);let destination;
    const continuation=map.continuation;
    const frequencies=Float64Array.from(continuation?.frequencies??map.frequencies,hz=>hz*(map.pitchRate??1));
    return {
      slot,
      connect:target=>{destination=target;this.continuous.connect(target,slot);return target;},
      restore:state=>this.continuous.port.postMessage({type:'restore',slot,state}),
      start:(when,offset)=>this.continuous.port.postMessage({type:'add',when,slot,waveform:waveform==='original'&&map.mode==='average'?'sine':waveform,profile:{...continuation,frequencies,weights:map.weights,pitchRate:map.pitchRate,mode:map.mode,duration,offset,sampleInterval:map.sampleInterval??0,pluckInterval:map.pluckInterval??(map.sampleInterval||.1/(map.pitchRate??1))},adopt:this.mode==='average'&&this.liveKey===liveKey}),
      edit:settings=>this.continuous.port.postMessage({type:'edit',slot,settings}),
      setRate:(rate,preservePitch=true,pitchSpeed)=>this.continuous.port.postMessage({type:'rate',slot,rate,preservePitch,pitchSpeed}),
      stop:()=>{this.continuous.port.postMessage({type:'remove',slot});this.continuousSlots.delete(slot);},
      disconnect:()=>{if(destination)this.continuous.disconnect(destination,slot);}
    };
  }
  smooth(param,value,time,constant=.025) { param.cancelScheduledValues(time);param.setTargetAtTime(value,time,constant); }
  update(distribution) {
    if(!this.context||!this.continuous) return;
    const now=this.context.currentTime,read=()=>musicMapping(typeof distribution==='function'?distribution():distribution);
    const mapping=this.sampleClock.sample(now,this.stepRate,read,this.speed);
    this.smooth(this.master.gain,!this.muted?this.volume:0,now);
    this.smooth(this.live.gain,this.running?1:0,now);
    this.voices.forEach((voice,i)=>{if(voice){this.smooth(voice.oscillator.frequency,NOTES[i]*this.speed,now,.025/this.speed);this.smooth(voice.gain.gain,this.mode==='cluster'&&!isPluckedWaveform(this.waveform)?mapping.weights[i]*12000/32768:0,now,.025/this.speed);}});
    this.continuous.port.postMessage({type:'live',hz:mapping.hertz*this.speed,speed:this.speed,running:this.running,waveform:this.waveform==='original'?'sine':this.waveform,mode:this.mode,weights:Array.from(mapping.weights).filter((_,i)=>i!==6),pitchRate:this.speed,pluckInterval:sampleInterval(this.stepRate,this.speed)});
    this.smooth(this.averageGain.gain,(this.mode==='average'||isPluckedWaveform(this.waveform)&&this.mode==='cluster')&&mapping.hertz>0?10000/32768:0,now);
  }
}
