import { GainState, BufferVoice, SnapshotCompressor } from './stateful-dsp.js';
class SnapshotProcessor extends AudioWorkletProcessor {
  constructor(){super();this.requests=[];this.alive=true;}
  capture(){
    this.requests=this.requests.filter(request=>{
      if(currentFrame<request.frame)return true;
      this.port.postMessage({type:'snapshot',id:request.id,frame:currentFrame,state:this.snapshot()});return false;
    });
  }
  receive(data){if(data.type==='snapshot'){this.requests.push(data);return true;}if(data.type==='dispose'){this.alive=false;return true;}return false;}
}
class StatefulGain extends SnapshotProcessor {
  constructor(){super();this.gain=new GainState(1);this.port.onmessage=({data})=>{if(this.receive(data))return;if(data.type==='gain')this.gain.set(data.value,data.constant);};}
  snapshot(){return {...this.gain};}
  process(inputs,outputs){this.capture();const out=outputs[0][0],input=inputs[0]?.[0];for(let i=0;i<out.length;i++)out[i]=(input?.[i]??0)*this.gain.next(sampleRate);return this.alive;}
}
class StatefulBuffer extends SnapshotProcessor {
  constructor(){
    super();this.voice=new BufferVoice();this.started=false;
    this.port.onmessage=({data})=>{
      if(this.receive(data))return;
      if(data.type==='start'){
        this.voice=new BufferVoice(data.samples,data.offset*sampleRate);this.voice.startFrame=Math.round(data.when*sampleRate);
        if(currentFrame>this.voice.startFrame)this.voice.position+=currentFrame-this.voice.startFrame;
        this.started=true;
      }else if(data.type==='stop')this.voice.stopFrame=Math.round(data.when*sampleRate);
    };
  }
  snapshot(){const {samples,...state}=this.voice;return state;}
  process(_inputs,outputs){
    this.capture();const out=outputs[0][0];
    for(let i=0;i<out.length;i++)out[i]=this.voice.next(currentFrame+i);
    if(this.started&&currentFrame+out.length>=this.voice.stopFrame){this.port.postMessage({type:'ended'});return false;}
    return true;
  }
}
class StatefulMaster extends SnapshotProcessor {
  constructor(){
    super();this.gain=new GainState(0);this.main=new SnapshotCompressor(sampleRate);this.tracks=new SnapshotCompressor(sampleRate);
    this.port.onmessage=({data})=>{if(this.receive(data))return;if(data.type==='gain')this.gain.set(data.value,data.constant);};
  }
  snapshot(){return {gain:{...this.gain},compressor:{...this.tracks}};}
  process(inputs,outputs){
    this.capture();const mixed=inputs[0]?.[0],tracks=inputs[1]?.[0],out=outputs[0][0],reference=outputs[1]?.[0];
    for(let i=0;i<out.length;i++){
      const gain=this.gain.next(sampleRate);
      out[i]=this.main.next(Math.fround((mixed?.[i]??0)*gain));
      const value=this.tracks.next(Math.fround((tracks?.[i]??0)*gain));if(reference)reference[i]=value;
    }
    return true;
  }
}
class StatefulTrackMix extends AudioWorkletProcessor {
  process(inputs,outputs){
    const out=outputs[0][0];
    for(let i=0;i<out.length;i++){
      let sum=0;for(let slot=0;slot<inputs.length;slot++)sum=Math.fround(sum+(inputs[slot]?.[0]?.[i]??0));out[i]=sum;
    }
    return true;
  }
}
registerProcessor('stateful-gain',StatefulGain);
registerProcessor('stateful-buffer',StatefulBuffer);
registerProcessor('stateful-master',StatefulMaster);
registerProcessor('stateful-track-mix',StatefulTrackMix);
