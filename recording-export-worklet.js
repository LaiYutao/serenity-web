class MixExportRecorder extends AudioWorkletProcessor{
  constructor(){
    super();this.active=false;this.finished=false;this.used=0;this.written=0;this.chunk=new Float32Array(4096);
    this.port.onmessage=({data})=>{
      if(data.type==='start'){
        this.startFrame=Math.round(data.when*sampleRate);this.frames=data.frames;this.active=true;
        this.port.postMessage({type:'armed'});
      }else if(data.type==='stop')this.finish();
    };
  }
  flush(){
    if(!this.used)return;
    const samples=this.chunk.slice(0,this.used);this.port.postMessage({type:'chunk',samples},[samples.buffer]);this.used=0;
  }
  finish(){if(this.finished)return;this.active=false;this.flush();this.finished=true;this.port.postMessage({type:'done'});}
  process(inputs,outputs){
    // This output is always silent: adding an export tap must never double playback.
    const count=outputs[0]?.[0]?.length??128,input=inputs[0]?.[0];
    if(this.active)for(let i=0;i<count;i++){
      if(currentFrame+i<this.startFrame)continue;
      this.chunk[this.used++]=input?.[i]??0;this.written++;
      if(this.used===this.chunk.length)this.flush();
      if(this.written>=this.frames){this.finish();break;}
    }
    return !this.finished;
  }
}
registerProcessor('mix-export-recorder',MixExportRecorder);
