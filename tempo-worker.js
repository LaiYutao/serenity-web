import { renderTrackAudio } from './track-tempo-dsp.js';
self.onmessage=({data})=>{
  try{
    const {samples,channels}=renderTrackAudio(data);
    self.postMessage({samples,channels},[samples.buffer,...(channels?.map(c=>c.buffer)??[])]);
  }catch(error){self.postMessage({error:error.message});}
};
