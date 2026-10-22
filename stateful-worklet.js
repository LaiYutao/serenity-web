import { GainState, BufferVoice, SnapshotCompressor, restoreState } from './stateful-dsp.js';
class SnapshotProcessor extends AudioWorkletProcessor {
  constructor(){super();this.requests=[];this.restores=[];this.pauses=[];this.alive=true;}
  capture(){
    this.restores=this.restores.filter(event=>{if(currentFrame<event.frame)return true;this.restore(event.state);return false;});
    if(this.voice)this.pauseAt(currentFrame);
    this.requests=this.requests.filter(request=>{
      if(currentFrame<request.frame)return true;
      this.port.postMessage({type:'snapshot',id:request.id,frame:currentFrame,state:this.snapshot()});return false;
    });
  }
  pauseAt(frame){while(this.pauses.length&&this.pauses[0].frame<=frame)this.voice.paused=this.pauses.shift().paused;}
  receive(data){if(data.type==='restore'){this.restores.push({...data,frame:data.frame??currentFrame});return true;}if(data.type==='pause'){this.pauses.push(data);return true;}if(data.type==='snapshot'){this.requests.push(data);return true;}if(data.type==='dispose'){this.alive=false;return true;}return false;}
}
class StatefulGain extends SnapshotProcessor {
  constructor(){super();this.gain=new GainState(1);this.port.onmessage=({data})=>{if(this.receive(data))return;if(data.type==='gain')this.gain.set(data.value,data.constant);};}
  snapshot(){return {...this.gain};}
  restore(state){this.gain=restoreState(GainState,state);}
  process(inputs,outputs){this.capture();const out=outputs[0][0];for(let i=0;i<out.length;i++){const gain=this.gain.next(sampleRate);for(let c=0;c<outputs[0].length;c++)outputs[0][c][i]=(inputs[0]?.[c]?.[i]??inputs[0]?.[0]?.[i]??0)*gain;}return this.alive;}
}
class StatefulBuffer extends SnapshotProcessor {
  constructor(){
    super();this.voice=new BufferVoice();this.started=false;
    this.port.onmessage=({data})=>{
      if(this.receive(data))return;
      if(data.type==='start'){
        this.voice=new BufferVoice(data.samples,data.offset*sampleRate);this.voice.channels=data.channels;this.voice.startFrame=Math.round(data.when*sampleRate);
        if(currentFrame>this.voice.startFrame)this.voice.position+=currentFrame-this.voice.startFrame;
        this.started=true;
      }else if(data.type==='stop')this.voice.stopFrame=Math.round(data.when*sampleRate);
    };
  }
  snapshot(){const {samples,channels,...state}=this.voice;return state;}
  restore(state){this.voice=restoreState(BufferVoice,state);this.started=true;}
  process(_inputs,outputs){
    this.capture();const out=outputs[0][0];
    for(let i=0;i<out.length;i++){this.pauseAt(currentFrame+i);this.voice.next(currentFrame+i);out[i]=this.voice.left;if(outputs[0][1])outputs[0][1][i]=this.voice.right;}
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
      this.main.nextStereo(Math.fround((mixed?.[i]??0)*gain),Math.fround((inputs[0]?.[1]?.[i]??mixed?.[i]??0)*gain));out[i]=this.main.left;if(outputs[0][1])outputs[0][1][i]=this.main.right;
      this.tracks.nextStereo(Math.fround((tracks?.[i]??0)*gain),Math.fround((inputs[1]?.[1]?.[i]??tracks?.[i]??0)*gain));if(reference)reference[i]=this.tracks.left;if(outputs[1]?.[1])outputs[1][1][i]=this.tracks.right;
    }
    return true;
  }
}
class StatefulTrackMix extends AudioWorkletProcessor {
  process(inputs,outputs){
    const out=outputs[0][0];
    for(let i=0;i<out.length;i++){
      for(let c=0;c<outputs[0].length;c++){let sum=0;for(let slot=0;slot<inputs.length;slot++)sum=Math.fround(sum+(inputs[slot]?.[c]?.[i]??inputs[slot]?.[0]?.[i]??0));outputs[0][c][i]=sum;}
    }
    return true;
  }
}
registerProcessor('stateful-gain',StatefulGain);
registerProcessor('stateful-buffer',StatefulBuffer);
registerProcessor('stateful-master',StatefulMaster);
registerProcessor('stateful-track-mix',StatefulTrackMix);
