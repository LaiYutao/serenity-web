import { NOTES, musicMapping } from './simulation.js';

export class SoundEngine {
  constructor() { this.context=null;this.muted=false;this.volume=.25;this.mode='cluster';this.running=false; }
  async start() {
    if (!this.context) {
      const AudioContext=window.AudioContext || window.webkitAudioContext;
      if(!AudioContext) throw new Error('此浏览器不支持 Web Audio');
      const ctx=this.context=new AudioContext();
      this.master=ctx.createGain();this.master.gain.value=0;this.master.connect(ctx.destination);
      // Match the original fundamental + four partials. Oscillators run on
      // the browser audio thread independently of the visual frame rate.
      const wave=ctx.createPeriodicWave(new Float32Array(6),new Float32Array([0,1,.1,.056,.042,.037]),{disableNormalization:true});
      this.voices=NOTES.map(hz=>{
        if(!hz) return null;
        const oscillator=ctx.createOscillator(), gain=ctx.createGain();
        oscillator.setPeriodicWave(wave);oscillator.frequency.value=hz;gain.gain.value=0;
        oscillator.connect(gain).connect(this.master);oscillator.start();return {oscillator,gain};
      });
      this.average=ctx.createOscillator();this.averageGain=ctx.createGain();
      this.average.frequency.value=0;this.averageGain.gain.value=0;
      this.average.connect(this.averageGain).connect(this.master);this.average.start();
    }
    await this.context.resume();
  }
  smooth(param,value,time,constant=.025) { param.cancelScheduledValues(time);param.setTargetAtTime(value,time,constant); }
  update(distribution) {
    if(!this.context) return;
    const now=this.context.currentTime, mapping=musicMapping(distribution);
    this.smooth(this.master.gain,this.running&&!this.muted?this.volume:0,now);
    this.voices.forEach((voice,i)=>{if(voice)this.smooth(voice.gain.gain,this.mode==='cluster'?mapping.weights[i]*12000/32768:0,now);});
    this.smooth(this.average.frequency,mapping.hertz,now);
    this.smooth(this.averageGain.gain,this.mode==='average'&&mapping.hertz>0?10000/32768:0,now);
  }
}
