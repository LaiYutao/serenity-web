import test from 'node:test';
import assert from 'node:assert/strict';
import { ContinuousTone } from '../continuous-dsp.js';

test('a noninteger number of carrier cycles keeps its exact pitch and phase across field periods',()=>{
 const tone=new ContinuousTone(),rate=4000,hz=440.25;
 tone.install({frequencies:[hz,hz],duration:1,offset:0});
 for(let i=0;i<rate*5;i++)assert.ok(Math.abs(tone.next(rate)-Math.sin(2*Math.PI*hz*i/rate))<1e-8);
});
test('recorded field and live field share identical samples after copying the current carrier phase',()=>{
 const live=new ContinuousTone(),saved=new ContinuousTone(),rate=4000;
 live.target=391.7;for(let i=0;i<173;i++)live.next(rate);
 const profile={frequencies:[261.63,403.2,321.4,440.25],duration:.7,offset:.253};
 saved.install(profile,live.phase);live.install(profile);
 for(let i=0;i<rate*4;i++)assert.equal(live.next(rate),saved.next(rate));
 // Editing, pausing, or changing the live field cannot alter the recorded voice.
 const independent=new ContinuousTone();independent.install({...saved.profile,offset:saved.profile.elapsed},saved.phase);
 live.profile=null;live.target=800;live.speed=4;
 for(let i=0;i<500;i++){live.next(rate,false);assert.equal(saved.next(rate),independent.next(rate));}
});
test('time and pitch masks silence output while the underlying oscillator keeps advancing',()=>{
 const tone=new ContinuousTone(),reference=new ContinuousTone(),rate=4000;
 const profile={frequencies:[440.25],duration:1,offset:0};tone.install(profile);reference.install(profile);
 tone.settings={start:0,end:1,lowPitch:0,highPitch:127};
 for(let i=0;i<300;i++){assert.equal(tone.next(rate),0);reference.next(rate);}
 tone.settings.end=0;
 for(let i=0;i<100;i++)assert.equal(tone.next(rate),reference.next(rate));
 tone.settings.lowPitch=80;
 for(let i=0;i<100;i++)assert.equal(tone.next(rate),0);
});

test('re-recording a running field keeps the same frequency curve with a new mask timeline',()=>{
 const live=new ContinuousTone(),saved=new ContinuousTone(),rate=4000;
 live.install({frequencies:[261.63,430,330,410],duration:1,offset:.7});
 for(let i=0;i<73;i++)live.next(rate);
 const newOffset=.023,p=live.profile;
 saved.install({...p,offset:newOffset,lookupOffset:p.position-newOffset},live.phase);
 assert.ok(Math.abs(saved.profile.position-newOffset)<1e-12);
 for(let i=0;i<8000;i++)assert.ok(Math.abs(live.next(rate)-saved.next(rate))<1e-8);
});
