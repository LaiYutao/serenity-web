import { renderTrackTempo } from './track-tempo-dsp.js';
self.onmessage=({data})=>{
  try{
    const samples=renderTrackTempo(data);
    self.postMessage({samples},[samples.buffer]);
  }catch(error){self.postMessage({error:error.message});}
};
