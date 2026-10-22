import { ContinuousTone, ContinuousCluster } from './continuous-dsp.js';
import { TrackEffectDSP } from './effects-dsp.js';
import { BufferVoice, GainState, restoreState } from './stateful-dsp.js';

// Advance a captured track to a shared future audio frame before installing its copy.
// Carrier phases, stereo, fades and delay history follow the same sample clock.
export function advanceTrackState(snapshot,toFrame,sampleRate){
  const {kind}=snapshot;
  const voice=restoreState(kind==='buffer'?BufferVoice:kind==='cluster'?ContinuousCluster:ContinuousTone,snapshot.voice);
  const left=TrackEffectDSP.restore(snapshot.effects),right=TrackEffectDSP.restore(snapshot.effects.right??snapshot.effects),gain=restoreState(GainState,snapshot.gain);
  const scale=kind==='buffer'?1:(kind==='cluster'?12000:10000)/32768;
  for(let frame=snapshot.frame;frame<toFrame;frame++){
    voice.next(kind==='buffer'?frame:sampleRate);
    const block=Math.floor(frame/128)*128,time=block/sampleRate+(frame-block)/sampleRate;
    left.next(Math.fround(voice.left*scale),time);
    right.next(Math.fround(voice.right*scale),time);
    gain.next(sampleRate);
  }
  return {kind,frame:toFrame,voice:{...voice},effects:{...left.snapshot(),right:right.snapshot()},gain:{...gain}};
}
