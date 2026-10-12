import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {PrincipleVoice} from '../frontend/principle-voice.js';
import {PrincipleTimeline} from '../frontend/principle-timeline.js';

// Execute the production player methods in Node, omitting only its CSS import.
// This is a controllable media/clock harness, not browser/DOM or acoustic validation.
const playerURL = new URL('../frontend/principle-player.js', import.meta.url);
const source = (await readFile(playerURL, 'utf8')).replace(/^import '\.\/principle-player\.css';\r?\n/m, '')
  .replace(/from '(\.\/[^']+)'/g, (_, path) => `from '${new URL(path, playerURL).href}'`);
const {PrinciplePlayer} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const sdkURL = process.env.XIAOMENG_HARNESS_SDK ? pathToFileURL(process.env.XIAOMENG_HARNESS_SDK)
  : new URL('../../xiaoyun-realtime/web/client.js', import.meta.url);
const VoiceClient = existsSync(sdkURL) ? (await import(sdkURL)).VoiceClient : null;
const sdkOptions = {skip:!VoiceClient && 'Clone sibling xiaoyun-realtime to run the real SDK contract'};
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve=yes; reject=no; }); return {promise, resolve, reject}; };
const flush = async () => { for (let i=0; i<6; i++) await Promise.resolve(); };
const wave = () => {
  const buffer = new ArrayBuffer(46), bytes = new Uint8Array(buffer), view = new DataView(buffer);
  for (const [offset, value] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']]) [...value].forEach((c,i) => bytes[offset+i]=c.charCodeAt(0));
  view.setUint32(4,38,true); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,24000,true); view.setUint32(28,48000,true); view.setUint16(32,2,true); view.setUint16(34,16,true); view.setUint32(40,2,true);
  return buffer;
};
function fixture(t) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ok:true, arrayBuffer:async () => wave()});
  t.after(() => { globalThis.fetch = originalFetch; });
  const events = [], player = Object.create(PrinciplePlayer.prototype);
  Object.assign(player, {root:new EventTarget(), timeline:new PrincipleTimeline(), selectedTopic:'pointnet', source:'browser', audioEpoch:0, externalTarget:0, audioMessage:'', disposed:false, lastStep:'', audioPending:false,
    audio:{src:'', currentTime:0, paused:true, error:null, loadCount:0, playCount:0,
      pause() { this.paused=true; events.push('audio:pause'); },
      load() { this.currentTime=0; this.error=null; this.loadCount++; },
      removeAttribute(name) { if (name==='src') this.src=''; },
      async play() { this.paused=false; this.playCount++; events.push('audio:play'); },
    },
    render() {}, draw() {}, wake() {}, onChange() {}, resize:{disconnect() {}},
  });
  const originalCancel = globalThis.cancelAnimationFrame;
  globalThis.cancelAnimationFrame = () => {};
  t.after(() => { globalThis.cancelAnimationFrame = originalCancel; });
  const bridge = {prepared:[], cancelled:[],
    async prepareNarration(request) { this.prepared.push(request); },
    cancelNarration(id, callId) { this.cancelled.push({id,callId}); events.push('cancel:'+id); },
  };
  let connection = bridge;
  const voice = new PrincipleVoice(player, () => connection);
  t.after(() => voice.dispose());
  return {player, voice, bridge, events, replaceBridge:value => {connection=value;}};
}

function sdkFixture(t) {
  const fixtureValue = fixture(t);
  const client = new VoiceClient({baseURL:'http://offline.invalid', sessionId:'synthetic', role:'page'});
  client.send = () => {};
  client.registerActions(fixtureValue.voice.tools());
  client.addEventListener('event', ({detail}) => fixtureValue.voice.event(detail));
  const begin = async () => {
    await client.receive({type:'turn.started', turn:1, revision:1});
    await client.execute({call_id:'lesson-call', name:'show_principle_lesson', args:{topic:'coordinates'},
      expected_revision:1, turn:1, response_id:'source-response'});
    return client.completed.get('lesson-call').result;
  };
  return {...fixtureValue, client, begin};
}

