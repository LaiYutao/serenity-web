// Sampling is timed by AudioContext, never by the monitor's refresh rate.
export const sampleInterval=(rate,evolutionSpeed=1)=>.1/(Math.max(.05,Math.min(4,rate))*Math.max(.25,Math.abs(evolutionSpeed)));
export function heldTime(time,interval){return interval>0?Math.floor((time+1e-9)/interval)*interval:time;}
export class SampleClock{
  reset(){this.mapping=null;this.next=0;}
  sample(now,rate,read,evolutionSpeed=1){
    const interval=sampleInterval(rate,evolutionSpeed);
    if(!this.mapping||now+1e-9>=this.next||rate!==this.rate||evolutionSpeed!==this.evolutionSpeed){
      this.mapping=read();this.next=rate!==this.rate||evolutionSpeed!==this.evolutionSpeed||!Number.isFinite(this.next)||this.next===0?now+interval:this.next+(Math.floor(Math.max(0,now-this.next)/interval)+1)*interval;this.rate=rate;this.evolutionSpeed=evolutionSpeed;
    }
    return this.mapping;
  }
}

export const stepRateAt=position=>.05*80**Math.max(0,Math.min(1,position));
export const stepRatePosition=rate=>Math.log(Math.max(.05,Math.min(4,rate))/.05)/Math.log(80);
