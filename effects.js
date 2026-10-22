import { snapshotNode } from './stateful-audio.js';
export class TrackEffects{
  constructor(context,duration,origin){
    this.input=this.output=snapshotNode(new AudioWorkletNode(context,'track-effects',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit',processorOptions:{duration,origin}}));
  }
  snapshot(frame){return this.input.snapshot(frame);}
  setState(state){this.input.port.postMessage({type:'state',state});}
  setOrigin(origin,time=this.input.context.currentTime){this.input.port.postMessage({type:'origin',origin,time});}
  setDuration(duration){this.input.port.postMessage({type:'duration',duration});}
  restore(state,when){this.input.restore(state,when);}
  setPaused(paused,when){this.input.setPaused(paused,when);}
  reset(){this.input.port.postMessage({type:'reset'});}
  destroy(){this.input.port.postMessage({type:'dispose'});this.input.disconnect();this.input.port.close();}
}
