import { renderOffline } from './recording-offline-dsp.js';
self.onmessage=({data})=>{
  try{
    const samples=renderOffline(data,value=>self.postMessage({type:'progress',value}));
    self.postMessage({samples},[samples.buffer]);
  }catch(error){self.postMessage({error:error.message});}
};