test('real SDK scene revisions do not freeze admitted sample-clock narration', sdkOptions, async t => {
  const {player, voice, client, begin} = sdkFixture(t);
  const {narration_id:id} = await begin();
  const progress = seconds => client.receive({type:'narration.progress', narration_id:id, played_seconds:seconds});
  await progress(5);
  assert.equal(player.externalTarget,5);
  for (const [revision, context] of [[2,{view:3}], [3,{objects:[{id:'ball_9'}]}], [4,{status:'completed'}]]) {
    await client.receive({type:'context.updated', revision, context});
    await progress(5 + revision);
    assert.equal(player.externalTarget,5 + revision);
  }
  const duration=player.snapshot().duration;
  await client.receive({type:'narration.progress', narration_id:id, played_seconds:duration, completed:true});
  assert.equal(player.snapshot().elapsed,duration);
  assert.equal(player.snapshot().status,'completed');
  assert.equal(voice.active,null);
});

test('real SDK revision change during preparation still invalidates admission', sdkOptions, async t => {
  const {player, voice, bridge, client, begin} = sdkFixture(t), pending=deferred();
  bridge.prepareNarration = () => pending.promise;
  const preparation=begin(); await flush();
  await client.receive({type:'context.updated',revision:2,context:{view:3}});
  pending.resolve();
  assert.equal((await preparation).error,'narration_cancelled');
  assert.equal(voice.active,null);
  assert.equal(player.snapshot().status,'paused');
});

for (const interruption of ['turn', 'transport', 'session-stop', 'local-stop', 'connection-replaced'])
  test(`real SDK admitted narration still rejects late playback after ${interruption}`, sdkOptions, async t => {
    const {player, voice, client, begin, replaceBridge} = sdkFixture(t);
    const {narration_id:id} = await begin();
    await client.receive({type:'context.updated', revision:2, context:{view:3}});
    await client.receive({type:'narration.progress', narration_id:id, played_seconds:7});
    if (interruption==='turn') await client.receive({type:'turn.started',turn:2,revision:2});
    if (interruption==='transport') await client.receive({type:'transport.closed'});
    if (interruption==='session-stop') await client.receive({type:'state',state:'disconnected'});
    if (interruption==='local-stop') player.stop();
    if (interruption==='connection-replaced') replaceBridge({cancelNarration(){}});
    const before=player.snapshot(), target=player.externalTarget;
    await client.receive({type:'narration.progress',narration_id:id,played_seconds:59,completed:true});
    assert.deepEqual(player.snapshot(),before);
    assert.equal(player.externalTarget,target);
    if (interruption!=='connection-replaced') assert.equal(voice.active,null);
  });

for (const type of ['narration.stopped','narration.failed'])
  test(`real SDK ${type} still retires admitted narration after a scene update`, sdkOptions, async t => {
    const {player,voice,client,begin}=sdkFixture(t);
    const {narration_id:id}=await begin();
    await client.receive({type:'context.updated',revision:2,context:{view:3}});
    await client.receive({type,narration_id:id});
    assert.equal(voice.active,null);
    assert.equal(player.snapshot().status,'paused');
  });

test('local play, pause, resume, seek and replay keep the actual browser audio clock', async t => {
  const {player} = fixture(t);
  player.resume(); await flush();
  assert.equal(player.snapshot().topic, 'pointnet');
  player.audio.currentTime=7.125; player.pause();
  assert.equal(player.snapshot().elapsed, 7.125);
  player.resume(); await flush();
  assert.equal(player.audio.currentTime, 7.125);
  player.seek(23.2); assert.equal(player.audio.currentTime, 23.2);
  player.seek(player.snapshot().duration);
  assert.equal(player.snapshot().status, 'completed'); assert.equal(player.audio.paused, true);
  player.resume(); await flush();
  assert.equal(player.snapshot().elapsed, 0); assert.equal(player.audio.currentTime, 0);
  player.stop(); assert.equal(player.snapshot().status, 'idle');
});

