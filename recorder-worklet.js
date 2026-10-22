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
    const samples=this.chunk.slice(0,this.used),channels=this.channels?.map(c=>c.slice(0,this.used));this.port.postMessage({type:'chunk',samples,...(channels?{channels}:{})},[samples.buffer,...(channels?.map(c=>c.buffer)??[])]);this.used=0;
  }
  process(inputs){
    const input=inputs[0]?.[0];
    if(inputs[0]?.length>1)this.channels??=[new Float32Array(this.chunk.length),new Float32Array(this.chunk.length)];
    if(this.active&&input)for(let i=0;i<input.length;i++){
      const l=input[i],r=inputs[0]?.[1]?.[i]??l;if(this.channels){this.channels[0][this.used]=l;this.channels[1][this.used]=r;}this.chunk[this.used++]=(l+r)/2;if(this.used===this.chunk.length)this.flush();
    }
    return !this.finished;
  }
}
registerProcessor('live-pcm-recorder',LivePCMRecorder);
