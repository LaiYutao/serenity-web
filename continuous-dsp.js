import { heldTime } from './sampling.js';
import { pluckState, pluckNext, isPluckedWaveform } from './pluck-dsp.js';
const TAU=2*Math.PI;
const wrap=(value,period)=>((value%period)+period)%period;
export function profileFrequency(profile,elapsed){
  const frequencies=profile.frequencies,offset=profile.lookupOffset??0,t=Math.max(0,heldTime(elapsed,profile.sampleInterval??0)+offset);
  const intro=profile.introFrames??0;
  let x,i,next;
  if(intro&&t<profile.introDuration){
    x=t/profile.introDuration*intro;i=Math.floor(x);next=i+1;
  }else{
    const loopDuration=profile.loopDuration??profile.duration;
    x=wrap(t-(profile.introDuration??0),loopDuration)/loopDuration*(frequencies.length-intro);
    i=intro+Math.floor(x);next=intro+(Math.floor(x)+1)%(frequencies.length-intro);
  }
  const fraction=x-Math.floor(x);
  return frequencies[i]*(1-fraction)+frequencies[next]*fraction;
}
export function toneWave(phase,type='sine'){
  if(type==='triangle')return 2/Math.PI*Math.asin(Math.sin(TAU*phase));
  if(type==='square')return phase<.5?1:-1;
  if(type==='sawtooth')return 2*phase-1;
  return Math.sin(TAU*phase);
}
// The field envelope repeats; the audible oscillator phase never resets at that boundary.
export class ContinuousTone{
  constructor(){this.rate=1;this.phase=0;this.frequency=0;this.target=0;this.speed=1;this.waveform='sine';this.profile=null;this.settings={start:0,end:0,lowPitch:0,highPitch:127};}
  install(profile,phase=this.phase){this.profile={...profile,elapsed:profile.offset,position:wrap(profile.offset,profile.duration)};this.phase=phase;}
  next(sampleRate,advance=true){
    let hz=this.frequency,position=0;
    if(this.profile){
      const p=this.profile;position=p.position/p.duration;
      hz=profileFrequency(p,p.elapsed)*(this.pitchSpeed??1);this.frequency=hz;
    }else if(advance){
      this.frequency+=(this.target-this.frequency)*(1-Math.exp(-this.speed/(sampleRate*.025)));hz=this.frequency;
    }
    const {start,end,lowPitch,highPitch}=this.settings;
    const masked=start<end?position>=start&&position<end:start>end&&(position>=start||position<end);
    const low=lowPitch===0?0:440*2**((lowPitch-69)/12),high=highPitch===127?Infinity:440*2**((highPitch-69)/12);
    let gain=masked||hz<=0||hz<low||hz>high?0:1;
    if(this.profile&&start!==end&&!masked){
      const distance=Math.min(wrap(start-position,1),wrap(position-end,1))*this.profile.duration/this.rate;
      gain*=Math.min(1,distance/.003);
    }
    const pluckInterval=this.profile?.pluckInterval??(this.profile?.sampleInterval||this.pluckInterval||.1/(this.profile?.pitchRate??this.speed));
    const pluckTick=Math.floor(((this.profile?.elapsed??this.pluckElapsed??0)+1e-9)/pluckInterval);
    const value=isPluckedWaveform(this.waveform)?pluckNext(this.pluck??=pluckState(),this.phase,hz,gain,sampleRate,advance,pluckTick,pluckInterval/(this.rate??1),this.waveform)*(gain===0?0:1):gain===0?0:toneWave(this.phase,this.waveform)*gain;
    if(advance){this.pluckElapsed=(this.pluckElapsed??0)+1/sampleRate;this.phase=wrap(this.phase+hz/sampleRate,1);if(this.profile){this.profile.elapsed+=this.rate/sampleRate;this.profile.position=wrap(this.profile.position+this.rate/sampleRate,this.profile.duration);}}
    return value;
  }
}

// Recorded cluster envelopes may run faster while their twelve carriers keep their pitch.
const CLUSTER_HZ=[261.63,277.18,293.66,311.13,329.63,349.23,369.99,392,415.30,440,466.16,493.88];
export class ContinuousCluster{
  constructor(){this.phases=new Float64Array(12);this.rate=1;this.waveform='original';this.settings={start:0,end:0,lowPitch:0,highPitch:127};}
  install(profile){this.profile={...profile,elapsed:profile.offset,position:wrap(profile.offset,profile.duration)};}
  next(sampleRate){
    const p=this.profile,position=p.position/p.duration,x=heldTime(p.position,p.sampleInterval??0)/p.duration*p.weights.length,index=Math.floor(x),fraction=p.sampleInterval?0:x-index;
    const a=p.weights[Math.min(index,p.weights.length-1)],b=p.weights[(index+1)%p.weights.length],{start,end,lowPitch,highPitch}=this.settings;
    const masked=start<end?position>=start&&position<end:start>end&&(position>=start||position<end);
    let sum=0;
    for(let i=0;i<12;i++){
      const pitchRate=(p.pitchRate??1)*(this.pitchSpeed??1),hz=CLUSTER_HZ[i]*pitchRate,note=60+i+12*Math.log2(pitchRate),phase=this.phases[i];
      const allowed=!masked&&note>=lowPitch&&note<=highPitch;
      if(isPluckedWaveform(this.waveform)){
        this.plucks??=Array.from({length:12},pluckState);
        const interval=p.pluckInterval??(p.sampleInterval||.1/(p.pitchRate??1)),tick=Math.floor((p.elapsed+1e-9)/interval);
        const value=pluckNext(this.plucks[i],phase,hz,allowed?a[i]*(1-fraction)+b[i]*fraction:0,sampleRate,true,tick,interval/(this.rate??1),this.waveform);if(allowed)sum+=value;
      }else if(allowed){
        let value=toneWave(phase,this.waveform);
        if(this.waveform==='original')value+=.1*Math.sin(TAU*phase*2)+.056*Math.sin(TAU*phase*3)+.042*Math.sin(TAU*phase*4)+.037*Math.sin(TAU*phase*5);
        const weight=a[i]*(1-fraction)+b[i]*fraction;
        sum+=value*weight;
      }
      this.phases[i]=wrap(phase+hz/sampleRate,1);
    }
    if(start!==end&&!masked){const distance=Math.min(wrap(start-position,1),wrap(position-end,1))*p.duration/this.rate;sum*=Math.min(1,distance/.003);}
    p.elapsed+=this.rate/sampleRate;p.position=wrap(p.position+this.rate/sampleRate,p.duration);
    return sum;
  }
}

// Live cluster uses the very same string model as stored/offline voices.
export class LivePluckCluster{
  constructor(){this.phases=new Float64Array(12);this.plucks=Array.from({length:12},pluckState);this.weights=new Float64Array(12);this.pitchRate=1;this.elapsed=0;}
  next(sampleRate,running=true){
    let sum=0;const interval=this.pluckInterval??.1/this.pitchRate;
    for(let i=0;i<12;i++){
      const hz=CLUSTER_HZ[i]*this.pitchRate;
      sum+=pluckNext(this.plucks[i],this.phases[i],hz,this.weights[i],sampleRate,running,Math.floor((this.elapsed+1e-9)/interval),interval,this.waveform);
      if(running)this.phases[i]=wrap(this.phases[i]+hz/sampleRate,1);
    }
    if(running)this.elapsed+=1/sampleRate;
    return sum*12000/32768;
  }
}
