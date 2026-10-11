import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {LESSONS,lessonDuration,lessonFrame} from '../frontend/principle-lessons.js';
import {drawPrinciple} from '../frontend/principle-diagrams.js';
import {drawPrincipleTimeline,principleTransitionAt,CHAPTER_BLEND_SECONDS} from '../frontend/principle-compositor.js';

const pixels=canvas=>Buffer.from(canvas.getContext('2d').getImageData(0,0,600,430).data);
test('every chapter boundary begins with the outgoing final geometry, without a hard cut',()=>{
  const raw=createCanvas(600,430),mixed=createCanvas(600,430);
  for(const lesson of LESSONS){let boundary=0;for(let index=1;index<4;index++){
    boundary+=lesson.steps[index-1].seconds;
    drawPrinciple(raw.getContext('2d'),lesson.id,index-1,1);
    const frame=drawPrincipleTimeline(mixed.getContext('2d'),lesson,boundary,{createCanvas});
    assert.equal(frame.transition,true);assert.equal(frame.blend,0);
    assert.deepEqual(pixels(mixed),pixels(raw),`${lesson.id} boundary ${index}`);
  }}
});
test('a completed dissolve resolves exactly to current geometry and manual chapter seek stays precise',()=>{
  const raw=createCanvas(600,430),mixed=createCanvas(600,430);
  for(const lesson of LESSONS){const boundary=lesson.steps[0].seconds;
    drawPrinciple(raw.getContext('2d'),lesson.id,1,lessonFrame(lesson,boundary+CHAPTER_BLEND_SECONDS).beat.visualProgress);
    drawPrincipleTimeline(mixed.getContext('2d'),lesson,boundary+CHAPTER_BLEND_SECONDS,{createCanvas});
    assert.deepEqual(pixels(mixed),pixels(raw));
    drawPrinciple(raw.getContext('2d'),lesson.id,1,0);
    drawPrincipleTimeline(mixed.getContext('2d'),lesson,boundary,{createCanvas,skipBefore:boundary});
    assert.deepEqual(pixels(mixed),pixels(raw));
  }
});
test('chapter presence remains finite, bounded, deterministic and final diagrams remain visible',()=>{
  for(const lesson of LESSONS){
    for(let t=0;t<=lessonDuration(lesson);t+=.1){const a=principleTransitionAt(lesson,t),b=principleTransitionAt(lesson,t);assert.deepEqual(a,b);assert.ok(a.contentOpacity>=0&&a.contentOpacity<=1);assert.ok(a.blend>=0&&a.blend<=1);}
    assert.equal(principleTransitionAt(lesson,lessonDuration(lesson)).contentOpacity,1);
  }
});
