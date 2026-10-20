class LivePCMRecorder extends AudioWorkletProcessor{
  constructor(){
    super();this.active=false;this.finished=false;this.chunk=new Float32Array(4096);this.used=0;
    this.port.onmessage=({data})=>{
      if(data==='start'){this.active=true;this.port.postMessage({type:'started',time:currentTime});}
      if(data==='stop'){this.active=false;this.flush();this.port.postMessage({type:'done'});this.finished=true;}
    };
  }
  flush(){
    if(!this.used)return;
    const samples=this.chunk.slice(0,this.used);this.port.postMessage({type:'chunk',samples},[samples.buffer]);this.used=0;
  }
  process(inputs){
    const input=inputs[0]?.[0];
    if(this.active&&input)for(let i=0;i<input.length;i++){
      this.chunk[this.used++]=input[i];if(this.used===this.chunk.length)this.flush();
    }
    return !this.finished;
  }
}
registerProcessor('live-pcm-recorder',LivePCMRecorder);
