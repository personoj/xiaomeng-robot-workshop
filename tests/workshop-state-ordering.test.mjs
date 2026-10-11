import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const moduleUrl=process.env.WORKSHOP_STATE_MODULE
  ?pathToFileURL(process.env.WORKSHOP_STATE_MODULE).href
  :new URL('../frontend/workshop-state.js',import.meta.url).href;
const {WorkshopStateCache}=await import(moduleUrl);
const packet=(runtime,sequence,runs=[])=>({runtime_id:runtime,scene_id:'persisted-scene',sequence,objects:[{id:'panel_1',weld_runs:runs}]});
const run=(task_id,points,start=0)=>({task_id,points,points_start:start});

test('a late HTTP packet from a retired runtime cannot rewind a reconnected scene',()=>{
  const cache=new WorkshopStateCache();
  cache.accept(packet('old-runtime',20,[run('old-weld',[[0]])]));
  const current=cache.accept(packet('new-runtime',1,[run('new-weld',[[1]])]));
  assert.equal(cache.accept(packet('old-runtime',21,[run('old-weld',[[0],[2]])])),null);
  assert.equal(cache.state,current);
  assert.deepEqual([...cache.traces.keys()],['new-weld']);
});

test('a missing segment leaves every cached trace and the accepted sequence unchanged',()=>{
  const cache=new WorkshopStateCache();
  const current=cache.accept(packet('runtime',1,[run('first',[[0]]),run('second',[[0]])]));
  assert.throws(()=>cache.accept(packet('runtime',2,[run('first',[[1]],1),run('second',[[3]],3)])),/缺段/);
  assert.equal(cache.state,current);
  assert.deepEqual(cache.traces.get('first'),[[0]]);
  assert.deepEqual(cache.traces.get('second'),[[0]]);
  const recovered=cache.accept(packet('runtime',3,[run('first',[[1]],1),run('second',[[1]],1)]));
  assert.deepEqual(recovered.objects[0].weld_runs.map(value=>value.points),[[[0],[1]],[[0],[1]]]);
});

test('a malformed replacement runtime is not committed or allowed to retire the live one',()=>{
  const cache=new WorkshopStateCache();
  cache.accept(packet('live',1,[run('weld',[[0]])]));
  assert.throws(()=>cache.accept(packet('replacement',1,[run('missing',[[9]],9)])),/缺段/);
  assert.deepEqual(cache.traces.get('weld'),[[0]]);
  assert.equal(cache.accept(packet('live',2,[run('weld',[[1]],1)])).sequence,2);
});
