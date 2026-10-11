import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoController,voiceActions,summarize} from '../frontend/demo-controller.js';

const state={id:'episode1',task:'transfer',status:'running',phase:'grasp',cycles:3,frame:{observation:{success:false,held:true}}};

test('state query reports observed facts without an error sentinel or starting an action',async()=>{
  const saved=globalThis.fetch;const calls=[];
  globalThis.fetch=async(path,options)=>{calls.push({path,options});return {ok:true,json:async()=>state};};
  try{const c=new DemoController();const action=voiceActions(c,()=>{}).find(a=>a.name==='get_robot_status');const output=await action.execute({});assert.equal(output.result.status,'running');assert.equal('error' in output.result,false);assert.equal(calls.length,1);assert.equal(calls[0].options.method,undefined);}finally{globalThis.fetch=saved;}
});

test('lost POST reply reports unknown so the harness cannot automatically repeat a mutation',async()=>{
  const saved=globalThis.fetch;
  globalThis.fetch=async(path,options)=>{if(options.method==='POST')throw new TypeError('connection lost');return {ok:true,json:async()=>state};};
  try{const c=new DemoController();c.state=state;const action=voiceActions(c,()=>{}).find(a=>a.name==='pause_robot_task');const output=await action.execute({},{callId:'call1',isCurrent:()=>true});assert.equal(output.result.outcome,'unknown');assert.equal(output.result.error,'robot_command_unconfirmed');}finally{globalThis.fetch=saved;}
});

test('a changed episode rejects an old intent before POST',async()=>{
  const saved=globalThis.fetch;let posts=0;
  globalThis.fetch=async(path,options)=>{if(options.method==='POST')posts++;return {ok:true,json:async()=>({...state,id:'episode2'})};};
  try{const c=new DemoController();c.state=state;await assert.rejects(c.command('reset','transfer'),/任务已变化/);assert.equal(posts,0);assert.equal(c.state.id,'episode2');}finally{globalThis.fetch=saved;}
});
