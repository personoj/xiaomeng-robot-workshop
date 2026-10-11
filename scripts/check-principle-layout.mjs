import {createCanvas,GlobalFonts} from '@napi-rs/canvas';
import {writeFile,mkdir} from 'node:fs/promises';
import {LESSONS,lessonDuration,lessonFrame} from '../frontend/principle-lessons.js';
import {drawPrinciple} from '../frontend/principle-diagrams.js';
GlobalFonts.registerFromPath('C:/Windows/Fonts/msyh.ttc','Microsoft YaHei');
GlobalFonts.registerFromPath('C:/Windows/Fonts/cambria.ttc','Cambria Math');
const output='.local/principle-redesign';await mkdir(output,{recursive:true});
const canvas=createCanvas(600,430),raw=canvas.getContext('2d'),issues=[],summaries=[];
let current,labels=[];
const proxy=new Proxy(raw,{get(target,key){
 const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
 return (...args)=>{
  if(['arc','ellipse','moveTo','lineTo','translate','scale','bezierCurveTo','quadraticCurveTo'].includes(key)&&args.some(x=>typeof x==='number'&&!Number.isFinite(x)))
   issues.push({...current,type:'nonfinite',method:key});
  if(key==='fillText'&&target.globalAlpha>.2){
   const [text,x,y]=args,m=target.measureText(text),t=target.getTransform();
   const corners=[[x-m.actualBoundingBoxLeft,y-m.actualBoundingBoxAscent],[x+m.actualBoundingBoxRight,y+m.actualBoundingBoxDescent]].map(([u,v])=>[t.a*u+t.c*v+t.e,t.b*u+t.d*v+t.f]);
   const b={text,left:Math.min(...corners.map(p=>p[0])),right:Math.max(...corners.map(p=>p[0])),top:Math.min(...corners.map(p=>p[1])),bottom:Math.max(...corners.map(p=>p[1]))};
   if(b.left<5||b.right>595||b.top<5||b.bottom>425)issues.push({...current,type:'text-clipped',...b});labels.push(b);
  }
  return value.apply(target,args);
 };
},set(target,key,value){return Reflect.set(target,key,value,target);}});
for(const lesson of LESSONS){
 const count=Math.ceil(lessonDuration(lesson)*30);let stepEnd=0;
 for(let f=0;f<count;f++){
  const time=Math.min(f/30,lessonDuration(lesson)),frame=lessonFrame(lesson,time);current={topic:lesson.id,step:frame.index,time};labels=[];
  drawPrinciple(proxy,lesson.id,frame.index,frame.beat.visualProgress);
  for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){
   const a=labels[i],b=labels[j],w=Math.min(a.right,b.right)-Math.max(a.left,b.left),h=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
   if(w>2&&h>2)issues.push({...current,type:'text-overlap',a:a.text,b:b.text,width:w,height:h});
  }
 }
 const sheet=createCanvas(1800,1720),sc=sheet.getContext('2d');
 for(let s=0;s<4;s++){
  for(let j=0;j<3;j++){const time=stepEnd+lesson.steps[s].beats.slice(0,j).reduce((n,b)=>n+b.seconds,0)+lesson.steps[s].beats[j].seconds*.6;const frame=lessonFrame(lesson,time);
   drawPrinciple(raw,lesson.id,s,frame.beat.visualProgress);sc.drawImage(canvas,j*600,s*430);}
  stepEnd+=lesson.steps[s].seconds;
 }
 await writeFile(output+'/'+lesson.id+'-contact.png',sheet.toBuffer('image/png'));
 summaries.push({topic:lesson.id,frames:count,seconds:lessonDuration(lesson)});
 console.log(lesson.id+': '+count+' frames');
}
const grouped=new Map();
for(const issue of issues){const key=[issue.topic,issue.step,issue.type,issue.text,issue.a,issue.b,issue.method].join('|');if(!grouped.has(key))grouped.set(key,{...issue,occurrences:0,lastTime:issue.time});const row=grouped.get(key);row.occurrences++;row.lastTime=issue.time;}
const report={scope:'30fps actual narration clock, direct scene geometry, all finite primitives and visible text ink bounds/overlap. Pixel motion/transition audit is separate. Contact sheets contain 48 manually reviewable frames. Not an aesthetic certification.',summaries,issues:[...grouped.values()]};
await writeFile(output+'/layout-audit.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));process.exitCode=issues.length?1:0;

