import { renderOfflineAudio } from './recording-offline-dsp.js';
self.onmessage=({data})=>{
  try{
    const {samples,channels}=renderOfflineAudio(data,value=>self.postMessage({type:'progress',value}));
    self.postMessage({samples,channels},[samples.buffer,...(channels?.map(c=>c.buffer)??[])]);
  }catch(error){self.postMessage({error:error.message});}
};
