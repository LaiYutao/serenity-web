import { ContinuousTone, ContinuousCluster } from './continuous-dsp.js';
class ContinuousFieldProcessor extends AudioWorkletProcessor{
  constructor(){
    super();this.live=new ContinuousTone();this.tracks=new Map();this.running=false;
    this.port.onmessage=({data})=>{
      if(data.type==='live'){
        Object.assign(this.live,{target:data.hz,speed:data.speed,waveform:data.waveform});this.running=data.running;
      }else if(data.type==='invalidate')this.live.profile=null;
      else if(data.type==='add'){
        const tone=data.profile.mode==='cluster'?new ContinuousCluster():new ContinuousTone();tone.waveform=data.waveform;
        // Both voices begin this block with the very same instantaneous carrier phase.
        const profile={...data.profile,offset:data.profile.offset+Math.max(0,currentTime-data.when)};
        if(data.adopt&&this.live.profile){
          // Re-recording an unchanged field clones its existing voice rather than resampling it.
          const liveProfile=this.live.profile;
          tone.install({...liveProfile,offset:profile.offset,lookupOffset:(liveProfile.lookupOffset??0)+liveProfile.elapsed-profile.offset},this.live.phase);
        }else{
          tone.install(profile,this.live.phase);
          if(data.adopt)this.live.install(profile);
        }
        this.tracks.set(data.slot,tone);
      }else if(data.type==='rate'){const tone=this.tracks.get(data.slot);if(tone){tone.rate=data.rate;tone.pitchSpeed=data.preservePitch===false?data.rate:1;}
      }else if(data.type==='edit')Object.assign(this.tracks.get(data.slot)?.settings??{},data.settings);
      else if(data.type==='remove')this.tracks.delete(data.slot);
    };
  }
  process(_inputs,outputs){
    const live=outputs[0][0];
    for(let i=0;i<live.length;i++)live[i]=this.live.next(sampleRate,this.running);
    for(const [slot,tone] of this.tracks){const out=outputs[slot][0];for(let i=0;i<out.length;i++)out[i]=tone.next(sampleRate)*(tone instanceof ContinuousCluster?12000:10000)/32768;}
    return true;
  }
}
registerProcessor('continuous-field',ContinuousFieldProcessor);
