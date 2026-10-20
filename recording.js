export function joinChunks(chunks){
  const length=chunks.reduce((sum,chunk)=>sum+chunk.length,0),samples=new Float32Array(length);
  let offset=0;for(const chunk of chunks){samples.set(chunk,offset);offset+=chunk.length;}return samples;
}
export function softenLoopEdges(samples,sampleRate){
  const result=samples.slice(),ramp=Math.min(Math.round(sampleRate*.003),Math.floor(result.length/2));
  for(let i=0;i<ramp;i++){const gain=i/ramp;result[i]*=gain;result[result.length-1-i]*=gain;}return result;
}
export class LiveRecording{
  constructor(sound){this.sound=sound;this.chunks=[];this.startedAt=0;}
  async start(){
    await this.sound.start();const ctx=this.sound.context;
    this.sound.recordModule??=ctx.audioWorklet.addModule(new URL('./recorder-worklet.js',import.meta.url));
    await this.sound.recordModule;
    this.node=new AudioWorkletNode(ctx,'live-pcm-recorder',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],channelCount:1,channelCountMode:'explicit'});
    this.silent=ctx.createGain();this.silent.gain.value=0;
    this.node.connect(this.silent).connect(ctx.destination);
    // Tap the live field only, upstream of the master bus that also contains saved loops.
    this.sound.live.connect(this.node);
    await new Promise(resolve=>{
      this.node.port.onmessage=({data})=>{
        if(data.type==='started'){this.startedAt=data.time;resolve();}
        else if(data.type==='chunk')this.chunks.push(data.samples);
        else if(data.type==='done')this.finished?.();
      };
      this.node.port.postMessage('start');
    });
  }
  async stop(){
    await new Promise(resolve=>{this.finished=resolve;this.node.port.postMessage('stop');});
    this.sound.live.disconnect(this.node);this.node.disconnect();this.silent.disconnect();this.node.port.close();
    const samples=joinChunks(this.chunks);this.chunks=[];
    if(samples.length<this.sound.context.sampleRate*.5)throw new Error('recordEmpty');
    return softenLoopEdges(samples,this.sound.context.sampleRate);
  }
}
