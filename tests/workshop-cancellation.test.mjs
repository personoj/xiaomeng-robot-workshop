import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const moduleUrl=process.env.WORKSHOP_CONTROLLER_MODULE
  ?pathToFileURL(process.env.WORKSHOP_CONTROLLER_MODULE).href
  :new URL('../frontend/workshop-controller.js',import.meta.url).href;
const {DemoController}=await import(moduleUrl);
const state={scene_id:'synthetic-room',revision:9,status:'idle',objects:[],capabilities:{},decision:{}};
const response=body=>({ok:true,status:200,json:async()=>body});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

test('BOOT cancellation during the state read never submits the old command',async()=>{
  const original=globalThis.fetch,read=deferred();let current=true,writes=0;
  globalThis.fetch=async(path)=>path.includes('/state')?read.promise:(writes++,response({state,accepted:false}));
  const controller=new DemoController();
  try{
    const result=controller.command('spawn',{kind:'ball',color:'blue'},{isCurrent:()=>current});
    current=false;read.resolve(response(state));
    await assert.rejects(result,/失效/);
    assert.equal(writes,0);
    assert.equal(controller.busy,false);
  }finally{globalThis.fetch=original;}
});

test('an already cancelled resolve performs no state or model request',async()=>{
  const original=globalThis.fetch;let reads=0;
  globalThis.fetch=async(path)=>(reads++,response(path.includes('/state')?state:{resolved:false,message:'clarify'}));
  try{
    await assert.rejects(new DemoController().resolve('pick_place','合成输入',{isCurrent:()=>false}),/失效/);
    assert.equal(reads,0);
  }finally{globalThis.fetch=original;}
});

test('cancellation during refresh skips the unnecessary decision-model request',async()=>{
  const original=globalThis.fetch,read=deferred();let current=true,decisions=0;
  globalThis.fetch=async(path)=>path.includes('/state')?read.promise:(decisions++,response({resolved:false,message:'clarify'}));
  try{
    const result=new DemoController().resolve('pick_place','合成输入',{isCurrent:()=>current});
    current=false;read.resolve(response(state));
    await assert.rejects(result,/失效/);
    assert.equal(decisions,0);
  }finally{globalThis.fetch=original;}
});

test('cancellation while the model is deciding cannot submit a command',async()=>{
  const original=globalThis.fetch,decision=deferred(),entered=deferred();let current=true,writes=0;
  globalThis.fetch=async(path)=>{
    if(path.includes('/state'))return response(state);
    if(path.endsWith('/resolve')){entered.resolve();return decision.promise;}
    writes++;return response({state,accepted:false});
  };
  try{
    const result=new DemoController().resolve('pick_place','合成输入',{isCurrent:()=>current});
    await entered.promise;current=false;
    decision.resolve(response({resolved:true,expected_revision:9,command:{action:'pick_place',source:'blue_ball_1',target:'red_tray_1'}}));
    await assert.rejects(result,/失效/);
    assert.equal(writes,0);
  }finally{globalThis.fetch=original;}
});
