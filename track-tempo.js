// Legacy projects stored one speed and a mutually exclusive mode.
export function trackTempo(track){
  const normal=track.normalSpeed??(track.speedMode==='normal'?track.speed??1:1);
  const stretch=track.stretchSpeed??(track.speedMode!=='normal'?track.speed??1:1);
  return {normal,stretch,rate:normal*stretch,pitchSpeed:normal};
}
export function initializeTrackTempo(track){
  const {normal,stretch,rate}=trackTempo(track);
  track.normalSpeed=normal;track.stretchSpeed=stretch;track.speed=rate;
}
export const selectedTrackSpeed=track=>trackTempo(track)[track.speedMode==='normal'?'normal':'stretch'];
