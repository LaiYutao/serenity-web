import { TrackEffectDSP } from './effects-dsp.js';
class TrackEffectsProcessor extends AudioWorkletProcessor{
  constructor(options){
    super();const {duration=1,origin=0}=options.processorOptions??{};this.dsp=new TrackEffectDSP(sampleRate,duration,origin);this.rightDSP=new TrackEffectDSP(sampleRate,duration,origin);this.alive=true;this.snapshots=[];this.restores=[];this.pauses=[];this.resumedAt=-Infinity;
    this.port.onmessage=({data})=>{
      if(data.type==='state'){this.dsp.setState(data.state);this.rightDSP.setState(data.state);}
      if(data.type==='duration')this.dsp.duration=this.rightDSP.duration=data.duration;
      if(data.type==='origin'){this.dsp.origin=this.rightDSP.origin=data.origin;if(this.dsp.paused)this.dsp.pausedAt=this.rightDSP.pausedAt=data.time??currentTime;}
      if(data.type==='reset'){this.dsp.reset();this.rightDSP.reset();}
      if(data.type==='dispose')this.alive=false;
      if(data.type==='snapshot')this.snapshots.push(data);
      if(data.type==='restore')this.restores.push({...data,frame:data.frame??currentFrame});
      if(data.type==='pause')this.pauses.push(data);
    };
  }
  process(inputs,outputs){
    this.restores=this.restores.filter(data=>{if(currentFrame<data.frame)return true;this.dsp=TrackEffectDSP.restore(data.state);this.rightDSP=TrackEffectDSP.restore(data.state.right??data.state);return false;});
    while(this.pauses.length&&this.pauses[0].frame<=currentFrame){const event=this.pauses.shift();this.dsp.setPaused(event.paused,currentTime);this.rightDSP.setPaused(event.paused,currentTime);if(!event.paused)this.resumedAt=currentFrame;}
    this.snapshots=this.snapshots.filter(request=>{if(currentFrame<request.frame)return true;this.port.postMessage({type:'snapshot',id:request.id,frame:currentFrame,state:{...this.dsp.snapshot(),right:this.rightDSP.snapshot()}});return false;});
    const input=inputs[0]?.[0],output=outputs[0][0],time=currentFrame/sampleRate;
    for(let i=0;i<output.length;i++){
      const frame=currentFrame+i;
      while(this.pauses.length&&this.pauses[0].frame<=frame){const event=this.pauses.shift();this.dsp.setPaused(event.paused,frame/sampleRate);this.rightDSP.setPaused(event.paused,frame/sampleRate);if(!event.paused)this.resumedAt=frame;}
      const untilPause=this.pauses.find(event=>event.paused)?.frame??Infinity;
      const gate=Math.min(1,Math.max(0,(untilPause-frame)/(sampleRate*.003)),Math.max(0,(frame-this.resumedAt)/(sampleRate*.003)));
      output[i]=this.dsp.next(input?.[i]??0,time+i/sampleRate)*gate;
      if(outputs[0][1])outputs[0][1][i]=this.rightDSP.next(inputs[0]?.[1]?.[i]??input?.[i]??0,time+i/sampleRate)*gate;
    }

    return this.alive;
  }
}
registerProcessor('track-effects',TrackEffectsProcessor);
