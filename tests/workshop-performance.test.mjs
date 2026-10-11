import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {PhysicsPose,PoseTimeline} from '../frontend/physics-pose.js';
import {WorkshopStateCache} from '../frontend/workshop-state.js';
import {DemoController,voiceActions} from '../frontend/workshop-controller.js';

const body=(id,parent,position,joints=[])=>({id,parent,position,quaternion:[1,0,0,0],mocap:-1,joints});
const hinge=address=>({type:3,address,reference:0,axis:[0,0,1],position:[0,0,0]});
const rig={bodies:[body(0,0,[0,0,0]),body(1,0,[0,0,0],[hinge(0)]),body(2,1,[1,0,0],[hinge(1)])]};
test('joint interpolation keeps the common joint and link lengths, freezes without extrapolation',()=>{
  const root=new T.Group(),pose=new PhysicsPose(root,rig),timeline=new PoseTimeline(rig,.07),tip=new T.Object3D();
  pose.attach(tip,{body:2,position:[1,0,0],quaternion:[1,0,0,0]});
  timeline.push({time:1,qpos:[0,0]},true,1000);timeline.push({time:1.1,qpos:[Math.PI/2,-Math.PI/2]},true,1100);
  const middle=timeline.sample(1120);pose.apply(middle);root.updateMatrixWorld(true);
  const joint=pose.nodes[2].getWorldPosition(new T.Vector3()),end=tip.getWorldPosition(new T.Vector3());
  assert.ok(Math.abs(joint.length()-1)<1e-12);assert.ok(Math.abs(end.distanceTo(joint)-1)<1e-12);
  assert.deepEqual(timeline.sample(9000).qpos,[Math.PI/2,-Math.PI/2]);
  timeline.push({time:1.1,qpos:[Math.PI/2,-Math.PI/2]},false,1200);
  assert.equal(timeline.pending(1200),false);
  assert.deepEqual(timeline.sample(1200).qpos,[Math.PI/2,-Math.PI/2]);
});
const packet=(sequence,points,start=0)=>({runtime_id:'run',scene_id:'room',sequence,objects:[{id:'panel_1',weld_runs:[{task_id:'weld',points,points_start:start}]}]});
test('stream deltas and full command replies merge without rewinding or duplicating weld metal',()=>{
  const cache=new WorkshopStateCache();cache.accept(packet(1,[[0],[1]]));
  assert.deepEqual(cache.accept(packet(3,[[2]],2)).objects[0].weld_runs[0].points,[[0],[1],[2]]);
  assert.equal(cache.accept(packet(2,[[0]])),null);
  cache.accept(packet(5,[[0],[1],[2],[3]]));
  assert.deepEqual(cache.accept(packet(6,[[3],[4]],3)).objects[0].weld_runs[0].points,[[0],[1],[2],[3],[4]]);
  assert.throws(()=>cache.accept(packet(7,[[8]],8)),/缺段/);
  cache.accept({...packet(1,[]),runtime_id:'restarted',objects:[]});assert.equal(cache.traces.size,0);
});
test('successful actions return before painting finishes, and a paint failure does not repeat an action',async()=>{
  const original=globalThis.fetch;let release,paints=0,errors=0,writes=0;
  const state={scene_id:'room',revision:1,status:'idle',objects:[],capabilities:{},decision:{}};
  const response=data=>({ok:true,json:async()=>data});
  globalThis.fetch=async(path)=>path.endsWith('/state')?response(state):(writes++,response({state,accepted:false}));
  try{
    const controller=new DemoController({onState:()=>{paints++;return new Promise(resolve=>{release=resolve;});},onError:()=>errors++});
    const result=await controller.command('spawn',{kind:'ball',color:'blue'});
    assert.equal(result.ok,true);assert.equal(paints,1);assert.equal(writes,1);release();await controller.rendering;
    controller.onState=()=>{throw new Error('GPU lost');};await controller.command('spawn',{kind:'ball',color:'blue'});await controller.rendering;
    assert.equal(errors,1);assert.equal(writes,2);
  }finally{globalThis.fetch=original;}
});
test('explicit spawn uses bounded tool parameters without a second decision-model request',async()=>{
  const calls=[],controller={state:{scene_id:'room',objects:[]},command:async(...args)=>{calls.push(args);return {ok:true};},resolve:()=>assert.fail('Unnecessary model request')};
  const action=voiceActions(controller,()=>{}).find(a=>a.name==='add_workshop_object');
  const result=await action.execute({kind:'ball',color:'blue'},{callId:'spawn-1',isCurrent:()=>true});
  assert.equal(result.result.ok,true);assert.equal(calls[0][0],'spawn');assert.deepEqual(calls[0][1],{kind:'ball',color:'blue'});
});
