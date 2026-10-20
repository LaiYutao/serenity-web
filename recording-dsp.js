export function fft(real,imag,inverse=false){
  const n=real.length;
  for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[real[i],real[j]]=[real[j],real[i]];[imag[i],imag[j]]=[imag[j],imag[i]];}}
  for(let size=2;size<=n;size*=2){
    const angle=(inverse?2:-2)*Math.PI/size,wr=Math.cos(angle),wi=Math.sin(angle);
    for(let start=0;start<n;start+=size){let ar=1,ai=0;
      for(let j=0;j<size/2;j++){
        const a=start+j,b=a+size/2,tr=ar*real[b]-ai*imag[b],ti=ar*imag[b]+ai*real[b];
        real[b]=real[a]-tr;imag[b]=imag[a]-ti;real[a]+=tr;imag[a]+=ti;
        [ar,ai]=[ar*wr-ai*wi,ar*wi+ai*wr];
      }
    }
  }
  if(inverse)for(let i=0;i<n;i++){real[i]/=n;imag[i]/=n;}
}
const midiHz=note=>440*2**((note-69)/12);
export function analyseRecording(samples,sampleRate){
  const n=2048,frames=Math.max(1,Math.min(600,Math.ceil(samples.length/sampleRate*20))),lowNote=36,highNote=107,levels=[];
  const real=new Float64Array(n),imag=new Float64Array(n);
  for(let frame=0;frame<frames;frame++){
    const center=Math.floor((frame+.5)/frames*samples.length);
    for(let i=0;i<n;i++)real[i]=(samples[center+i-n/2]??0)*(.5-.5*Math.cos(2*Math.PI*i/n));
    imag.fill(0);fft(real,imag);
    const row=new Float32Array(highNote-lowNote+1);
    for(let k=1;k<n/2;k++){
      const note=Math.round(69+12*Math.log2(k*sampleRate/n/440));
      if(note>=lowNote&&note<=highNote)row[note-lowNote]+=Math.hypot(real[k],imag[k])/n;
    }
    levels.push(row);
  }
  return {mode:'recording',frames,lowNote,highNote,levels};
}
export function filterRecording(samples,sampleRate,lowPitch=0,highPitch=127){
  if(lowPitch===0&&highPitch===127)return samples.slice();
  const n=2048,hop=n/4,size=samples.length,result=new Float64Array(size),norm=new Float64Array(size);
  const window=Float64Array.from({length:n},(_,i)=>Math.sin(Math.PI*i/n));
  const real=new Float64Array(n),imag=new Float64Array(n),low=lowPitch===0?0:midiHz(lowPitch),high=highPitch===127?Infinity:midiHz(highPitch);
  for(let start=-n+hop;start<size;start+=hop){
    for(let i=0;i<n;i++)real[i]=samples[((start+i)%size+size)%size]*window[i];imag.fill(0);fft(real,imag);
    for(let k=0;k<n;k++){const hz=Math.min(k,n-k)*sampleRate/n;if(hz<low||hz>high){real[k]=0;imag[k]=0;}}
    fft(real,imag,true);
    for(let i=0;i<n;i++){const at=start+i;if(at>=0&&at<size){result[at]+=real[i]*window[i];norm[at]+=window[i]*window[i];}}
  }
  return Float32Array.from(result,(value,i)=>norm[i]?value/norm[i]:0);
}
