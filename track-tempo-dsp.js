import { stretchRecording, resampleRecording } from './tempo-dsp.js';
import { filterRecording } from './recording-dsp.js';
import { renderPitchMask } from './cycle-dsp.js';
import { trackTempo } from './track-tempo.js';

export function renderTrackTempo(data){
  const {normal,stretch,rate}=trackTempo(data);
  if(data.waveform==='recording'){
    const pitched=resampleRecording(data.samples,normal);
    return stretchRecording(filterRecording(pitched,data.sampleRate,data.lowPitch,data.highPitch),data.sampleRate,stretch);
  }
  const map=normal===1?data.pitchMap:{...data.pitchMap,pitchRate:(data.pitchMap.pitchRate??1)*normal};
  return renderPitchMask(map,data.duration/rate,data.waveform,data.sampleRate,data.lowPitch,data.highPitch).samples;
}
