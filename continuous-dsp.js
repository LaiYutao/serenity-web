const TAU=2*Math.PI;
const wrap=(value,period)=>((value%period)+period)%period;
export function profileFrequency(profile,elapsed){
  const frequencies=profile.frequencies,offset=profile.lookupOffset??0,t=Math.max(0,elapsed+offset);
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
    const value=gain===0?0:toneWave(this.phase,this.waveform)*gain;
    if(advance){this.phase=wrap(this.phase+hz/sampleRate,1);if(this.profile){this.profile.elapsed+=this.rate/sampleRate;this.profile.position=wrap(this.profile.position+this.rate/sampleRate,this.profile.duration);}}
    return value;
  }
}

// Recorded cluster envelopes may run faster while their twelve carriers keep their pitch.
const CLUSTER_HZ=[261.63,277.18,293.66,311.13,329.63,349.23,369.99,392,415.30,440,466.16,493.88];
export class ContinuousCluster{
  constructor(){this.phases=new Float64Array(12);this.rate=1;this.waveform='original';this.settings={start:0,end:0,lowPitch:0,highPitch:127};}
  install(profile){this.profile={...profile,elapsed:profile.offset,position:wrap(profile.offset,profile.duration)};}
  next(sampleRate){
    const p=this.profile,position=p.position/p.duration,x=position*p.weights.length,index=Math.floor(x),fraction=x-index;
    const a=p.weights[index],b=p.weights[(index+1)%p.weights.length],{start,end,lowPitch,highPitch}=this.settings;
    const masked=start<end?position>=start&&position<end:start>end&&(position>=start||position<end);
    let sum=0;
    for(let i=0;i<12;i++){
      const pitchRate=(p.pitchRate??1)*(this.pitchSpeed??1),hz=CLUSTER_HZ[i]*pitchRate,note=60+i+12*Math.log2(pitchRate),phase=this.phases[i];
      if(!masked&&note>=lowPitch&&note<=highPitch){
        let value=toneWave(phase,this.waveform);
        if(this.waveform==='original')value+=.1*Math.sin(TAU*phase*2)+.056*Math.sin(TAU*phase*3)+.042*Math.sin(TAU*phase*4)+.037*Math.sin(TAU*phase*5);
        sum+=value*(a[i]*(1-fraction)+b[i]*fraction);
      }
      this.phases[i]=wrap(phase+hz/sampleRate,1);
    }
    if(start!==end&&!masked){const distance=Math.min(wrap(start-position,1),wrap(position-end,1))*p.duration/this.rate;sum*=Math.min(1,distance/.003);}
    p.elapsed+=this.rate/sampleRate;p.position=wrap(p.position+this.rate/sampleRate,p.duration);
    return sum;
  }
}
