import { ContinuousTone, ContinuousCluster } from './continuous-dsp.js';
import { TrackEffectDSP } from './effects-dsp.js';
import { GainState, BufferVoice, SnapshotCompressor, restoreState } from './stateful-dsp.js';
export class OfflineTrackMix {
  constructor(snapshot){
    this.sampleRate=snapshot.sampleRate;this.frame=snapshot.frame;
    this.startFrame=snapshot.startFrame;this.frames=snapshot.frames;
    this.masterGain=restoreState(GainState,snapshot.master.gain);
    this.compressor=restoreState(SnapshotCompressor,snapshot.master.compressor);
    this.tracks=snapshot.tracks.map(track=>({
      kind:track.kind,voice:restoreState(track.kind==='buffer'?BufferVoice:track.kind==='cluster'?ContinuousCluster:ContinuousTone,track.voice),
      fx:TrackEffectDSP.restore(track.effects),gain:restoreState(GainState,track.gain)
    }));
  }
  block(length=128){
    const out=new Float32Array(length),rate=this.sampleRate,time=this.frame/rate;
    for(let i=0;i<length;i++){
      let sum=0;
      for(const track of this.tracks){
        let source=track.kind==='buffer'?track.voice.next(this.frame+i):track.voice.next(rate)*(track.kind==='cluster'?12000:10000)/32768;
        source=Math.fround(source);
        const processed=Math.fround(track.fx.next(source,time+i/rate));
        sum=Math.fround(sum+Math.fround(processed*track.gain.next(rate)));
      }
      out[i]=this.compressor.next(Math.fround(sum*this.masterGain.next(rate)));
    }
    this.frame+=length;return out;
  }
}

export function renderOffline(snapshot,onProgress=()=>{}){
  const mix=new OfflineTrackMix(snapshot),samples=new Float32Array(snapshot.frames),end=snapshot.startFrame+snapshot.frames;
  const total=end-snapshot.frame;let processed=0;
  while(mix.frame<end){
    const frame=mix.frame,block=mix.block(),first=Math.max(0,snapshot.startFrame-frame),last=Math.min(block.length,end-frame);
    if(last>first)samples.set(block.subarray(first,last),frame+first-snapshot.startFrame);
    processed+=block.length;if(processed%16384===0)onProgress(Math.min(1,processed/total));
  }
  onProgress(1);return samples;
}

