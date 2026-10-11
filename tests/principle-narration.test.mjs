import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {LESSONS,lessonDuration,lessonFrame} from '../frontend/principle-lessons.js';
import {wavePCM} from '../frontend/principle-voice.js';
import {PrincipleTimeline} from '../frontend/principle-timeline.js';
test('recorded PCM, each spoken beat and full lesson have the same sample clock',async()=>{
 for(const lesson of LESSONS){
  const wav=await readFile(new URL('../frontend/public'+lesson.audio,import.meta.url));
  const pcm=wavePCM(wav.buffer.slice(wav.byteOffset,wav.byteOffset+wav.byteLength));
  assert.ok(Math.abs(pcm.length/48000-lessonDuration(lesson))<1/24000);
  let offset=0;
  for(const step of lesson.steps){
   assert.ok(Math.abs(step.beats.reduce((n,b)=>n+b.seconds,0)-step.seconds)<1/24000);
   let beatTime=0;
   for(let b=0;b<3;b++){
    const time=offset+beatTime+step.beats[b].seconds*.5;
    const frame=lessonFrame(lesson,time);
    assert.equal(frame.step.id,step.id);
    assert.ok(Math.abs(frame.beat.visualProgress-(b+.5)/3)<1e-10);
    beatTime+=step.beats[b].seconds;
   }
   offset+=step.seconds;
  }
 }
});
test('speaker time freezes without progress and stale samples cannot revive a paused or replaced lesson',()=>{
 const t=new PrincipleTimeline(),{runId}=t.load('coordinates',{mode:'narration'});
 t.sync({runId,elapsed:8});for(let i=0;i<120;i++)t.tick(1/60);
 assert.equal(t.snapshot().elapsed,8);
 t.pause();assert.equal(t.sync({runId,elapsed:12}).accepted,false);
 const fresh=t.load('planning',{mode:'narration'});
 assert.equal(t.sync({runId,elapsed:20}).accepted,false);
 t.sync({runId:fresh.runId,elapsed:fresh.duration});
 assert.equal(t.snapshot().status,'completed');
});