for (const action of ['pause','seek','start','stop','dispose']) test(`external ${action} retires its captured source before local media can take over`, async t => {
  const {player,voice,bridge,events} = fixture(t);
  const accepted = await voice.begin('coordinates', {callId:'call-A'});
  const id = accepted.result.narration_id;
  voice.event({type:'narration.progress', narration_id:id, played_seconds:8.25});
  if (action==='seek') player.seek(12);
  else if (action==='start') player.start('planning');
  else player[action]();
  assert.equal(voice.active,null);
  assert.deepEqual(bridge.cancelled[0], {id,callId:'call-A'});
  if (action==='pause') { assert.equal(player.snapshot().elapsed,8.25); player.resume(); }
  await flush();
  const cancelIndex=events.indexOf('cancel:'+id), playIndex=events.indexOf('audio:play');
  if (playIndex>=0) assert.ok(cancelIndex<playIndex);
  const snapshot=player.snapshot();
  voice.event({type:'narration.progress', narration_id:id, played_seconds:30});
  voice.event({type:'narration.stopped', narration_id:id});
  voice.event({type:'narration.started', narration_id:id});
  assert.deepEqual(player.snapshot(), snapshot);
  if (action==='seek') { assert.equal(snapshot.source,'browser'); assert.equal(snapshot.status,'paused'); assert.equal(snapshot.elapsed,12); }
});

for (const stage of ['fetch','body','prepare']) for (const action of ['stop','replace','dispose','turn','transport','isCurrent']) test(`${action} during ${stage} never revives abandoned narration`, async t => {
  const {player,voice,bridge} = fixture(t), pending=deferred();
  let current=true, signal;
  if (stage==='fetch') globalThis.fetch=(_, options) => {signal=options.signal; return pending.promise;};
  if (stage==='body') globalThis.fetch=async(_, options) => {signal=options.signal; return {ok:true,arrayBuffer:() => pending.promise};};
  if (stage==='prepare') bridge.prepareNarration=request => {bridge.prepared.push(request); return pending.promise;};
  const result=voice.begin('coordinates',{callId:'old-call',isCurrent:() => current});
  await flush();
  if (action==='stop') player.stop();
  if (action==='replace') player.start('planning',{autoplay:false});
  if (action==='dispose') player.dispose();
  if (action==='turn') voice.event({type:'turn.started'});
  if (action==='transport') voice.event({type:'transport.closed'});
  if (action==='isCurrent') current=false;
  pending.resolve(stage==='fetch'?{ok:true,arrayBuffer:async() => wave()}:stage==='body'?wave():{});
  assert.equal((await result).result.error,'narration_cancelled');
  assert.equal(voice.active,null); assert.equal(voice.pending,null);
  assert.equal(bridge.prepared.length,stage==='prepare'?1:0);
  if (stage==='prepare') assert.ok(bridge.cancelled.length>=1);
  if (signal) assert.equal(signal.aborted,true);
  assert.notEqual(player.snapshot().status,'playing');
  if (action==='replace') assert.equal(player.snapshot().topic,'planning');
  if (action==='stop') assert.equal(player.snapshot().topic,null);
});

test('out-of-order topic preparation cannot replace newer narration or consume its late events', async t => {
  const {player,voice,bridge} = fixture(t), first=deferred(), second=deferred();
  bridge.prepareNarration=request => {bridge.prepared.push(request); return bridge.prepared.length===1?first.promise:second.promise;};
  const a=voice.begin('coordinates',{callId:'A'}); await flush();
  const b=voice.begin('planning',{callId:'B'}); await flush();
  second.resolve(); const fresh=await b;
  first.resolve(); assert.equal((await a).result.error,'narration_cancelled');
  const snapshot=player.snapshot();
  for (const type of ['narration.started','narration.progress','narration.stopped','narration.failed']) voice.event({type,narration_id:bridge.prepared[0].narrationId,played_seconds:30});
  assert.deepEqual(player.snapshot(), snapshot);
  assert.equal(voice.active.id, fresh.result.narration_id);
  assert.equal(snapshot.topic,'planning');
});

