import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {DemoController,voiceActions} from '../frontend/workshop-controller.js';

const sdkURL=process.env.XIAOMENG_HARNESS_SDK
  ?pathToFileURL(process.env.XIAOMENG_HARNESS_SDK)
  :new URL('../../xiaoyun-realtime/web/client.js',import.meta.url);
const hasSDK=existsSync(sdkURL);
const VoiceClient=hasSDK?(await import(sdkURL)).VoiceClient:null;
const response=body=>({ok:true,status:200,json:async()=>body});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const state={runtime_id:'runtime',scene_id:'scene',sequence:1,revision:9,status:'idle',objects:[],capabilities:{runtime_identity_guard:true},decision:{}};

// Page-only connections receive BOOT/stop via turn.started/state. audio.clear
// is extra SDK coverage for duplex clients or an explicitly forwarded event.
for(const interruption of ['BOOT','session-stop','forwarded-audio-clear'])for(const stage of ['direct-read','resolve-read','decision'])test(`real SDK ${interruption} event cancels workshop ${stage}`,{skip:!hasSDK&&'Clone sibling xiaoyun-realtime to run the cross-repository contract'},async()=>{
  const original=globalThis.fetch,blocked=deferred(),entered=deferred(),sent=[];let writes=0,decisions=0;
  const client=new VoiceClient({baseURL:'http://127.0.0.1:8766',sessionId:'synthetic',role:'page'});
  client.send=event=>sent.push(event);
  const controller=new DemoController();
  client.registerActions(voiceActions(controller,()=>assert.fail('Cancelled command must not be accepted')));
  globalThis.fetch=async(path)=>{
    if(path.endsWith('/state')){
      if(stage==='decision')return response(state);
      entered.resolve();return blocked.promise;
    }
    if(path.endsWith('/resolve')){decisions++;entered.resolve();return blocked.promise;}
    writes++;return response({state,accepted:false});
  };
  try{
    await client.receive({type:'turn.started',turn:1,revision:1,reason:'text'});
    await client.receive({type:'tool.request',turn:1,expected_revision:1,response_id:'synthetic-response',call_id:'synthetic-tool',name:'add_workshop_object',
      args:stage==='direct-read'?{kind:'ball',color:'blue'}:{request:'添加合成测试蓝球'}});
    await entered.promise;
    // BOOT press starts a new manual-audio turn before its later input.commit.
    await client.receive(interruption==='BOOT'?{type:'turn.started',turn:2,reason:'manual_audio'}
      :interruption==='session-stop'?{type:'state',state:'disconnected'}
      :{type:'audio.clear',response_ids:['synthetic-response']});
    blocked.resolve(response(stage==='decision'
      ?{resolved:true,expected_revision:9,expected_runtime_id:'runtime',command:{action:'spawn',kind:'ball',color:'blue'}}
      :state));
    await client.actionChain;
    assert.equal(writes,0);
    assert.equal(decisions,stage==='decision'?1:0);
    const result=sent.find(event=>event.type==='tool.result');
    assert.equal(result.result.error,'workshop_command_rejected');
    assert.equal(client.turn,interruption==='BOOT'?2:1);
    assert.deepEqual(client.context,{});
  }finally{globalThis.fetch=original;}
});
