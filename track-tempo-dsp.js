import { stretchRecording, resampleRecording } from './tempo-dsp.js';
import { filterRecording } from './recording-dsp.js';
import { renderPitchMask } from './cycle-dsp.js';
import { trackTempo } from './track-tempo.js';
import { monoMix } from './stereo.js';

export function renderTrackTempo(data){
  const {normal,stretch,rate}=trackTempo(data);
  if(data.waveform==='recording'){
    const pitched=resampleRecording(data.samples,normal);
    return stretchRecording(filterRecording(pitched,data.sampleRate,data.lowPitch,data.highPitch),data.sampleRate,stretch);
  }
  const map=normal===1?data.pitchMap:{...data.pitchMap,pitchRate:(data.pitchMap.pitchRate??1)*normal};
  return renderPitchMask(map,data.duration/rate,data.waveform,data.sampleRate,data.lowPitch,data.highPitch).samples;
}

export function renderTrackAudio(data){
  if(data.waveform==='recording'){
    if(!data.channels)return {samples:renderTrackTempo(data)};
    const {normal,stretch}=trackTempo(data);
    const channels=data.channels.map(c=>filterRecording(resampleRecording(c,normal),data.sampleRate,data.lowPitch,data.highPitch));
    return stretchRecording(monoMix(channels),data.sampleRate,stretch,channels);
  }
  const {normal,rate}=trackTempo(data),map=normal===1?data.pitchMap:{...data.pitchMap,pitchRate:(data.pitchMap.pitchRate??1)*normal};
  return renderPitchMask(map,data.duration/rate,data.waveform,data.sampleRate,data.lowPitch,data.highPitch);
}
