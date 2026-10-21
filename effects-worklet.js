import { TrackEffectDSP } from './effects-dsp.js';
class TrackEffectsProcessor extends AudioWorkletProcessor{
  constructor(options){
    super();const {duration=1,origin=0}=options.processorOptions??{};this.dsp=new TrackEffectDSP(sampleRate,duration,origin);this.alive=true;this.snapshots=[];
    this.port.onmessage=({data})=>{
      if(data.type==='state')this.dsp.setState(data.state);
      if(data.type==='duration')this.dsp.duration=data.duration;
      if(data.type==='origin')this.dsp.origin=data.origin;
      if(data.type==='reset')this.dsp.reset();
      if(data.type==='dispose')this.alive=false;
      if(data.type==='snapshot')this.snapshots.push(data);
    };
  }
  process(inputs,outputs){
    this.snapshots=this.snapshots.filter(request=>{if(currentFrame<request.frame)return true;this.port.postMessage({type:'snapshot',id:request.id,frame:currentFrame,state:this.dsp.snapshot()});return false;});
    const input=inputs[0]?.[0],output=outputs[0][0],time=currentFrame/sampleRate;
    for(let i=0;i<output.length;i++)output[i]=this.dsp.next(input?.[i]??0,time+i/sampleRate);
    return this.alive;
  }
}
registerProcessor('track-effects',TrackEffectsProcessor);
