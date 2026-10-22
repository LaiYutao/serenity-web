import test from 'node:test';
import assert from 'node:assert/strict';
import { TrackEffectDSP, createFXState, envelopeAt, effectiveCutoff, delaySeconds, FX_PARAMETERS, knobPosition, knobValue, fadeShape, fadeEnvelopeAt } from '../effects-dsp.js';

const warm=(dsp,rate)=>{for(let i=0;i<rate;i++)dsp.next(0,i/rate);};
const amplitude=(dsp,hz,rate)=>{
 let real=0,imag=0;
 for(let i=0;i<rate;i++){const phase=2*Math.PI*hz*i/rate,value=dsp.next(Math.sin(phase),(i+rate)/rate);if(i>rate/2){real+=value*Math.sin(phase);imag+=value*Math.cos(phase);}}
 return Math.hypot(real,imag)*4/rate;
};
test('all four groups default to exact passthrough and own independent per-track settings',()=>{
 const a=createFXState(),b=createFXState();a.filter.cutoff=100;assert.equal(b.filter.cutoff,12000);
 const dsp=new TrackEffectDSP(8000,4);
 for(let i=0;i<8000;i++){const x=Math.sin(i*.123)*.2;assert.equal(dsp.next(x,i/8000),x);}
});

test('Drive adds harmonics, Fuzz changes their character and Tone controls brightness',()=>{
 const rate=8000;
 const render=(values,hz=200)=>{
  const dsp=new TrackEffectDSP(rate,1);dsp.setState({drive:{enabled:true,mix:1,tone:16000,...values}});warm(dsp,rate);
  return Float32Array.from({length:rate},(_,i)=>dsp.next(.15*Math.sin(2*Math.PI*hz*i/rate),1+i/rate));
 };
 const partial=(samples,hz)=>{
  let a=0,b=0;for(let i=0;i<samples.length;i++){const phase=2*Math.PI*hz*i/rate;a+=samples[i]*Math.cos(phase);b+=samples[i]*Math.sin(phase);}return Math.hypot(a,b)/samples.length*2;
 };
 const clean=render({drive:0,fuzz:0}),soft=render({drive:.6,fuzz:0}),fuzz=render({drive:.6,fuzz:1});
 assert.ok(partial(fuzz,600)>partial(clean,600)*10);
 assert.ok(partial(fuzz,600)>partial(soft,600)*1.1);
 const dark=render({drive:1,fuzz:1,tone:200},1800),bright=render({drive:1,fuzz:1,tone:16000},1800);
 assert.ok(partial(dark,1800)<partial(bright,1800)*.1);
 for(const samples of [clean,soft,fuzz,dark,bright])assert.ok(samples.every(v=>Number.isFinite(v)&&Math.abs(v)<1.5));
});

test('Drive dry mix and bypass preserve the original audio, with smooth activation',()=>{
 const rate=8000,dsp=new TrackEffectDSP(rate,1);
 dsp.setState({drive:{enabled:true,drive:1,fuzz:1,mix:0}});warm(dsp,rate);
 for(let i=0;i<1000;i++){const x=.3*Math.sin(i*.2);assert.ok(Math.abs(dsp.next(x,1+i/rate)-x)<1e-12);}
 dsp.setState({drive:{enabled:false,mix:1}});warm(dsp,rate);
 for(let i=0;i<1000;i++){const x=.3*Math.sin(i*.2);assert.equal(dsp.next(x,2+i/rate),x);}
 const fade=new TrackEffectDSP(rate,1);fade.next(.2,0);fade.setState({drive:{enabled:true,drive:1,fuzz:1,mix:1}});
 assert.ok(Math.abs(fade.next(.2,1/rate)-.2)<.01);
 const original=createFXState();fade.setState({filter:{enabled:true,cutoff:500}});
 assert.deepEqual(fade.state.delay,original.delay);assert.deepEqual(fade.state.fade,original.fade);
 assert.equal(fade.state.drive.drive,1);
});

