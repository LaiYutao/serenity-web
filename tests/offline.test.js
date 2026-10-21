import test from 'node:test';
import assert from 'node:assert/strict';
import { ContinuousTone, ContinuousCluster } from '../continuous-dsp.js';
import { TrackEffectDSP, createFXState } from '../effects-dsp.js';
import { GainState, BufferVoice, SnapshotCompressor, cloneState, restoreState } from '../stateful-dsp.js';
import { renderOffline } from '../recording-offline.js';

test('oscillator snapshots retain the exact phase, profile position, speed, pitch and masks',()=>{
  for(const Type of [ContinuousTone,ContinuousCluster]){
    const tone=new Type();tone.waveform='sawtooth';tone.rate=1.37;tone.pitchSpeed=.75;
    tone.install(Type===ContinuousTone?{duration:.73,offset:.17,frequencies:Float64Array.of(241,319,267),introFrames:0}:{duration:.73,offset:.17,weights:[[1,0,0,0,0,0,0,0,0,0,0,0],[0,.7,0,0,0,0,0,0,0,0,0,0]],pitchRate:1});
    tone.settings={start:.3,end:.45,lowPitch:0,highPitch:127};
    for(let i=0;i<5000;i++)tone.next(8000);
    const saved=cloneState({...tone}),copy=restoreState(Type,saved);
    for(let i=0;i<15000;i++)assert.equal(copy.next(8000),tone.next(8000));
    assert.notEqual(copy.profile,saved.profile);
  }
});

test('effect snapshots preserve nonempty delay history, filter integrators and parameter smoothing exactly',()=>{
  const sr=8000,fx=new TrackEffectDSP(sr,.83,0),state=createFXState();
  state.filter={...state.filter,enabled:true,cutoff:630,resonance:.51,envMod:.7,decay:.21,repeats:4};
  state.delay={...state.delay,enabled:true,time:.43,feedback:.68,mix:.6,tone:2200};
  state.fade={enabled:true,inTime:.43,outTime:.37,inCurve:.6,outCurve:-.4};fx.setState(state);
  for(let i=0;i<10000;i++)fx.next(Math.sin(i*.17)*.7,i/sr);
  fx.setState({delay:{time:.1},filter:{cutoff:900},fade:{inTime:.21,outCurve:.7}});
  for(let i=10000;i<10240;i++)fx.next(Math.sin(i*.17)*.7,i/sr);
  const snapshot=fx.snapshot(),copy=TrackEffectDSP.restore(snapshot);
  assert.ok(snapshot.history.length<fx.buffer.length);assert.ok(snapshot.history.some(x=>x!==0));
  for(let i=10240;i<30000;i++)assert.equal(copy.next(Math.sin(i*.17)*.7,i/sr),fx.next(Math.sin(i*.17)*.7,i/sr));
  assert.notEqual(copy.current,snapshot.current);
});

test('compressor and volume snapshots keep gain reduction and lookahead samples, without a cold-start transient',()=>{
  const limiter=new SnapshotCompressor(8000),gain=new GainState(.1);gain.set(.8,.015);
  for(let i=0;i<5000;i++)limiter.next(Math.sin(i*.15)*1.7*gain.next(8000));
  const clonedLimiter=restoreState(SnapshotCompressor,limiter),clonedGain=restoreState(GainState,gain);
  assert.ok(limiter.gain<1);assert.ok(limiter.buffer.some(x=>x!==0));
  for(let i=5000;i<15000;i++){
    const x=Math.sin(i*.15)*1.7;
    assert.equal(clonedLimiter.next(x*clonedGain.next(8000)),limiter.next(x*gain.next(8000)));
  }
});

test('offline rendering matches a running multi-track signal through an anchor inside a block',()=>{
  const sr=8000,fx=new TrackEffectDSP(sr,1,0),gain=new GainState(.72),master=new GainState(.51),limiter=new SnapshotCompressor(sr);
  const voice=new BufferVoice(Float32Array.from({length:731},(_,i)=>Math.sin(i*.13)*.9),.375);voice.startFrame=0;
  const state=createFXState();state.delay.enabled=true;state.delay.time=.083;state.delay.mix=.4;state.delay.feedback=.6;
  state.fade={enabled:true,inTime:.32,outTime:.46,inCurve:.4,outCurve:-.6};fx.setState(state);
  const block=(frame)=>{
    const out=new Float32Array(128);
    for(let i=0;i<128;i++){
      const source=Math.fround(voice.next(frame+i)),processed=Math.fround(fx.next(source,frame/sr+i/sr));
      out[i]=limiter.next(Math.fround(Math.fround(processed*gain.next(sr))*master.next(sr)));
    }
    return out;
  };
  const frame=8192;for(let f=0;f<frame;f+=128)block(f);
  const snapshot={sampleRate:sr,frame,startFrame:frame+173,frames:12000,master:{gain:cloneState(master),compressor:cloneState(limiter)},tracks:[{kind:'buffer',voice:cloneState(voice),effects:fx.snapshot(),gain:cloneState(gain)}]};
  const actual=renderOffline(snapshot),expected=new Float32Array(snapshot.frames),end=snapshot.startFrame+snapshot.frames;
  for(let f=frame;f<end;f+=128){const values=block(f),first=Math.max(0,snapshot.startFrame-f),last=Math.min(128,end-f);if(last>first)expected.set(values.subarray(first,last),f+first-snapshot.startFrame);}
  assert.deepEqual(actual,expected);
  assert.deepEqual(renderOffline(snapshot),actual,'rendering must not mutate a reusable snapshot');
});
