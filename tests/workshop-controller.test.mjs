import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoController, voiceActions } from '../frontend/workshop-controller.js';

const state={scene_id:'room',revision:9,id:'room',status:'idle',objects:[],capabilities:{},decision:{}};
const response=(body,status=200)=>({ok:status<400,status,json:async()=>body});

test('ambiguous references do not submit a physical command',async()=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(path)=>{calls.push(path);return response(path.endsWith('/state')?state:{resolved:false,message:'请补充编号'});};
  try{
    const result=await new DemoController().resolve('pick_place','把蓝球放入红盘');
    assert.equal(result.needs_clarification,true);
    assert.equal(calls.filter(p=>p.endsWith('/command')).length,0);
  }finally{globalThis.fetch=original;}
});

test('a decision retains its original revision when the scene changes',async()=>{
  const original=globalThis.fetch;let reads=0,submitted;
  globalThis.fetch=async(path,options)=>{
    if(path.endsWith('/state'))return response({...state,revision:reads++?10:9});
    if(path.endsWith('/resolve'))return response({resolved:true,expected_revision:9,command:{action:'pick_place',source:'blue_ball_1',target:'red_tray_1'}});
    submitted=JSON.parse(options.body);return response({detail:'场景已改变'},409);
  };
  try{
    await assert.rejects(new DemoController().resolve('pick_place','蓝球1放入红盘1'),/场景已改变/);
    assert.equal(submitted.expected_revision,9);
  }finally{globalThis.fetch=original;}
});

test('a lost command receipt is unknown and never automatically retried',async()=>{
  const original=globalThis.fetch;let writes=0;
  globalThis.fetch=async(path)=>{
    if(path.endsWith('/state'))return response(state);
    writes++;throw new TypeError('connection lost');
  };
  try{
    const action=voiceActions(new DemoController(),()=>assert.fail('No completion receipt'))
      .find(a=>a.name==='bring_welding_robot');
    const result=await action.execute({},{callId:'voice-call-1',isCurrent:()=>true});
    assert.equal(result.result.outcome,'unknown');
    assert.equal(result.result.error,'workshop_outcome_unknown');
    assert.equal(writes,1);
  }finally{globalThis.fetch=original;}
});