test('failed asset loading remains retryable; stale failure cannot overwrite newer browser playback', async t => {
  const {player,voice,bridge} = fixture(t);
  globalThis.fetch=async() => ({ok:false});
  assert.equal((await voice.begin('coordinates',{callId:'bad'})).result.error,'narration_unavailable');
  assert.equal(player.snapshot().status,'paused'); assert.equal(voice.cache.size,0);
  globalThis.fetch=async() => ({ok:true,arrayBuffer:async() => wave()});
  assert.equal((await voice.begin('coordinates',{callId:'retry'})).result.accepted,true);
  const late=deferred(); bridge.prepareNarration=() => late.promise;
  const abandoned=voice.begin('planning',{callId:'late'}); await flush();
  player.start('pointnet'); await flush();
  late.reject(new Error('old request failed'));
  assert.equal((await abandoned).result.error,'narration_cancelled');
  assert.equal(player.snapshot().topic,'pointnet'); assert.equal(player.snapshot().source,'browser');
  assert.equal(player.audioMessage,'');
});

test('browser autoplay rejection exposes real recovery, and late play rejection cannot pause replacement', async t => {
  const {player}=fixture(t);
  player.audio.play=async() => {throw Object.assign(new Error(),{name:'NotAllowedError'});};
  player.start('coordinates'); await flush();
  assert.equal(player.snapshot().status,'paused'); assert.match(player.audioMessage,/点击播放/);
  player.audio.play=async() => {};
  player.resume(); await flush(); assert.equal(player.snapshot().status,'playing'); assert.equal(player.audioMessage,'');
  const blocked=deferred(); player.audio.play=() => blocked.promise;
  player.start('planning');
  player.start('pointnet',{autoplay:false});
  blocked.reject(new Error('late error')); await flush();
  assert.equal(player.snapshot().topic,'pointnet'); assert.equal(player.audioMessage,'');
});

test('playback failure retries the existing local recording without losing its position', async t => {
  const {player}=fixture(t);
  player.start('coordinates',{autoplay:false}); player.seek(11.4);
  player.audio.play=async() => {throw Object.assign(new Error(),{name:'NotSupportedError'});};
  player.resume(); await flush(); assert.equal(player.audioRetry,true);
  const loads=player.audio.loadCount;
  player.audio.play=async() => {}; player.resume(); await flush();
  assert.equal(player.audio.loadCount,loads+1); assert.equal(player.audio.currentTime,11.4); assert.equal(player.audioRetry,false);
});

test('external samples cannot extrapolate or falsely complete a partial recording', async t => {
  const {player,voice}=fixture(t), {result}=await voice.begin('planning',{callId:'sample-clock'});
  voice.event({type:'narration.started',narration_id:result.narration_id});
  assert.equal(player.snapshot().elapsed,0);
  voice.event({type:'narration.progress',narration_id:result.narration_id,played_seconds:9,completed:true});
  assert.equal(player.snapshot().elapsed,9); assert.equal(player.snapshot().status,'playing');
  player.speakerProgress(4); assert.equal(player.externalTarget,9);
  player.speakerProgress(NaN); assert.equal(player.externalTarget,9);
  const duration=player.snapshot().duration;
  voice.event({type:'narration.progress',narration_id:result.narration_id,played_seconds:duration,completed:true});
  assert.equal(player.snapshot().status,'completed'); assert.equal(voice.active,null);
});

test('bridge replacement cancels on the original connection and invalidates pending playback', async t => {
  const {player,voice,bridge,replaceBridge}=fixture(t), pending=deferred();
  bridge.prepareNarration=request => {bridge.prepared.push(request); return pending.promise;};
  const result=voice.begin('coordinates',{callId:'captured'}); await flush();
  replaceBridge({cancelNarration:() => assert.fail('Must not cancel old narration through a new bridge')});
  pending.resolve(); assert.equal((await result).result.error,'narration_cancelled');
  assert.equal(bridge.cancelled.at(-1).callId,'captured'); assert.equal(player.snapshot().status,'paused');
});

test('a failed cancellation blocks overlap; an explicit retry can retire before takeover', async t => {
  const {player,voice,bridge}=fixture(t);
  await voice.begin('coordinates',{callId:'send-failure'});
  const cancel=bridge.cancelNarration;
  bridge.cancelNarration=() => {throw new Error('transport write failed');};
  player.start('planning');
  assert.equal(player.snapshot().topic,'coordinates'); assert.equal(player.snapshot().status,'paused');
  assert.equal(player.audio.playCount,0); assert.match(player.audioMessage,/停止未确认/);
  bridge.cancelNarration=cancel; player.resume(); await flush();
  assert.equal(player.snapshot().source,'browser'); assert.equal(player.audio.playCount,1);
  assert.equal(voice.unconfirmed.size,0);
});

