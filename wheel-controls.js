// Selection is separate from focus: dragging never enters wheel-control mode.
export function wheelMovement(event,fine=event.shiftKey){
  if(event.ctrlKey||event.metaKey)return 0;
  // macOS/browser combinations may translate Shift + vertical wheel into deltaX.
  return fine?(Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY):(Math.abs(event.deltaX)>Math.abs(event.deltaY)?0:event.deltaY);
}
export function wheelRangeValue(value,delta,min,max,signedSpeed=false){
  let next=value+delta;
  if(signedSpeed){
    if(value===.25&&delta<0&&next>-.25)next=-.25;
    else if(value===-.25&&delta>0&&next<.25)next=.25;
  }
  return Math.max(min,Math.min(max,next));
}
export function installWheelControls(knobControls){
  const knobs=new Map(knobControls.map(({knob,change,position})=>[knob,{change,position}]));
  let selected=null,press=null,remainder=0;
  const shifts=new Set();
  const clear=()=>{selected?.classList.remove('wheel-selected');selected=null;remainder=0;};
  const controlAt=target=>target.closest('input[type="range"],.fx-knob');
  document.addEventListener('pointerdown',event=>{
    clear();press=null;
    const control=controlAt(event.target);
    if(event.button===0&&event.isPrimary&&control&&!control.disabled){
      control.classList.add('pointer-adjusting');
      press={control,id:event.pointerId,x:event.clientX,y:event.clientY,dragged:false,value:Number(control.value)};
      if(control.matches('input[type="range"]')){
        // Suppress native track-click jumps; only a real drag changes its value.
        event.preventDefault();control.focus({preventScroll:true});control.setPointerCapture(event.pointerId);
      }
    }
  },true);
  document.addEventListener('pointermove',event=>{
    if(press?.id!==event.pointerId)return;
    if(Math.hypot(event.clientX-press.x,event.clientY-press.y)>4)press.dragged=true;
    if(press.dragged&&press.control.matches('input[type="range"]')&&!press.control.disabled){
      const control=press.control,min=Number(control.min||0),max=Number(control.max||100);
      control.value=String(press.value+(event.clientX-press.x)*(max-min)/Math.max(1,control.getBoundingClientRect().width-8));
      control.dispatchEvent(new Event('input',{bubbles:true}));
    }
  },true);
  document.addEventListener('pointerup',event=>{
    if(press?.id!==event.pointerId)return;
    if(!press.dragged&&!press.control.disabled){selected=press.control;selected.classList.add('wheel-selected');}
    else if(press.dragged&&press.control.matches('input[type="range"]'))press.control.dispatchEvent(new Event('change',{bubbles:true}));
    press=null;
  },true);
  document.addEventListener('pointercancel',()=>{press=null;},true);
  document.addEventListener('click',event=>{if(selected&&!selected.contains(event.target))clear();},true);
  document.addEventListener('keydown',event=>{
    if(event.key!=='Shift')event.target.closest?.('.pointer-adjusting')?.classList.remove('pointer-adjusting');
    if(event.key==='Shift'||event.code==='ShiftLeft'||event.code==='ShiftRight')shifts.add(event.code||'Shift');
    if(event.key==='Escape'&&selected){clear();event.preventDefault();event.stopImmediatePropagation();}
  },true);
  document.addEventListener('keyup',event=>{if(event.key==='Shift'||event.code==='ShiftLeft'||event.code==='ShiftRight')shifts.delete(event.code||'Shift');},true);
  window.addEventListener('blur',()=>{clear();shifts.clear();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clear();shifts.clear();}});
  // Disabled editor controls must immediately lose their selection as well.
  new MutationObserver(()=>{if(selected?.disabled)clear();}).observe(document.body,{subtree:true,attributes:true,attributeFilter:['disabled']});
  document.addEventListener('wheel',event=>{
    const fine=event.shiftKey||shifts.size>0,delta=wheelMovement(event,fine);
    if(!selected||!delta)return;
    if(selected.disabled||document.querySelector('dialog[open]')){clear();return;}
    event.preventDefault();
    const direction=delta<0?1:-1,knob=knobs.get(selected);
    if(knob){knob.change(knob.position()+direction*(fine?.0002:.002));return;}
    const min=Number(selected.min||0),max=Number(selected.max||100),step=Number(selected.step)||1;
    // Fine adjustment respects the slider's actual supported resolution.
    remainder+=direction*step*(fine?.1:1);
    const steps=Math.trunc((remainder+Math.sign(remainder)*1e-9)/step);
    if(!steps)return;
    remainder-=steps*step;
    selected.value=String(wheelRangeValue(Number(selected.value),steps*step,min,max,selected.id==='speed-range'));
    selected.dispatchEvent(new Event('input',{bubbles:true}));
  },{passive:false});
}
