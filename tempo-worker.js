import { stretchRecording, resampleRecording } from './tempo-dsp.js';
import { filterRecording } from './recording-dsp.js';
import { renderPitchMask } from './cycle-dsp.js';
self.onmessage=({data})=>{
  try{
    const rate=data.speed??1,normal=data.speedMode==='normal';
    const samples=data.waveform==='recording'
      ? normal?filterRecording(resampleRecording(data.samples,rate),data.sampleRate,data.lowPitch,data.highPitch):stretchRecording(filterRecording(data.samples,data.sampleRate,data.lowPitch,data.highPitch),data.sampleRate,rate)
      : renderPitchMask(normal?{...data.pitchMap,pitchRate:(data.pitchMap.pitchRate??1)*rate}:data.pitchMap,data.duration/rate,data.waveform,data.sampleRate,data.lowPitch,data.highPitch).samples;
    self.postMessage({samples},[samples.buffer]);
  }catch(error){self.postMessage({error:error.message});}
};
