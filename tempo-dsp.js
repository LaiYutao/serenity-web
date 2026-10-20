// Circular, waveform-aligned overlap-add. Samples inside each grain are never
// resampled: only the spacing of grains changes, preserving their pitch.
export function stretchRecording(input,sampleRate,rate=1){
  if(!Number.isFinite(rate)||rate<.25||rate>4)throw new RangeError('Invalid track speed');
  if(rate===1)return input.slice();
  const size=input.length,length=Math.max(1,Math.round(size/rate));
  if(!size)return new Float32Array();
  const frame=Math.max(32,Math.round(sampleRate*.04)),hop=Math.max(8,Math.floor(frame/4));
  const grains=Math.max(1,Math.ceil(length/hop)),search=Math.max(4,Math.round(sampleRate*.006));
  const result=new Float32Array(length),weights=new Float32Array(length);
  const wrap=i=>((i%size)+size)%size,at=i=>{const n=Math.floor(i),f=i-n;return input[wrap(n)]*(1-f)+input[wrap(n+1)]*f;};
  const window=Float32Array.from({length:frame},(_,i)=>.5-.5*Math.cos(2*Math.PI*(i+.5)/frame));
  let previous=0,previousOut=0;
  for(let grain=0;grain<grains;grain++){
    const out=Math.round(grain*length/grains),nominal=Math.round(out*rate),delta=out-previousOut;
    let start=nominal;
    if(grain){
      const reference=previous+delta,compare=Math.min(frame-delta,1024),stride=Math.max(1,Math.floor(compare/128));
      let best=-Infinity;
      const score=candidate=>{
        let dot=0,aa=0,bb=0;
        for(let j=0;j<compare;j+=stride){const a=at(reference+j),b=at(candidate+j);dot+=a*b;aa+=a*a;bb+=b*b;}
        // A small distance preference prevents drift through silence/repeated matches.
        return dot/Math.sqrt(Math.max(1e-16,aa*bb))-.002*Math.abs(candidate-nominal)/search;
      };
      for(let candidate=nominal-search;candidate<=nominal+search;candidate+=8){const value=score(candidate);if(value>best){best=value;start=candidate;}}
      const coarse=start;
      for(let candidate=coarse-7;candidate<=coarse+7;candidate++){const value=score(candidate);if(value>best){best=value;start=candidate;}}
      // Sub-sample alignment prevents a rounding error at every grain from
      // accumulating into a small but audible pitch shift on sustained notes.
      const left=score(start-1),right=score(start+1),curve=left-2*best+right;
      if(curve<0)start+=Math.max(-.5,Math.min(.5,.5*(left-right)/curve));
    }
    for(let j=0;j<frame;j++){const i=(out+j)%length,w=window[j];result[i]+=at(start+j)*w;weights[i]+=w;}
    previous=start;previousOut=out;
  }
  for(let i=0;i<length;i++)result[i]/=Math.max(1e-8,weights[i]);
  return result;
}

// Ordinary playback-rate change: duration and pitch change together.
export function resampleRecording(input,rate=1){
  if(!Number.isFinite(rate)||rate<.25||rate>4)throw new RangeError('Invalid track speed');
  if(rate===1)return input.slice();
  if(!input.length)return new Float32Array();
  const length=Math.max(1,Math.round(input.length/rate));
  return Float32Array.from({length},(_,i)=>{
    const position=i*rate,index=Math.floor(position)%input.length,fraction=position-Math.floor(position);
    return input[index]*(1-fraction)+input[(index+1)%input.length]*fraction;
  });
}
