// Modal envelope parameters estimated from the CC0 FreePats clean Fender B4
// single-note reference (bridge pickup), not from a polyphonic recording.
// https://freepats.zenvoid.org/ElectricGuitar/clean-electric-guitar.html
const TAU=2*Math.PI;
export const ELECTRIC_PARAMETERS={attack:.006,tracking:.006,gain:.55};
export const STRING_MODES=Float64Array.from([1,.46,.66,.58,.67,.46,.38,.10,.07,.05]);
export const STRING_DECAYS=Float64Array.from([.99,.245,.541,.723,.65,.534,.38,.387,.309,.201]);
export function electricStringWave(phase,hz,age,sampleRate){
 let value=0;
 for(let i=0;i<STRING_MODES.length;i++){
  const n=i+1;if(n*hz>=sampleRate*.45)break;
  value+=STRING_MODES[i]*Math.sin(TAU*phase*n)*Math.exp(-age/STRING_DECAYS[i]);
 }
 return value;
}
export function electricStringNext(state,phase,hz,weight,sampleRate){
 const age=state.age;
 state.electricWeight=(state.electricWeight??0)+(weight-(state.electricWeight??0))*(1-Math.exp(-1/(sampleRate*ELECTRIC_PARAMETERS.tracking)));
 if(hz<=0||hz>=sampleRate*.45)return 0;
 const t=Math.min(1,age/ELECTRIC_PARAMETERS.attack),blend=t*t*(3-2*t);
 const body=electricStringWave(phase,hz,age,sampleRate);
 const previous=blend<1&&state.previousElectric?electricStringWave(phase,hz,(state.previousAge??0)+age,sampleRate):0;
 return (previous*(1-blend)+body*blend)*state.electricWeight*ELECTRIC_PARAMETERS.gain;
}
