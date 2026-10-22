import { cloneState } from './stateful-dsp.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const FADE_KEYS=['inTime','inCurve','outTime','outCurve'];
export const FX_PARAMETERS={
  drive:[
    {key:'drive',label:'Drive',min:0,max:1,default:.35,unit:'percent'},
    {key:'fuzz',label:'Fuzz',min:0,max:1,default:.35,unit:'percent'},
    {key:'tone',label:'Tone',min:200,max:16000,log:true,default:5000,unit:'hz'},
    {key:'mix',label:'Mix',min:0,max:1,default:.5,unit:'percent'}
  ],
  filter:[
    {key:'cutoff',label:'Cutoff',min:20,max:20000,log:true,default:12000,unit:'hz'},
    {key:'resonance',label:'Reso',min:0,max:1,default:.1,unit:'percent'},
    {key:'envMod',label:'Env Mod',min:-1,max:1,default:0,unit:'signed'},
    {key:'decay',label:'Decay',min:.01,max:10,log:true,default:.5,unit:'seconds'}
  ],
  delay:[
    {key:'time',label:'Time',min:.01,max:2,log:true,default:.35,unit:'seconds'},
    {key:'feedback',label:'Feedback',min:0,max:.9,default:.35,unit:'percent'},
    {key:'mix',label:'Mix',min:0,max:1,default:.25,unit:'percent'},
    {key:'tone',label:'Tone',min:100,max:20000,log:true,default:6000,unit:'hz'}
  ],
  fade:[
    {key:'inTime',label:'In Time',min:0,max:1,default:0,unit:'loopTime'},
    {key:'inCurve',label:'In Curve',min:-1,max:1,default:0,unit:'curve'},
    {key:'outTime',label:'Out Time',min:0,max:1,default:0,unit:'loopTime'},
    {key:'outCurve',label:'Out Curve',min:-1,max:1,default:0,unit:'curve'}
  ]
};
export function createFXState(){return {
  drive:{enabled:false,drive:.35,fuzz:.35,tone:5000,mix:.5},
  filter:{enabled:false,cutoff:12000,resonance:.1,envMod:0,decay:.5,repeats:1},
  delay:{enabled:false,time:.35,feedback:.35,mix:.25,tone:6000,sync:0},
  fade:{enabled:false,inTime:0,inCurve:0,outTime:0,outCurve:0}
};}
export function knobValue(parameter,position){const t=clamp(position,0,1);return parameter.log?parameter.min*(parameter.max/parameter.min)**t:parameter.min+(parameter.max-parameter.min)*t;}
export function knobPosition(parameter,value){return clamp(parameter.log?Math.log(value/parameter.min)/Math.log(parameter.max/parameter.min):(value-parameter.min)/(parameter.max-parameter.min),0,1);}
export function envelopeAt(time,origin,duration,repeats,decay){
  const period=duration/Math.max(1,repeats),p=((time-origin)%period+period)%period,attack=Math.min(.005,period*.05);
  if(p<attack)return p/attack;
  const end=Math.exp(-(period-attack)/Math.max(.001,decay));
  return (Math.exp(-(p-attack)/Math.max(.001,decay))-end)/(1-end);
}
export function effectiveCutoff(filter,envelope,sampleRate){return clamp(filter.cutoff*2**(filter.envMod*4*envelope),20,Math.min(20000,sampleRate*.45));}
export function delaySeconds(delay,duration){return clamp(delay.sync?duration*delay.sync:delay.time,.001,16);}
export function fadeShape(position,curve=0){return clamp(position,0,1)**(2**(clamp(curve,-1,1)*3));}
// Times are proportions of the original cycle, never edits to its duration.
// Overlapping ramps multiply smoothly instead of moving the loop boundaries.
export function fadeEnvelopeAt(position,fade){
  const p=clamp(position,0,1),a=clamp(fade.inTime,0,1),b=clamp(fade.outTime,0,1);
  return (a>0?fadeShape(p/a,fade.inCurve):1)*(b>0?fadeShape((1-p)/b,fade.outCurve):1);
}
export class TrackEffectDSP{
  constructor(sampleRate,duration=1,origin=0){
    this.sampleRate=sampleRate;this.duration=duration;this.origin=origin;this.state=createFXState();
    this.current={...this.state.filter,...{time:.35,feedback:.35,mix:.25,tone:6000}};
    this.buffer=new Float32Array(Math.ceil(sampleRate*16)+2);this.cursor=0;this.z1=0;this.z2=0;this.echo=0;this.filterWet=0;this.delayWet=0;this.tick=0;this.active=false;this.toneAlpha=1-Math.exp(-2*Math.PI*6000/sampleRate);
    this.smoothing=1-Math.exp(-1/(sampleRate*.02));this.coefficients=[1,0,0,0,0];
    this.fadeWet=0;this.fadeCurrent={...this.state.fade};
    this.driveWet=0;this.driveCurrent={...this.state.drive};
    this.drivePrevious=0;this.driveLow1=0;this.driveLow2=0;this.driveDCInput=0;this.driveDCOutput=0;this.driveTick=0;
    this.driveToneAlpha=1-Math.exp(-2*Math.PI*5000/(sampleRate*2));this.driveDCAlpha=Math.exp(-2*Math.PI*10/(sampleRate*2));
  }
  setState(state){this.state={drive:{...this.state.drive,...state.drive},filter:{...this.state.filter,...state.filter},delay:{...this.state.delay,...state.delay},fade:{...this.state.fade,...state.fade}};}
  reset(preserveDrive=false){
    this.buffer.fill(0);this.z1=0;this.z2=0;this.echo=0;
    if(!preserveDrive){this.drivePrevious=0;this.driveLow1=0;this.driveLow2=0;this.driveDCInput=0;this.driveDCOutput=0;}
  }
  snapshot(){
    const length=this.buffer.length,count=Math.min(length,Math.ceil(Math.max(this.current.time,delaySeconds(this.state.delay,this.duration))*this.sampleRate)+3);
    const start=(this.cursor-count+length)%length,history=new Float32Array(count);
    for(let i=0;i<count;i++)history[i]=this.buffer[(start+i)%length];
    const {buffer,...state}=this;return {...state,bufferLength:length,historyStart:start,history};
  }
  static restore(state){
    const {right,...channel}=state;
    const {bufferLength,historyStart,history,...values}=cloneState(channel),dsp=Object.assign(Object.create(TrackEffectDSP.prototype),values);
    dsp.buffer=new Float32Array(bufferLength);for(let i=0;i<history.length;i++)dsp.buffer[(historyStart+i)%bufferLength]=history[i];return dsp;
  }
  setPaused(paused,time){
    if(paused&&!this.paused)this.pausedAt=time;
    if(!paused&&this.paused)this.origin+=time-this.pausedAt;
    this.paused=paused;
  }
  next(input,time){
    if(this.paused)return 0;
    const {filter,delay}=this.state,c=this.current,s=this.smoothing;
    const drive=this.state.drive;
    if(drive.enabled||this.driveWet>1e-6){
      const d=this.driveCurrent;
      for(const key of ['drive','fuzz','tone','mix'])d[key]+=(drive[key]-d[key])*s;
      this.driveWet+=((drive.enabled?1:0)-this.driveWet)*s;
      const gain=1+31*d.drive*d.drive,normalization=Math.tanh(gain);
      if(this.driveTick++%16===0)this.driveToneAlpha=1-Math.exp(-2*Math.PI*Math.min(d.tone,this.sampleRate*.45)/(this.sampleRate*2));
      let wet=0;
      // Shape at 2× with interpolation, then low-pass before returning to the audio rate.
      for(let step=1;step<=2;step++){
        const x=(this.drivePrevious+(input-this.drivePrevious)*step/2)*gain;
        const soft=Math.tanh(x)/normalization,hard=clamp(x,-1,1),shaped=soft+(hard-soft)*d.fuzz;
        this.driveLow1+=(shaped-this.driveLow1)*this.driveToneAlpha;
        this.driveLow2+=(this.driveLow1-this.driveLow2)*this.driveToneAlpha;
        const dc=this.driveLow2-this.driveDCInput+this.driveDCAlpha*this.driveDCOutput;
        this.driveDCInput=this.driveLow2;this.driveDCOutput=dc;wet+=dc/2;
      }
      this.drivePrevious=input;
      input+=(wet-input)*this.driveWet*d.mix;
    }else{
      this.drivePrevious=input;this.driveLow1=0;this.driveLow2=0;this.driveDCInput=0;this.driveDCOutput=0;
    }
    let fadeGain=1;
    if(this.state.fade.enabled||this.fadeWet>1e-6){
      this.fadeWet+=((this.state.fade.enabled?1:0)-this.fadeWet)*s;
      for(const key of FADE_KEYS)this.fadeCurrent[key]+=(this.state.fade[key]-this.fadeCurrent[key])*s;
      const duration=Math.max(1/this.sampleRate,this.duration),position=(((time-this.origin)%duration)+duration)%duration/duration;
      fadeGain=1+(fadeEnvelopeAt(position,this.fadeCurrent)-1)*this.fadeWet;
    }
    if(!filter.enabled&&!delay.enabled&&this.filterWet<1e-6&&this.delayWet<1e-6){if(this.active){this.reset(true);this.active=false;}return input*fadeGain;}
    this.active=true;
    c.cutoff+=(filter.cutoff-c.cutoff)*s;c.resonance+=(filter.resonance-c.resonance)*s;c.envMod+=(filter.envMod-c.envMod)*s;c.decay+=(filter.decay-c.decay)*s;
    c.feedback+=(delay.feedback-c.feedback)*s;c.mix+=(delay.mix-c.mix)*s;c.tone+=(delay.tone-c.tone)*s;
    if(this.tick%16===0)this.toneAlpha=1-Math.exp(-2*Math.PI*Math.min(c.tone,this.sampleRate*.45)/this.sampleRate);
    c.time+=(delaySeconds(delay,this.duration)-c.time)*s;
    this.filterWet+=((filter.enabled?1:0)-this.filterWet)*s;this.delayWet+=((delay.enabled?1:0)-this.delayWet)*s;
    let signal=input;
    if(this.filterWet>1e-6){
      if(this.tick%16===0){
        const envelope=envelopeAt(time,this.origin,this.duration,filter.repeats,c.decay),hz=effectiveCutoff(c,envelope,this.sampleRate);
        const w=2*Math.PI*hz/this.sampleRate,cos=Math.cos(w),alpha=Math.sin(w)/(2*(.707+c.resonance*15)),a0=1+alpha;
        const coefficients=this.coefficients;coefficients[0]=(1-cos)/2/a0;coefficients[1]=(1-cos)/a0;coefficients[2]=coefficients[0];coefficients[3]=-2*cos/a0;coefficients[4]=(1-alpha)/a0;
      }
      const coefficients=this.coefficients,y=coefficients[0]*input+this.z1;
      this.z1=coefficients[1]*input-coefficients[3]*y+this.z2;this.z2=coefficients[2]*input-coefficients[4]*y;
      signal=input+(y-input)*this.filterWet;
    }else{this.z1=0;this.z2=0;}
    this.tick++;
    const length=this.buffer.length,read=(this.cursor-Math.max(1,c.time*this.sampleRate)+length)%length,index=Math.floor(read),fraction=read-index;
    const echo=this.buffer[index]*(1-fraction)+this.buffer[(index+1)%length]*fraction;
    this.echo+=(echo-this.echo)*this.toneAlpha;
    this.buffer[this.cursor]=signal*this.delayWet+this.echo*c.feedback;this.cursor=(this.cursor+1)%length;
    const wet=this.delayWet*c.mix;
    return (signal*(1-wet)+this.echo*wet)*fadeGain;
  }
}
