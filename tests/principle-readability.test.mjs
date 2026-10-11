import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {drawPrinciple} from '../frontend/principle-diagrams.js';
import {LESSONS,lessonFrame} from '../frontend/principle-lessons.js';
import {drawPrincipleTimeline,principleTransitionAt} from '../frontend/principle-compositor.js';
import {project} from '../frontend/principle-scenes/spatial-kit.js';

function instrument(context,inspect){
 return new Proxy(context,{get(target,key){const value=Reflect.get(target,key,target);return typeof value==='function'?(...args)=>{inspect(key,args,target);return value.apply(target,args);}:value;},set(target,key,value){return Reflect.set(target,key,value,target);}});
}

test('constrained render targets preserve uniform diagram, text and annulus scale',()=>{
 for(const [width,height]of[[600,430],[318,180],[318,400],[650,440],[636,360]]){
  const canvas=createCanvas(width,height),transforms=[];
  const ctx=instrument(canvas.getContext('2d'),(key,args)=>{if(key==='setTransform')transforms.push(args);});
  for(const lesson of LESSONS){
   transforms.length=0;drawPrinciple(ctx,lesson.id,3,.6,{width,height});
   const t=transforms.at(-1),scale=Math.min(width/600,height/430);
   assert.equal(t[0],scale);assert.equal(t[3],scale);
   assert.equal(t[4],(width-scale*600)/2);assert.equal(t[5],(height-scale*430)/2);
   assert.ok(t.every(Number.isFinite));
  }
 }
});

test('world-to-base label has a clear ink gutter from the world vertical axis throughout chapter 4',()=>{
 const raw=createCanvas(600,430).getContext('2d');let glyphs=[];
 const ctx=instrument(raw,(key,args,c)=>{if(key!=='fillText'||c.globalAlpha<.2)return;const[text,x,y]=args,m=c.measureText(text);glyphs.push({text,left:x-m.actualBoundingBoxLeft,right:x+m.actualBoundingBoxRight,top:y-m.actualBoundingBoxAscent,bottom:y+m.actualBoundingBoxDescent});});
 const axisX=project([-1.18,.52,0])[0];let seen=0;
 for(let frame=0;frame<=120;frame++){
  glyphs=[];drawPrinciple(ctx,'coordinates',3,frame/120);
  const i=glyphs.findIndex(g=>g.text==='BW');if(i<0)continue;
  const base=glyphs[i-1],sub=glyphs[i];assert.equal(base.text,'T');
  assert.ok(Math.max(base.right,sub.right)<=axisX-8,`T_BW touches z-axis at ${frame}/120`);seen++;
 }
 assert.ok(seen>40);
});

test('scaled transitions begin with outgoing pixels and end at the exact current geometry',()=>{
 for(const [width,height]of[[318,180],[318,400]]){
  const a=createCanvas(width,height),b=createCanvas(width,height),pixels=c=>Buffer.from(c.getContext('2d').getImageData(0,0,width,height).data);
  for(const lesson of LESSONS){let boundary=0;for(let index=1;index<4;index++){
   boundary+=lesson.steps[index-1].seconds;
   drawPrinciple(a.getContext('2d'),lesson.id,index-1,1,{width,height});
   drawPrincipleTimeline(b.getContext('2d'),lesson,boundary,{width,height,createCanvas});assert.deepEqual(pixels(b),pixels(a));
   const time=boundary+.7,frame=lessonFrame(lesson,time);
   drawPrinciple(a.getContext('2d'),lesson.id,index,frame.beat.visualProgress,{width,height});
   drawPrincipleTimeline(b.getContext('2d'),lesson,time,{width,height,createCanvas});assert.deepEqual(pixels(b),pixels(a));
  }}
 }
});

test('chapter text fades out before new formula presence and narration-derived chapter changes remain unchanged',()=>{
 for(const lesson of LESSONS){let boundary=0;for(let index=1;index<4;index++){
  boundary+=lesson.steps[index-1].seconds;
  const before=principleTransitionAt(lesson,boundary-.001),at=principleTransitionAt(lesson,boundary),after=principleTransitionAt(lesson,boundary+.001);
  assert.equal(before.index,index-1);assert.equal(at.index,index);assert.equal(at.contentOpacity,0);
  assert.ok(before.contentOpacity<1e-5);assert.ok(after.contentOpacity<1e-5);
 }}
});
