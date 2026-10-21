let requestId=0;
export function snapshotNode(node){
  const pending=new Map();
  node.port.onmessage=({data})=>{
    if(data.type==='ended'){node.onended?.();node.port.close();return;}
    if(data.type==='snapshot'){
      const request=pending.get(data.id);if(!request)return;
      clearTimeout(request.timer);pending.delete(data.id);request.resolve(data);
    }
  };
  node.snapshot=frame=>new Promise((resolve,reject)=>{
    const id=++requestId,timer=setTimeout(()=>{pending.delete(id);reject(new Error('exportSnapshotTimeout'));},5000);
    pending.set(id,{resolve,reject,timer});node.port.postMessage({type:'snapshot',id,frame});
  });
  return node;
}
export function gainControl(node,initial=1){
  let target=initial;
  return {
    get value(){return target;},
    set value(value){target=value;node.port.postMessage({type:'gain',value,constant:0});},
    cancelScheduledValues(){},
    setTargetAtTime(value,_time,constant){if(target===value)return;target=value;node.port.postMessage({type:'gain',value,constant});},
    setValueAtTime(value){this.value=value;}
  };
}
export function createGainNode(context,{master=false}={}){
  const node=snapshotNode(new AudioWorkletNode(context,master?'stateful-master':'stateful-gain',{numberOfInputs:master?2:1,numberOfOutputs:master?2:1,outputChannelCount:master?[1,1]:[1],channelCount:1,channelCountMode:'explicit'}));
  node.gain=gainControl(node,master?0:1);
  node.destroy=()=>{node.port.postMessage({type:'dispose'});node.disconnect();node.port.close();};return node;
}
export function createBufferNode(context){
  const node=snapshotNode(new AudioWorkletNode(context,'stateful-buffer',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]}));
  node.start=(when=context.currentTime,offset=0)=>{
    const samples=node.buffer.getChannelData(0).slice();node.port.postMessage({type:'start',when,offset,samples},[samples.buffer]);
  };
  node.stop=(when=context.currentTime)=>node.port.postMessage({type:'stop',when});
  return node;
}
