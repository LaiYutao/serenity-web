// A restrained stereo image: no sound is isolated to one ear.
// Linear balance keeps (L + R) / 2 equal to the original mono signal.
export const PAN_WIDTH=.55;
export const panAt=(x,left,right)=>right>left?Math.max(-PAN_WIDTH,Math.min(PAN_WIDTH,((x-left)/(right-left)*2-1)*PAN_WIDTH)):0;
export function monoMix(channels){
  if(!channels?.length)return undefined;
  if(channels.length===1)return channels[0];
  return Float32Array.from(channels[0],(v,i)=>(v+channels[1][i])/2);
}
export function bufferChannels(buffer){return buffer.numberOfChannels>1?[buffer.getChannelData(0).slice(),buffer.getChannelData(1).slice()]:undefined;}
export function audioBuffer(ctx,samples,channels){
  const data=channels?.length===2?channels:[samples],buffer=ctx.createBuffer(data.length,samples.length,ctx.sampleRate);
  data.forEach((channel,i)=>buffer.copyToChannel(channel,i));return buffer;
}