test('fade ramps preserve a full cycle, reach zero at its ends and handle overlap continuously',()=>{
 const fade={inTime:.25,outTime:.5,inCurve:0,outCurve:0};
 assert.equal(fadeEnvelopeAt(0,fade),0);assert.equal(fadeEnvelopeAt(.125,fade),.5);
 assert.equal(fadeEnvelopeAt(.25,fade),1);assert.equal(fadeEnvelopeAt(.5,fade),1);
 assert.equal(fadeEnvelopeAt(.75,fade),.5);assert.equal(fadeEnvelopeAt(1,fade),0);
 assert.equal(fadeEnvelopeAt(.5,{...fade,inTime:1,outTime:1}),.25);
 for(let i=0;i<=1000;i++){const g=fadeEnvelopeAt(i/1000,{...fade,inTime:.8,outTime:.9});assert.ok(g>=0&&g<=1);}
 assert.equal(fadeEnvelopeAt(0,{...fade,inTime:0,outTime:0}),1);
});
test('one curve parameter is continuous, monotonic and preserves exact endpoints',()=>{
 for(const curve of [-1,-.5,0,.5,1]){
  assert.equal(fadeShape(0,curve),0);assert.equal(fadeShape(1,curve),1);
  let previous=0;for(let i=0;i<=100;i++){const value=fadeShape(i/100,curve);assert.ok(value>=previous);previous=value;}
 }
 assert.equal(fadeShape(.5,0),.5);assert.ok(fadeShape(.5,1)<.5);assert.ok(fadeShape(.5,-1)>.5);
});
test('fade follows the track origin and tempo without changing duration or other effect banks',()=>{
 const sr=8000,dsp=new TrackEffectDSP(sr,4,3),state=createFXState();
 state.fade={enabled:true,inTime:.25,outTime:.25,inCurve:0,outCurve:0};dsp.setState(state);warm(dsp,sr);
 assert.equal(dsp.duration,4);
 assert.ok(Math.abs(dsp.next(1,3.5)-.5)<1e-10);
 assert.ok(Math.abs(dsp.next(1,7.5)-.5)<1e-10);
 dsp.duration=2;assert.ok(Math.abs(dsp.next(1,3.25)-.5)<1e-10);
 dsp.setState({delay:{enabled:true,mix:0}});assert.equal(dsp.state.fade.inTime,.25);
 assert.equal(state.fade.inTime,.25);
 dsp.setState({fade:{enabled:false}});warm(dsp,sr);assert.ok(Math.abs(dsp.next(.7,3)-.7)<1e-10);
});
test('fade envelopes apply to delay tails as well as dry signal',()=>{
 const sr=8000,plain=new TrackEffectDSP(sr,1),faded=new TrackEffectDSP(sr,1);
 for(const dsp of [plain,faded])dsp.setState({delay:{enabled:true,time:.02,mix:.8,feedback:.6,tone:3000}});
 faded.setState({fade:{enabled:true,inTime:.2,outTime:.3,inCurve:.4,outCurve:-.3}});
 for(let i=0;i<sr;i++){plain.next(0,i/sr);faded.next(0,i/sr);}
 let tail=false;
 for(let i=0;i<sr;i++){
  const time=1+i/sr,input=i===sr-400?1:0,a=plain.next(input,time),b=faded.next(input,time);
  assert.ok(Math.abs(b-a*fadeEnvelopeAt(i/sr,faded.state.fade))<1e-10);
  if(i>sr-400&&Math.abs(a)>.001){tail=true;assert.ok(Math.abs(b)<Math.abs(a));}
 }
 assert.ok(tail);
});
test('lowpass cutoff attenuates high frequencies; resonance strengthens the cutoff region',()=>{
 const rate=8000,low=new TrackEffectDSP(rate,4);low.setState({filter:{enabled:true,cutoff:400,resonance:0}});warm(low,rate);
 assert.ok(amplitude(low,100,rate)>.95);
 const high=new TrackEffectDSP(rate,4);high.setState({filter:{enabled:true,cutoff:400,resonance:0}});warm(high,rate);
 assert.ok(amplitude(high,2000,rate)<.04);
 const resonant=new TrackEffectDSP(rate,4);resonant.setState({filter:{enabled:true,cutoff:400,resonance:.5}});warm(resonant,rate);
 assert.ok(amplitude(resonant,400,rate)>3);
});
test('filter envelope follows each track origin and repeats, and modulation is bipolar',()=>{
 const first=envelopeAt(5.01,5,4,2,.2),late=envelopeAt(5.8,5,4,2,.2);
 assert.ok(first>.9);assert.ok(late<.03);
 assert.ok(Math.abs(first-envelopeAt(7.01,5,4,2,.2))<1e-10);
 assert.equal(effectiveCutoff({cutoff:1000,envMod:1},1,48000),16000);
 assert.equal(effectiveCutoff({cutoff:1000,envMod:-1},1,48000),62.5);
});
test('delay impulse returns after the selected time, with decaying feedback and independently controlled mix',()=>{
 const rate=8000,dsp=new TrackEffectDSP(rate,4);
 dsp.setState({delay:{enabled:true,time:.05,feedback:.5,mix:1,tone:3000}});warm(dsp,rate);
 const out=Float32Array.from({length:1800},(_,i)=>dsp.next(i===0?1:0,1+i/rate));
 const peak=(start,end)=>Math.max(...out.slice(start,end));
 assert.ok(peak(0,395)<1e-5);assert.ok(peak(398,410)>.8);
 assert.ok(peak(798,815)>.25&&peak(798,815)<peak(398,410));
 const dry=new TrackEffectDSP(rate,4);dry.setState({delay:{enabled:true,mix:0}});warm(dry,rate);
 for(let i=0;i<1000;i++){const x=Math.sin(i*.2);assert.equal(dry.next(x,1+i/rate),x);}
});
test('delay tone darkens echoes, feedback remains bounded, sync uses the recorded track duration',()=>{
 const rate=8000;
 const echoAmplitude=tone=>{const dsp=new TrackEffectDSP(rate,4);dsp.setState({delay:{enabled:true,mix:1,feedback:0,time:.05,tone}});warm(dsp,rate);return amplitude(dsp,1800,rate);};
 assert.ok(echoAmplitude(200)<echoAmplitude(3000)*.2);
 assert.equal(delaySeconds({sync:.25,time:.3},8),2);assert.equal(delaySeconds({sync:0,time:.3},8),.3);
 const dsp=new TrackEffectDSP(rate,4);dsp.setState({delay:{enabled:true,feedback:.9,time:.01,mix:1,tone:7000}});warm(dsp,rate);
 let max=0;for(let i=0;i<rate*4;i++){const value=dsp.next(i===0?1:0,1+i/rate);assert.ok(Number.isFinite(value));max=Math.max(max,Math.abs(value));}
 assert.ok(max<=1.01);
});
test('knob mapping is reversible across logarithmic and bipolar controls',()=>{
 for(const parameters of Object.values(FX_PARAMETERS))for(const parameter of parameters)for(const t of [0,.1,.5,.9,1])assert.ok(Math.abs(knobPosition(parameter,knobValue(parameter,t))-t)<1e-10);
});
