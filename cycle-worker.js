import { renderCycle, renderPitchMask } from './cycle-dsp.js';
self.onmessage=({data})=>{
  try{const result=data.pitchMap?renderPitchMask(data.pitchMap,data.duration,data.waveform,data.sampleRate,data.lowPitch,data.highPitch):renderCycle(data.snapshot,data.mode,data.waveform,data.sampleRate);self.postMessage(result,[result.samples.buffer]);}
  catch(error){self.postMessage({error:error.message});}
};
