import { isPluckedWaveform } from './pluck-dsp.js';
import { ContinuousTone, ContinuousCluster, LivePluckCluster } from './continuous-dsp.js';
class ContinuousFieldProcessor extends AudioWorkletProcessor{
  constructor(){
    super();this.live=new ContinuousTone();this.livePluck=new LivePluckCluster();this.tracks=new Map();this.running=false;this.snapshots=[];this.restores=[];this.pauses=[];
    this.port.onmessage=({data})=>{
      if(data.type==='snapshot'){this.snapshots.push(data);}
      else if(data.type==='live'){
        Object.assign(this.live,{target:data.hz,speed:data.speed,waveform:data.waveform,pluckInterval:data.pluckInterval,targetPan:data.pan??0});this.running=data.running;this.mode=data.mode;
        if(data.weights)this.livePluck.weights=data.weights;this.livePluck.pitchRate=data.pitchRate??data.speed;this.livePluck.pluckInterval=data.pluckInterval;this.livePluck.waveform=data.waveform;this.livePluck.targetPans=data.pans;
      }else if(data.type==='invalidate')this.live.profile=null;
      else if(data.type==='add'){
        const tone=data.profile.mode==='cluster'?new ContinuousCluster():new ContinuousTone();tone.waveform=data.waveform;if(data.adopt)tone.pan=this.live.pan??0;
        // Both voices begin this block with the very same instantaneous carrier phase.
        const profile={...data.profile,offset:data.profile.offset+Math.max(0,currentTime-data.when)};
        if(data.adopt&&this.live.profile){
          // Re-recording an unchanged field clones its existing voice rather than resampling it.
          const liveProfile=this.live.profile;
          tone.install({...liveProfile,offset:profile.offset,lookupOffset:(liveProfile.lookupOffset??0)+liveProfile.elapsed-profile.offset},this.live.phase);
        }else{
          tone.install(profile,this.live.phase);
          if(data.adopt){if(this.live.pluck)tone.pluck=structuredClone(this.live.pluck);this.live.install(profile);}
        }
        this.tracks.set(data.slot,tone);
      }else if(data.type==='restore'){this.restores.push({...data,frame:data.frame??currentFrame});
      }else if(data.type==='pause'){this.pauses.push(data);
      }else if(data.type==='rate'){const tone=this.tracks.get(data.slot);if(tone){tone.rate=data.rate;tone.pitchSpeed=data.pitchSpeed??(data.preservePitch===false?data.rate:1);}
      }else if(data.type==='edit')Object.assign(this.tracks.get(data.slot)?.settings??{},data.settings);
      else if(data.type==='remove')this.tracks.delete(data.slot);
    };
  }
  process(_inputs,outputs){
    this.restores=this.restores.filter(data=>{if(currentFrame<data.frame)return true;const tone=data.state.profile.mode==='cluster'?new ContinuousCluster():new ContinuousTone();Object.assign(tone,data.state);this.tracks.set(data.slot,tone);return false;});
    this.pauses=this.pauses.filter(event=>{if(event.frame>currentFrame)return true;const tone=this.tracks.get(event.slot);if(tone)tone.paused=event.paused;return false;});
    this.snapshots=this.snapshots.filter(request=>{
      if(currentFrame<request.frame)return true;
      const tracks=request.slots.map(slot=>{const tone=this.tracks.get(slot);return {slot,kind:tone instanceof ContinuousCluster?'cluster':'tone',state:tone?{...tone}:null};});
      this.port.postMessage({type:'snapshot',id:request.id,frame:currentFrame,tracks});return false;
    });
    const live=outputs[0][0],right=outputs[0][1];
    for(let i=0;i<live.length;i++){
      const plucked=isPluckedWaveform(this.live.waveform)&&this.mode==='cluster',voice=plucked?this.livePluck:this.live,scale=plucked?32768/10000:1;
      voice.next(sampleRate,this.running);live[i]=voice.left*scale;if(right)right[i]=voice.right*scale;
    }
    for(const [slot,tone] of this.tracks){
      const out=outputs[slot][0],r=outputs[slot][1],scale=(tone instanceof ContinuousCluster?12000:10000)/32768;
      const events=this.pauses.filter(event=>event.slot===slot);
      for(let i=0;i<out.length;i++){
        while(events.length&&events[0].frame<=currentFrame+i)tone.paused=events.shift().paused;
        tone.next(sampleRate);out[i]=tone.left*scale;if(r)r[i]=tone.right*scale;
      }
    }
    this.pauses=this.pauses.filter(event=>event.frame>=currentFrame+live.length);

    return true;
  }
}
registerProcessor('continuous-field',ContinuousFieldProcessor);
