import {createCanvas,GlobalFonts} from '@napi-rs/canvas';
import {mkdir,writeFile,readFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

// Read-only business review. Freeze inputs before rendering; preserve each run.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const label=process.argv.find(a=>a.startsWith('--label='))?.slice(8)||'baseline';
const compositor=process.argv.includes('--compositor');
const glyphOnly=process.argv.includes('--glyph-only');
if(!/^[a-zA-Z0-9_-]+$/.test(label))throw new Error('Invalid label');
const out=path.join(root,'.local/motion-review',label),source=path.join(out,'source');
await mkdir(source,{recursive:true});
const files=['principle-diagrams.js','principle-lessons.js','principle-narration.json','principle-math.js','principle-player.js','principle-timeline.js','principle-player.css','principle-scenes/spatial.js','principle-scenes/spatial-kit.js','principle-scenes/cloud-planning.js','principle-scenes/cloud-kit.js'];
if(compositor)files.push('principle-compositor.js');
const hashes={};
for(const name of files){
  const dest=path.join(source,name);
  await mkdir(path.dirname(dest),{recursive:true});
  // Baseline was frozen before edits; subsequent named runs freeze current code.
  let data;try{data=await readFile(dest);}catch{await copyFile(path.join(root,'frontend',name),dest);data=await readFile(dest);}
  hashes[name]=createHash('sha256').update(data).digest('hex');
}
const {drawPrinciple}=await import(pathToFileURL(path.join(source,'principle-diagrams.js')));
const {LESSONS,lessonDuration,lessonFrame}=await import(pathToFileURL(path.join(source,'principle-lessons.js')));
const timelineModule=compositor?await import(pathToFileURL(path.join(source,'principle-compositor.js'))):null;
GlobalFonts.registerFromPath('C:/Windows/Fonts/msyh.ttc','Microsoft YaHei');
const fps=30,width=600,height=430,channelThreshold=3,nearStaticPixelFraction=.0001;
const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');
const round=n=>Number(n.toFixed(6));
if(glyphOnly){
  // Actual glyph ink versus independently drawn geometry, not text rectangles.
  // Ignore the two whole-scene background fills; keep foreground strokes/nodes.
  const geometric=createCanvas(width,height),gc=geometric.getContext('2d'),ink=createCanvas(width,height),ic=ink.getContext('2d');
  const groups=new Map(),textTextGroups=new Map();let labels=[],backgrounds=0,current;
  const textContext=new Proxy(ctx,{get(target,key){
    const val=Reflect.get(target,key,target);if(typeof val!=='function')return val;
    return (...args)=>{if(key==='fillText'){
      const transform=target.getTransform();
      labels.push({text:args[0],x:args[1],y:args[2],font:target.font,textAlign:target.textAlign,textBaseline:target.textBaseline,alpha:target.globalAlpha,transform:[transform.a,transform.b,transform.c,transform.d,transform.e,transform.f]});
    }return val.apply(target,args);};
  },set(target,key,value){return Reflect.set(target,key,value,target);}});
  const geometryContext=new Proxy(gc,{get(target,key){
    const val=Reflect.get(target,key,target);if(typeof val!=='function')return val;
    return (...args)=>{
      if(key==='fillText')return;
      if(key==='fillRect'&&args[0]===0&&args[1]===0&&args[2]===600&&args[3]===430&&backgrounds++<2)return;
      return val.apply(target,args);
    };
  },set(target,key,value){return Reflect.set(target,key,['fillStyle','strokeStyle'].includes(key)?'#fff':key==='shadowBlur'?0:value,target);}});
  for(const lesson of LESSONS)for(let step=0;step<lesson.steps.length;step++){
    for(let f=0;f<=120;f++){
      const progress=f/120;current={topic:lesson.id,step:step+1,progress};labels=[];backgrounds=0;
      gc.setTransform(1,0,0,1,0,0);gc.clearRect(0,0,width,height);
      drawPrinciple(textContext,lesson.id,step,progress,{width,height});
      drawPrinciple(geometryContext,lesson.id,step,progress,{width,height});
      const geometry=gc.getImageData(0,0,width,height).data;
      const inks=[];
      for(const l of labels){
        if(l.alpha<.35||!l.text.trim())continue;
        ic.setTransform(1,0,0,1,0,0);ic.clearRect(0,0,width,height);ic.setTransform(...l.transform);ic.font=l.font;ic.textAlign=l.textAlign;ic.textBaseline=l.textBaseline;ic.fillStyle='#fff';ic.globalAlpha=l.alpha;ic.fillText(l.text,l.x,l.y);
        const m=ic.measureText(l.text),corners=[[l.x-m.actualBoundingBoxLeft,l.y-m.actualBoundingBoxAscent],[l.x+m.actualBoundingBoxRight,l.y-m.actualBoundingBoxAscent],[l.x-m.actualBoundingBoxLeft,l.y+m.actualBoundingBoxDescent],[l.x+m.actualBoundingBoxRight,l.y+m.actualBoundingBoxDescent]].map(([x,y])=>[l.transform[0]*x+l.transform[2]*y+l.transform[4],l.transform[1]*x+l.transform[3]*y+l.transform[5]]);
        const left=Math.max(0,Math.floor(Math.min(...corners.map(p=>p[0])))-1),right=Math.min(width,Math.ceil(Math.max(...corners.map(p=>p[0])))+1),top=Math.max(0,Math.floor(Math.min(...corners.map(p=>p[1])))-1),bottom=Math.min(height,Math.ceil(Math.max(...corners.map(p=>p[1])))+1);
        if(right<=left||bottom<=top)continue;
        const data=ic.getImageData(left,top,right-left,bottom-top).data;let overlappingPixels=0;
        inks.push({text:l.text,left,right,top,bottom,data});
        for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){const p=(y*width+x)*4+3,q=((y-top)*(right-left)+x-left)*4+3;if(geometry[p]>96&&data[q]>96)overlappingPixels++;}
        if(overlappingPixels<4)continue;
        const key=[lesson.id,step,l.text,l.font].join('|'),old=groups.get(key);
        if(old){old.lastProgress=progress;old.samples++;if(overlappingPixels>old.maxOverlappingPixels){old.maxOverlappingPixels=overlappingPixels;old.worstProgress=progress;}}
        else groups.set(key,{...current,text:l.text,font:l.font,firstProgress:progress,lastProgress:progress,worstProgress:progress,maxOverlappingPixels:overlappingPixels,samples:1,bounds:{left,right,top,bottom}});
      }
      for(let i=0;i<inks.length;i++)for(let j=i+1;j<inks.length;j++){
        const a=inks[i],b=inks[j],left=Math.max(a.left,b.left),right=Math.min(a.right,b.right),top=Math.max(a.top,b.top),bottom=Math.min(a.bottom,b.bottom);if(left>=right||top>=bottom)continue;
        let count=0;for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){if(a.data[((y-a.top)*(a.right-a.left)+x-a.left)*4+3]>96&&b.data[((y-b.top)*(b.right-b.left)+x-b.left)*4+3]>96)count++;}
        if(count<4)continue;const key=[lesson.id,step,a.text,b.text].join('|'),old=textTextGroups.get(key);
        if(old){old.lastProgress=progress;old.samples++;if(count>old.maxOverlappingPixels){old.maxOverlappingPixels=count;old.worstProgress=progress;}}
        else textTextGroups.set(key,{...current,a:a.text,b:b.text,firstProgress:progress,lastProgress:progress,worstProgress:progress,maxOverlappingPixels:count,samples:1});
      }
    }
  }
  const report={label,sourceHashes:hashes,method:'1936 raw-scene progress samples (121/step), each actual glyph alpha>96 intersects foreground geometry alpha>96; at least 4 pixels. Also measure actual glyph/glyph ink overlap at the same threshold. Labels with opacity<.35 ignored. Whole-scene background and point shadow ignored. Flagged ink intersection is a candidate, not automatic defect: inspect scene semantic intent. Composited transition text overlap inspected separately.',groups:[...groups.values()],textTextGroups:[...textTextGroups.values()]};
  await writeFile(path.join(out,'glyph-geometry.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));process.exit(0);
}
function difference(a,b){
  let sum=0,changed=0,roiSum=0,roiChanged=0,maxChannel=0;
  const tiles=new Array(30).fill(0),tilePixels=100*100;
  for(let p=0;p<width*height;p++){
    const i=p*4,x=p%width,y=Math.floor(p/width);
    const dr=Math.abs(a[i]-b[i]),dg=Math.abs(a[i+1]-b[i+1]),db=Math.abs(a[i+2]-b[i+2]);
    const d=dr+dg+db,m=Math.max(dr,dg,db);sum+=d;maxChannel=Math.max(maxChannel,m);
    if(m>channelThreshold)changed++;
    if(y>=60&&y<360){roiSum+=d;if(m>channelThreshold)roiChanged++;tiles[Math.floor((y-60)/100)*6+Math.floor(x/100)]+=d;}
  }
  return {meanRGB:round(sum/(width*height*3*255)),changedFraction:round(changed/(width*height)),roiMeanRGB:round(roiSum/(width*300*3*255)),roiChangedFraction:round(roiChanged/(width*300)),maxTileMeanRGB:round(Math.max(...tiles)/(tilePixels*3*255)),maxChannel};
}
const quant=(values,q)=>values.length?values.toSorted((a,b)=>a-b)[Math.ceil((values.length-1)*q)]:0;
function runs(rows,key){
  const found=[];let start=null;
  for(let i=0;i<=rows.length;i++){
    if(i<rows.length&&rows[i][key]){if(start===null)start=i;}
    else if(start!==null){const n=i-start;found.push({from:round(rows[start].time-1/fps),to:round(rows[i-1].time),seconds:round(n/fps)});start=null;}
  }
  return found;
}
const report={created:new Date().toISOString(),label,renderer:compositor?'drawPrincipleTimeline':'drawPrinciple',sourceHashes:hashes,method:{fps,width,height,channelThreshold,nearStaticPixelFraction,frameConvention:'t=k/30 in [0,duration); exact repeat=identical RGBA SHA256; near static=at most 0.01% pixels change any RGB channel by >3/255. Differences normalized RGB L1. Main ROI y=60..359; maximum local 100x100 tile, 6x3 tiles. DOM formulas excluded and reviewed independently. Static runs count adjacent intervals; endpoint frames are supplemental.'},topics:[],steps:[],boundaries:[]};
const csv=['topic,step,frame,time,progress,hash,exactRepeat,nearStatic,meanRGB,changedFraction,roiMeanRGB,roiChangedFraction,maxTileMeanRGB,maxChannel'];
for(const lesson of LESSONS){
  const duration=lessonDuration(lesson),count=Math.ceil(duration*fps),byStep=lesson.steps.map(()=>[]),all=[];
  let prev=null,prevHash=null,prevIndex=null;
  for(let f=0;f<count;f++){
    const time=f/fps,{index,progress}=lessonFrame(lesson,time);
    if(compositor)timelineModule.drawPrincipleTimeline(ctx,lesson,time,{width,height,createCanvas});
    else drawPrinciple(ctx,lesson.id,index,progress,{width,height});
    const pixels=ctx.getImageData(0,0,width,height).data;
    const hash=createHash('sha256').update(pixels).digest('hex');
    const d=prev?difference(prev,pixels):null;
    if(prev&&index!==prevIndex){
      const b={topic:lesson.id,time,fromStep:prevIndex+1,toStep:index+1,...d,exactRepeat:hash===prevHash,canvasTransition:compositor?'Shared time-based compositor; transition window checked separately':'Direct branch replacement; inspect frozen source for authored transition'};
      report.boundaries.push(b);
      const pair=createCanvas(width*2,height),pc=pair.getContext('2d');
      const old=createCanvas(width,height),oc=old.getContext('2d'),oldPixels=oc.createImageData(width,height);oldPixels.data.set(prev);oc.putImageData(oldPixels,0,0);
      pc.drawImage(old,0,0);pc.drawImage(canvas,width,0);
      await writeFile(path.join(out,`${lesson.id}-boundary-${prevIndex+1}-${index+1}.png`),pair.toBuffer('image/png'));
    }
    const row={time:round(time),progress:round(progress),hash,exactRepeat:hash===prevHash,nearStatic:d?d.changedFraction<=nearStaticPixelFraction:false,...(d||{})};
    all.push(row);if(prevIndex===index)byStep[index].push(row);
    csv.push([lesson.id,index+1,f,row.time,row.progress,hash,row.exactRepeat,row.nearStatic,row.meanRGB??'',row.changedFraction??'',row.roiMeanRGB??'',row.roiChangedFraction??'',row.maxTileMeanRGB??'',row.maxChannel??''].join(','));
    if(f%fps===0&&[0,1,2,3].includes(index)&&[0,.25,.5,.75].some(p=>Math.abs(progress-p)<.012))await writeFile(path.join(out,`${lesson.id}-${index+1}-${f}.png`),canvas.toBuffer('image/png'));
    prev=new Uint8ClampedArray(pixels);prevHash=hash;prevIndex=index;
  }
  // Save multiple times inside each authored transition, beyond exact boundary.
  if(compositor)for(let i=1,boundary=lesson.steps[0].seconds;i<lesson.steps.length;i++){
    const samples=[-1/fps,0,.1,.3,.625,1,1.25,1.5],sheet=createCanvas(width*4,height*2+56),sc=sheet.getContext('2d');
    sc.fillStyle='#edf1f4';sc.fillRect(0,0,sheet.width,sheet.height);
    for(let k=0;k<samples.length;k++){
      timelineModule.drawPrincipleTimeline(ctx,lesson,boundary+samples[k],{width,height,createCanvas});
      const x=(k%4)*width,y=Math.floor(k/4)*(height+28);sc.fillStyle='#243648';sc.font='17px "Microsoft YaHei"';sc.fillText(`${lesson.id} ${i}→${i+1} ${samples[k]>=0?'+':''}${round(samples[k])}s`,x+10,y+20);sc.drawImage(canvas,x,y+28);
    }
    await writeFile(path.join(out,`${lesson.id}-transition-${i}-${i+1}.png`),sheet.toBuffer('image/png'));
    boundary+=lesson.steps[i].seconds;
  }
  report.topics.push({topic:lesson.id,seconds:duration,frames:count,exactRepeatFraction:round(all.filter(r=>r.exactRepeat).length/(count-1)),nearStaticFraction:round(all.filter(r=>r.nearStatic).length/(count-1)),maxAdjacentMeanRGB:Math.max(...all.map(r=>r.meanRGB||0)),p95AdjacentMeanRGB:quant(all.map(r=>r.meanRGB||0),.95)});
  let offset=0;
  for(let i=0;i<byStep.length;i++){
    const rows=byStep[i],staticRuns=runs(rows,'exactRepeat'),nearRuns=runs(rows,'nearStatic');
    report.steps.push({topic:lesson.id,step:i+1,seconds:lesson.steps[i].seconds,start:offset,exactRepeatFraction:round(rows.filter(r=>r.exactRepeat).length/rows.length),nearStaticFraction:round(rows.filter(r=>r.nearStatic).length/rows.length),staticRunsOver1s:staticRuns.filter(r=>r.seconds>1),staticRunsOver2s:staticRuns.filter(r=>r.seconds>2),nearStaticRunsOver1s:nearRuns.filter(r=>r.seconds>1),maxMeanRGB:Math.max(...rows.map(r=>r.meanRGB)),p95MeanRGB:quant(rows.map(r=>r.meanRGB),.95),maxLocalTileMeanRGB:Math.max(...rows.map(r=>r.maxTileMeanRGB)),largestChanges:rows.toSorted((a,b)=>b.maxTileMeanRGB-a.maxTileMeanRGB).slice(0,8).map(({hash,...r})=>r)});
    offset+=lesson.steps[i].seconds;
  }
  console.log(`${lesson.id}: ${count} frames complete`);
}
await writeFile(path.join(out,'frames.csv'),csv.join('\n'));
await writeFile(path.join(out,'audit.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({label,topics:report.topics,steps:report.steps.map(({largestChanges,nearStaticRunsOver1s,...s})=>s),boundaries:report.boundaries},null,2));
