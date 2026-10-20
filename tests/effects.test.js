import test from 'node:test';
import assert from 'node:assert/strict';
import { TrackEffectDSP, createFXState, envelopeAt, effectiveCutoff, delaySeconds, FX_PARAMETERS, knobPosition, knobValue } from '../effects-dsp.js';

const warm=(dsp,rate)=>{for(let i=0;i<rate;i++)dsp.next(0,i/rate);};
const amplitude=(dsp,hz,rate)=>{
 let real=0,imag=0;
 for(let i=0;i<rate;i++){const phase=2*Math.PI*hz*i/rate,value=dsp.next(Math.sin(phase),(i+rate)/rate);if(i>rate/2){real+=value*Math.sin(phase);imag+=value*Math.cos(phase);}}
 return Math.hypot(real,imag)*4/rate;
};
test('both groups default to exact passthrough and own independent per-track settings',()=>{
 const a=createFXState(),b=createFXState();a.filter.cutoff=100;assert.equal(b.filter.cutoff,12000);
 const dsp=new TrackEffectDSP(8000,4);
 for(let i=0;i<8000;i++){const x=Math.sin(i*.123)*.2;assert.equal(dsp.next(x,i/8000),x);}
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
