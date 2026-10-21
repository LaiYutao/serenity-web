import { snapshotNode } from './stateful-audio.js';
export class TrackEffects{
  constructor(context,duration,origin){
    this.input=this.output=snapshotNode(new AudioWorkletNode(context,'track-effects',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],channelCount:1,channelCountMode:'explicit',processorOptions:{duration,origin}}));
  }
  snapshot(frame){return this.input.snapshot(frame);}
  setState(state){this.input.port.postMessage({type:'state',state});}
  setOrigin(origin){this.input.port.postMessage({type:'origin',origin});}
  setDuration(duration){this.input.port.postMessage({type:'duration',duration});}
  reset(){this.input.port.postMessage({type:'reset'});}
  destroy(){this.input.port.postMessage({type:'dispose'});this.input.disconnect();this.input.port.close();}
}
