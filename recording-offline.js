import { planCycleExport } from './recording-export.js';
import { loopGain } from './loops.js';
export { OfflineTrackMix, renderOffline } from './recording-offline-dsp.js';

export async function snapshotCycle(sound,tracks,anchorId){
  const ctx=sound.context,rate=ctx.sampleRate;
  // An aligned block boundary makes all source, effect and gain snapshots share one instant.
  const frame=Math.ceil((ctx.currentTime+.15)*rate/128)*128;
  const audible=tracks.filter(track=>loopGain(track,tracks)>0);
  const renderTracks=[...tracks].sort((a,b)=>(a.mixSlot??0)-(b.mixSlot??0));
  if(!audible.length)throw new Error('exportNoTracks');
  if(renderTracks.some(track=>track.worker))throw new Error('exportTrackBusy');
  const slots=renderTracks.filter(track=>track.continuous).map(track=>track.source.slot);
  const sources=slots.length?sound.snapshotContinuous(slots,frame):Promise.resolve({frame,tracks:[]});
  const promises=renderTracks.map(async track=>{
    const [source,effects,gain]=await Promise.all([
      track.continuous?null:track.source.snapshot(frame),track.effects.snapshot(frame),track.gain.snapshot(frame)
    ]);
    return {track,source,effects,gain};
  });
  const [continuous,master,entries]=await Promise.all([sources,sound.master.snapshot(frame),Promise.all(promises)]);
  const responses=[continuous,master,...entries.flatMap(entry=>[entry.effects,entry.gain,...(entry.source?[entry.source]:[])])];
  if(responses.some(response=>response.frame!==frame))throw new Error('exportSnapshotMismatch');
  const plan=planCycleExport(tracks,anchorId,rate,frame/rate);
  const captured=entries.map(({track,source,effects,gain})=>{
    const voice=track.continuous?continuous.tracks.find(item=>item.slot===track.source.slot):{kind:'buffer',state:{...source.state,samples:track.buffer.getChannelData(0).slice()}};
    if(!voice?.state)throw new Error('exportSnapshotMismatch');
    return {kind:voice.kind,voice:voice.state,effects:effects.state,gain:gain.state};
  });
  // Use the audio-thread cursor, not the main thread's approximate playhead after a rate edit.
  const anchor=captured[renderTracks.findIndex(track=>track.id===plan.anchorId)];
  const length=anchor.kind==='buffer'?anchor.voice.samples.length:anchor.voice.profile.duration;
  const position=anchor.kind==='buffer'?anchor.voice.position:anchor.voice.profile.position;
  const normalized=((position%length)+length)%length;
  const remaining=(length-normalized)/(anchor.kind==='buffer'?rate:anchor.voice.rate??1);
  const startFrame=frame+Math.max(1,Math.round(remaining*rate));plan.when=startFrame/rate;
  return {sampleRate:rate,frame,startFrame,frames:plan.frames,master:master.state,tracks:captured,plan};
}

export function startOfflineRender(snapshot,onProgress=()=>{}){
  const worker=new Worker(new URL('./recording-offline-worker.js',import.meta.url),{type:'module'});
  let reject;
  const done=new Promise((resolve,rejectPromise)=>{
    reject=rejectPromise;
    worker.onmessage=({data})=>{
      if(data.type==='progress'){onProgress(data.value);return;}
      worker.terminate();data.error?rejectPromise(new Error(data.error)):resolve({samples:data.samples,sampleRate:snapshot.sampleRate});
    };
    worker.onerror=()=>{worker.terminate();rejectPromise(new Error('exportFailed'));};
    worker.postMessage(snapshot);
  });
  return {done,stop(){worker.terminate();reject(new Error('exportCancelled'));return done;}};
}
