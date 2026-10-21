import test from 'node:test';
import assert from 'node:assert/strict';
import { wheelMovement, wheelRangeValue } from '../wheel-controls.js';

test('Shift wheel accepts vertical and browser-translated horizontal deltas',()=>{
  assert.equal(wheelMovement({deltaX:0,deltaY:-100,shiftKey:true}),-100);
  assert.equal(wheelMovement({deltaX:100,deltaY:0,shiftKey:true}),100);
  assert.equal(wheelMovement({deltaX:-100,deltaY:0,shiftKey:false},true),-100);
  assert.equal(wheelMovement({deltaX:100,deltaY:0,shiftKey:false}),0);
  assert.equal(wheelMovement({deltaX:0,deltaY:100,ctrlKey:true}),0);
});
test('signed scene speed crosses the minimum-speed gap in either direction, including fine steps',()=>{
  for(const step of [.01,.08]){
    assert.equal(wheelRangeValue(.25,-step,-4,4,true),-.25);
    assert.equal(wheelRangeValue(-.25,step,-4,4,true),.25);
  }
  assert.equal(wheelRangeValue(.25,-.01,.25,4),.25);
  assert.equal(wheelRangeValue(4,.08,-4,4,true),4);
});
