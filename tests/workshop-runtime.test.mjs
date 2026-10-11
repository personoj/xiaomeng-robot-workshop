import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoController} from '../frontend/workshop-controller.js';

const state=(runtime,guard=true,sequence=1)=>({runtime_id:runtime,scene_id:'saved-scene',sequence,revision:9,status:'idle',objects:[],capabilities:guard?{runtime_identity_guard:true}:{},decision:{}});
const response=body=>({ok:true,status:200,json:async()=>body});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

for(const guarded of [false,true])test(`direct command negotiates runtime guarding with ${guarded?'new':'old'} server`,async()=>{
  const original=globalThis.fetch,snapshot=state('runtime',guarded);let submitted;
  globalThis.fetch=async(path,options)=>{
    if(path.endsWith('/state'))return response(snapshot);
    submitted=JSON.parse(options.body);return response({state:snapshot,accepted:false});
  };
  try{
    await new DemoController().command('spawn',{kind:'ball',color:'blue'});
    assert.equal(submitted.expected_revision,9);
    assert.equal(submitted.expected_runtime_id,guarded?'runtime':undefined);
    assert.equal(Object.hasOwn(submitted,'expected_runtime_id'),guarded);
  }finally{globalThis.fetch=original;}
});

for(const guarded of [false,true])test(`resolved command preserves originating ${guarded?'guarded':'legacy'} runtime contract`,async()=>{
  const original=globalThis.fetch,snapshot=state('runtime',guarded);let resolution,submitted;
  globalThis.fetch=async(path,options)=>{
    if(path.endsWith('/state'))return response(snapshot);
    if(path.endsWith('/resolve')){
      resolution=JSON.parse(options.body);
      return response({resolved:true,expected_revision:9,...(guarded?{expected_runtime_id:'runtime'}:{}),command:{action:'remove',object_id:'blue_ball_1'}});
    }
    submitted=JSON.parse(options.body);return response({state:snapshot,accepted:false});
  };
  try{
    await new DemoController().resolve('remove','合成输入');
    assert.equal(resolution.expected_runtime_id,guarded?'runtime':undefined);
    assert.equal(submitted.expected_runtime_id,guarded?'runtime':undefined);
  }finally{globalThis.fetch=original;}
});

test('first HTTP refresh cannot replace the newer runtime received over SSE',async()=>{
  const original=globalThis.fetch,read=deferred(),controller=new DemoController();
  globalThis.fetch=()=>read.promise;
  try{
    const pending=controller.refresh(),current=state('new-runtime');
    controller.acceptState(current);read.resolve(response(state('unseen-old-runtime')));
    assert.equal(await pending,current);
    assert.equal(controller.state,current);
  }finally{globalThis.fetch=original;}
});

test('a stream runtime change during command preflight rejects before POST',async()=>{
  const original=globalThis.fetch,read=deferred(),controller=new DemoController();let writes=0;
  globalThis.fetch=async(path)=>path.endsWith('/state')?read.promise:(writes++,response({state:state('old'),accepted:false}));
  try{
    const pending=controller.command('spawn',{kind:'ball',color:'blue'});
    controller.acceptState(state('new'));read.resolve(response(state('old')));
    await assert.rejects(pending,/失效/);
    assert.equal(writes,0);
    assert.equal(controller.state.runtime_id,'new');
  }finally{globalThis.fetch=original;}
});

test('an accepted old-runtime command receipt is returned without rewinding the new display',async()=>{
  const original=globalThis.fetch,write=deferred(),entered=deferred(),controller=new DemoController();
  globalThis.fetch=async(path)=>{
    if(path.endsWith('/state'))return response(state('old'));
    entered.resolve();return write.promise;
  };
  try{
    const pending=controller.command('spawn',{kind:'ball',color:'blue'});
    await entered.promise;controller.acceptState(state('new'));
    write.resolve(response({state:state('old'),accepted:false,created:{id:'blue_ball_3',spoken_name:'蓝色三号球'}}));
    assert.equal((await pending).created.id,'blue_ball_3');
    assert.equal(controller.state.runtime_id,'new');
  }finally{globalThis.fetch=original;}
});

for(const guarded of [false,true])test(`a ${guarded?'guarded':'legacy'} decision cannot cross a runtime change with reused revision`,async()=>{
  const original=globalThis.fetch,decision=deferred(),entered=deferred(),controller=new DemoController();let writes=0;
  globalThis.fetch=async(path)=>{
    if(path.endsWith('/state'))return response(state('old',guarded));
    if(path.endsWith('/resolve')){entered.resolve();return decision.promise;}
    writes++;return response({state:state('new',guarded),accepted:false});
  };
  try{
    const pending=controller.resolve('remove','蓝球1');
    await entered.promise;controller.acceptState(state('new',guarded));
    decision.resolve(response({resolved:true,expected_revision:9,...(guarded?{expected_runtime_id:'old'}:{}),command:{action:'remove',object_id:'blue_ball_1'}}));
    await assert.rejects(pending,/失效/);
    assert.equal(writes,0);
    assert.equal(controller.state.runtime_id,'new');
  }finally{globalThis.fetch=original;}
});

test('replaced and disposed EventSources cannot publish state or connection changes',async()=>{
  const original=globalThis.EventSource,streams=[],statuses=[],controller=new DemoController();
  globalThis.EventSource=class{constructor(){streams.push(this);}close(){this.closed=true;}};
  try{
    controller.connectStream(value=>statuses.push(value));
    controller.connectStream(value=>statuses.push(value));
    streams[1].onopen();streams[1].onmessage({data:JSON.stringify(state('new'))});
    streams[0].onerror();streams[0].onmessage({data:JSON.stringify(state('unseen-old'))});
    assert.equal(controller.streamConnected,true);
    assert.equal(controller.state.runtime_id,'new');
    assert.deepEqual(statuses,[true]);
    controller.dispose();streams[1].onopen();streams[1].onmessage({data:JSON.stringify(state('late'))});
    assert.equal(controller.streamConnected,false);
    assert.equal(controller.state.runtime_id,'new');
  }finally{globalThis.EventSource=original;controller.dispose();}
});

test('gap recovery started by an old stream cannot overwrite its replacement',async()=>{
  const oldSource=globalThis.EventSource,oldFetch=globalThis.fetch,streams=[],read=deferred();
  const controller=new DemoController();
  globalThis.EventSource=class{constructor(){streams.push(this);}close(){}};
  globalThis.fetch=()=>read.promise;
  try{
    controller.connectStream();streams[0].onmessage({data:'invalid JSON'});
    controller.connectStream();streams[1].onmessage({data:JSON.stringify(state('new'))});
    read.resolve(response(state('unseen-old')));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(controller.state.runtime_id,'new');
  }finally{globalThis.EventSource=oldSource;globalThis.fetch=oldFetch;controller.dispose();}
});
