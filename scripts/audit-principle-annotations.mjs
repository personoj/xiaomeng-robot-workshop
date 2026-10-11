// Offline geometric/ink audit. This is not a browser layout or occlusion certificate.
// Use --source=<repo> to compare an untouched snapshot and --output=<directory>.
import {createCanvas,GlobalFonts} from '@napi-rs/canvas';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const options=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const source=path.resolve(options.source||'.'),output=path.resolve(options.output||'.local/principle-annotations');
const fps=Number(options.fps||30);
if(!Number.isFinite(fps)||fps<=0||fps>60)throw new Error('Expected 0 < --fps <= 60');
await mkdir(output,{recursive:true});
const sourceHashes={};
for(const file of ['principle-diagrams.js','principle-compositor.js','principle-lessons.js','principle-narration.json','principle-math.js','principle-scenes/spatial.js','principle-scenes/spatial-kit.js','principle-scenes/cloud-planning.js','principle-scenes/cloud-kit.js'])sourceHashes[file]=createHash('sha256').update(await readFile(path.join(source,'frontend',file))).digest('hex');
const fonts=[];
for(const [file,family] of [['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc','Microsoft YaHei'],['/usr/share/texmf/fonts/opentype/public/lm-math/latinmodern-math.otf','Cambria Math']])if(existsSync(file)){GlobalFonts.registerFromPath(file,family);fonts.push({file,family});}
const {LESSONS,lessonDuration,lessonFrame}=await import(pathToFileURL(path.join(source,'frontend/principle-lessons.js')));
const {drawPrinciple}=await import(pathToFileURL(path.join(source,'frontend/principle-diagrams.js')));
const {drawPrincipleTimeline}=await import(pathToFileURL(path.join(source,'frontend/principle-compositor.js')));
const canvas=createCanvas(600,430),raw=canvas.getContext('2d'),issues=[],summaries=[];
let current,labels=[];
const proxy=new Proxy(raw,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return (...args)=>{
 if(['arc','ellipse','moveTo','lineTo','translate','scale','bezierCurveTo','quadraticCurveTo'].includes(key)&&args.some(x=>typeof x==='number'&&!Number.isFinite(x)))issues.push({...current,type:'nonfinite',method:key});
 if(key==='fillText'&&target.globalAlpha>.2){const [text,x,y]=args,m=target.measureText(text),t=target.getTransform();const corners=[[x-m.actualBoundingBoxLeft,y-m.actualBoundingBoxAscent],[x+m.actualBoundingBoxRight,y+m.actualBoundingBoxDescent]].map(([u,v])=>[t.a*u+t.c*v+t.e,t.b*u+t.d*v+t.f]);const b={text,left:Math.min(...corners.map(p=>p[0])),right:Math.max(...corners.map(p=>p[0])),top:Math.min(...corners.map(p=>p[1])),bottom:Math.max(...corners.map(p=>p[1]))};if(b.left<5||b.right>595||b.top<5||b.bottom>425)issues.push({...current,type:'text-clipped',...b});labels.push(b);}
 return value.apply(target,args);
};},set(target,key,value){return Reflect.set(target,key,value,target);}});
for(const lesson of LESSONS){
 const count=Math.ceil(lessonDuration(lesson)*fps);
 for(let f=0;f<count;f++){const time=f/fps,frame=lessonFrame(lesson,time);current={topic:lesson.id,step:frame.index,time};labels=[];drawPrinciple(proxy,lesson.id,frame.index,frame.beat.visualProgress);for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){const a=labels[i],b=labels[j],w=Math.min(a.right,b.right)-Math.max(a.left,b.left),h=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);if(w>2&&h>2)issues.push({...current,type:'text-overlap',a:a.text,b:b.text,width:w,height:h});}}
 const sheet=createCanvas(1800,4*460),sc=sheet.getContext('2d');let stepEnd=0;const captured=[];
 for(let s=0;s<4;s++){for(let j=0;j<3;j++){const time=stepEnd+lesson.steps[s].beats.slice(0,j).reduce((n,b)=>n+b.seconds,0)+lesson.steps[s].beats[j].seconds*.6;drawPrincipleTimeline(raw,lesson,time,{createCanvas});sc.fillStyle='#f1f5fb';sc.fillRect(j*600,s*460,600,30);sc.fillStyle='#152941';sc.font='16px sans-serif';sc.fillText(`${lesson.id} | chapter ${s+1} beat ${j+1} | ${time.toFixed(3)} s`,j*600+10,s*460+21);sc.drawImage(canvas,j*600,s*460+30);captured.push({step:s,beat:j,time});}stepEnd+=lesson.steps[s].seconds;}
 await writeFile(path.join(output,lesson.id+'-beats.png'),sheet.toBuffer('image/png'));
 const transitions=createCanvas(1800,3*460),tc=transitions.getContext('2d');let boundary=0;
 for(let s=1;s<4;s++){boundary+=lesson.steps[s-1].seconds;for(const [j,offset]of[-1/30,.2,.5].entries()){const time=boundary+offset;drawPrincipleTimeline(raw,lesson,time,{createCanvas});tc.fillStyle='#f1f5fb';tc.fillRect(j*600,(s-1)*460,600,30);tc.fillStyle='#152941';tc.font='16px sans-serif';tc.fillText(`chapter ${s} → ${s+1} | ${time.toFixed(3)} s`,j*600+10,(s-1)*460+21);tc.drawImage(canvas,j*600,(s-1)*460+30);}}
 await writeFile(path.join(output,lesson.id+'-transitions.png'),transitions.toBuffer('image/png'));
 summaries.push({topic:lesson.id,frames:count,seconds:lessonDuration(lesson),captured});console.log(`${lesson.id}: ${count} frames`);
}
const grouped=new Map();for(const issue of issues){const key=[issue.topic,issue.step,issue.type,issue.text,issue.a,issue.b,issue.method].join('|');if(!grouped.has(key))grouped.set(key,{...issue,occurrences:0,lastTime:issue.time});const row=grouped.get(key);row.occurrences++;row.lastTime=issue.time;}
const report={source,sourceHashes,node:process.version,fps,width:600,height:430,fonts,scope:'Offline Canvas visible text ink bounds/overlap and finite primitives. 48 beat + 36 transition contact frames, actual recorded narration timestamps. No DOM, browser or automatic geometry occlusion verdict. Visual review must be separately recorded.',summaries,issues:[...grouped.values()]};await writeFile(path.join(output,'annotation-audit.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report.issues,null,2));process.exitCode=issues.length?1:0;