test('stale stop tools cannot cancel a newer lesson', async t => {
  const {player,voice}=fixture(t);
  player.start('planning',{autoplay:false});
  const stop=voice.tools().find(tool => tool.name==='stop_principle_lesson');
  assert.equal((await stop.execute({}, {isCurrent:() => false})).result.error,'narration_cancelled');
  assert.equal(player.snapshot().topic,'planning');
});

test('stale execution after prepare retains a failed cancellation and blocks local takeover', async t => {
  const {player,voice,bridge}=fixture(t), pending=deferred(); let current=true;
  bridge.prepareNarration=() => pending.promise;
  const result=voice.begin('coordinates',{callId:'stale-send-failure',isCurrent:() => current}); await flush();
  current=false; bridge.cancelNarration=() => {throw new Error('send failed');}; pending.resolve();
  assert.equal((await result).result.error,'narration_cancelled');
  assert.equal(voice.unconfirmed.size,1); assert.equal(player.snapshot().status,'paused');
  assert.match(player.audioMessage,/停止未确认/);
  player.resume(); player.start('planning');
  assert.equal(player.snapshot().topic,'coordinates'); assert.equal(player.audio.playCount,0);
  const id=[...voice.unconfirmed][0].id;
  voice.event({type:'narration.stopped',narration_id:id});
  assert.equal(voice.unconfirmed.size,0);
  player.resume(); await flush();
  assert.equal(player.snapshot().source,'browser'); assert.equal(player.audio.playCount,1);
});

test('voice stop cancellation failure leaves a truthful paused and recoverable UI', async t => {
  const {player,voice,bridge}=fixture(t);
  await voice.begin('coordinates',{callId:'stop-failure'});
  bridge.cancelNarration=() => {throw new Error('send failed');};
  const result=await voice.tools().find(tool => tool.name==='stop_principle_lesson').execute({});
  assert.equal(result.result.error,'narration_stop_unconfirmed');
  assert.equal(player.snapshot().status,'paused'); assert.match(player.audioMessage,/停止未确认/);
  assert.equal(voice.unconfirmed.size,1);
});

test('live-region text is not mutated again when its value is unchanged', t => {
  const {player}=fixture(t); let writes=0, value='';
  player.el=() => ({get textContent() {return value;},set textContent(next) {writes++; value=next;}});
  for (let i=0;i<120;i++) player.setText('.principle-status','讲解中');
  assert.equal(writes,1);
  player.setText('.principle-status','已暂停'); assert.equal(writes,2);
});

