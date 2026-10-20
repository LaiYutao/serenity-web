import { analyseRecording, filterRecording } from './recording-dsp.js';
self.onmessage=({data})=>{
  try{
    if(data.type==='analyse')self.postMessage({pitchMap:analyseRecording(data.samples,data.sampleRate)});
    else{const samples=filterRecording(data.samples,data.sampleRate,data.lowPitch,data.highPitch);self.postMessage({samples},[samples.buffer]);}
  }catch(error){self.postMessage({error:error.message});}
};
