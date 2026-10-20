import { NOTES, musicMapping } from './simulation.js';

export function fieldSoundKey(sim,sound,regions){
  return JSON.stringify([sound.mode,sound.waveform,sound.speed,sim.direction,sim.width,sim.height,sim.fields.map(f=>[f.type,f.x,f.y,f.amplitude,f.frequency,f.revisionTime]),regions]);
}
export class SoundEngine {
  constructor() { this.context=null;this.muted=false;this.volume=.25;this.mode='cluster';this.running=false;this.waveform='original';this.speed=1; }
  start(){
    if(!this.starting)this.starting=this.initialize().catch(error=>{this.context?.close();this.context=null;throw error;}).finally(()=>{this.starting=null;});
    return this.starting;
  }
  async initialize() {
    if (!this.context) {
      const AudioContext=window.AudioContext || window.webkitAudioContext;
      if(!AudioContext) throw new Error('此浏览器不支持 Web Audio');
      const ctx=this.context=new AudioContext();
      this.master=ctx.createGain();this.master.gain.value=0;
      this.limiter=ctx.createDynamicsCompressor();this.limiter.threshold.value=-3;this.limiter.knee.value=3;this.limiter.ratio.value=12;this.limiter.attack.value=.003;this.limiter.release.value=.15;
      this.master.connect(this.limiter).connect(ctx.destination);
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
      await Promise.all([ctx.audioWorklet.addModule(new URL('./continuous-worklet.js',import.meta.url)),ctx.audioWorklet.addModule(new URL('./effects-worklet.js',import.meta.url))]);
      this.continuous=new AudioWorkletNode(ctx,'continuous-field',{numberOfInputs:0,numberOfOutputs:17,outputChannelCount:Array(17).fill(1)});
      this.continuousSlots=new Set();this.averageGain=ctx.createGain();this.averageGain.gain.value=0;
      this.continuous.connect(this.averageGain,0);this.averageGain.connect(this.live);
      this.setWaveform(this.waveform);
    }
    await this.context.resume();
  }
  setWaveform(type) {
    if(!['original','sine','triangle','sawtooth','square'].includes(type))return;
    this.waveform=type;if(!this.context)return;
    for(const voice of this.voices){if(!voice)continue;if(type==='original')voice.oscillator.setPeriodicWave(this.originalWave);else voice.oscillator.type=type;}
    this.invalidateContinuous();
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
      connect:target=>{destination=target;this.continuous.connect(target,slot);return target;},
      start:(when,offset)=>this.continuous.port.postMessage({type:'add',when,slot,waveform:waveform==='original'&&map.mode==='average'?'sine':waveform,profile:{...continuation,frequencies,weights:map.weights,pitchRate:map.pitchRate,mode:map.mode,duration,offset},adopt:this.mode==='average'&&this.liveKey===liveKey}),
      edit:settings=>this.continuous.port.postMessage({type:'edit',slot,settings}),
      setRate:(rate,preservePitch=true)=>this.continuous.port.postMessage({type:'rate',slot,rate,preservePitch}),
      stop:()=>{this.continuous.port.postMessage({type:'remove',slot});this.continuousSlots.delete(slot);},
      disconnect:()=>{if(destination)this.continuous.disconnect(destination,slot);}
    };
  }
  smooth(param,value,time,constant=.025) { param.cancelScheduledValues(time);param.setTargetAtTime(value,time,constant); }
  update(distribution) {
    if(!this.context||!this.continuous) return;
    const now=this.context.currentTime, mapping=musicMapping(distribution);
    this.smooth(this.master.gain,!this.muted?this.volume:0,now);
    this.smooth(this.live.gain,this.running?1:0,now);
    this.voices.forEach((voice,i)=>{if(voice){this.smooth(voice.oscillator.frequency,NOTES[i]*this.speed,now,.025/this.speed);this.smooth(voice.gain.gain,this.mode==='cluster'?mapping.weights[i]*12000/32768:0,now,.025/this.speed);}});
    this.continuous.port.postMessage({type:'live',hz:mapping.hertz*this.speed,speed:this.speed,running:this.running,waveform:this.waveform==='original'?'sine':this.waveform});
    this.smooth(this.averageGain.gain,this.mode==='average'&&mapping.hertz>0?10000/32768:0,now);
  }
}