// Minimal element doubles let the production constructor/RAF callbacks run.
// No layout, CSS accessibility, browser screenshot or real audio is inferred.
function constructorHarness(t) {
  class Element extends EventTarget {
    constructor() {super(); this.dataset={}; this.attributes={}; this.style={setProperty(){}}; this.classList={add(){}}; this.textContent='';}
    setAttribute(key,value) {this.attributes[key]=value;}
    removeAttribute(key) {delete this.attributes[key];}
    replaceChildren() {}
    appendChild(child) {this.child=child;}
    getBoundingClientRect() {return {width:0,height:0};}
    querySelector() {return null;}
  }
  class Audio extends Element {
    constructor() {super(); this.currentTime=0; this.paused=true; this.seeking=false; this.error=null; this.src='';}
    pause() {this.paused=true;}
    load() {this.currentTime=0; this.error=null;}
    async play() {this.paused=false;}
  }
  const root=new Element(), elements=new Map();
  const topics=['coordinates','inverse_kinematics','pointnet','planning'].map(topic => Object.assign(new Element(),{dataset:{lessonTopic:topic}}));
  const chapters=[0,1,2,3].map(i => {
    const element=new Element(), children={span:new Element(),b:new Element()};
    element.dataset.lessonStep=String(i); element.querySelector=selector => children[selector];
    return element;
  });
  root.querySelector=selector => {
    if (selector==='.principle-chapters [aria-current="step"] b') return chapters.find(el => el.attributes['aria-current']==='step')?.querySelector('b');
    if (!elements.has(selector)) elements.set(selector,new Element());
    return elements.get(selector);
  };
  root.querySelectorAll=selector => selector==='[data-lesson-topic]'?topics:chapters;
  root.querySelector('canvas').getContext=() => ({});
  let now=0, serial=0;
  const frames=new Map(), original={};
  const replacements={Audio, ResizeObserver:class {observe(){} disconnect(){}}, matchMedia:() => ({matches:false}),
    requestAnimationFrame:callback => {frames.set(++serial,callback); return serial;}, cancelAnimationFrame:id => frames.delete(id),
    document:{createTextNode:value => ({textContent:value}),createElement:() => new Element()}, devicePixelRatio:1};
  for (const [key,value] of Object.entries(replacements)) {original[key]=globalThis[key]; globalThis[key]=value;}
  const player=new PrinciplePlayer(root);
  t.after(() => {player.dispose(); for (const [key,value] of Object.entries(original)) {if (value===undefined) delete globalThis[key]; else globalThis[key]=value;}});
  return {player,topics,chapters,elements,frames,step(ms=16) {now+=ms;const tasks=[...frames.values()];frames.clear();tasks.forEach(callback => callback(now));}};
}

test('constructor transport works and RAF sleeps while idle, paused, or awaiting external samples', async t => {
  const h=constructorHarness(t), {player}=h;
  assert.equal(h.frames.size,0);
  h.topics[0].dispatchEvent(new Event('click')); await flush();
  assert.equal(player.snapshot().topic,'coordinates'); assert.equal(h.frames.size,1);
  player.audio.currentTime=4.75; h.step();
  assert.equal(player.snapshot().elapsed,4.75);
  // Even many animation frames cannot advance the browser clock on their own.
  for(let i=0;i<40;i++) h.step();
  assert.equal(player.snapshot().elapsed,4.75);
  h.elements.get('.principle-play').dispatchEvent(new Event('click')); h.step();
  assert.equal(player.snapshot().status,'paused'); assert.equal(h.frames.size,0);
  h.chapters[2].dispatchEvent(new Event('click'));
  assert.equal(player.snapshot().step,2);
  player.startNarration('planning'); h.step();
  assert.equal(player.snapshot().elapsed,0); assert.equal(h.frames.size,0);
  player.speakerProgress(2);
  assert.equal(h.frames.size,1);
  for(let i=0;i<200;i++) {h.step(); assert.ok(player.snapshot().elapsed<=2);}
  assert.equal(player.snapshot().elapsed,2); assert.equal(h.frames.size,0);
});

test('repeated pending Play/Pause clicks retire an old promise without reviving sound', async t => {
  const h=constructorHarness(t), pending=deferred();
  h.player.audio.play=() => pending.promise;
  h.elements.get('.principle-play').dispatchEvent(new Event('click'));
  assert.equal(h.player.snapshot().status,'playing');
  h.elements.get('.principle-play').dispatchEvent(new Event('click'));
  assert.equal(h.player.snapshot().status,'paused');
  pending.reject(new Error('retired playback')); await flush(); h.step();
  assert.equal(h.player.snapshot().status,'paused'); assert.equal(h.player.audioMessage,'');
  assert.equal(h.frames.size,0);
});

test('turn interruption preserves unconfirmed-stop feedback until transport closure', async t => {
  const {player,voice,bridge}=fixture(t);
  await voice.begin('coordinates',{callId:'turn-stop-failure'});
  bridge.cancelNarration=() => {throw new Error('send failed');};
  voice.event({type:'turn.started'});
  assert.equal(player.snapshot().status,'paused'); assert.match(player.audioMessage,/停止未确认/);
  assert.equal(voice.unconfirmed.size,1);
  voice.event({type:'transport.closed'});
  assert.equal(voice.unconfirmed.size,0); assert.match(player.audioMessage,/可在此继续/);
});
