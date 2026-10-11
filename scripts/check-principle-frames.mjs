import {createCanvas,GlobalFonts,loadImage} from '@napi-rs/canvas';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {drawPrinciple} from '../frontend/principle-diagrams.js';
import {LESSONS,lessonDuration,lessonFrame} from '../frontend/principle-lessons.js';

// Offline Canvas verification only: this does not control or inspect a browser.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'.local','principle-frames');
GlobalFonts.registerFromPath('C:/Windows/Fonts/msyh.ttc','Microsoft YaHei');
await mkdir(out,{recursive:true});
const topics=['coordinates','inverse_kinematics','pointnet','planning'];
const args=process.argv.slice(2),fpsFlag=args.find(arg=>arg.startsWith('--timeline-fps='));
const timelineFps=fpsFlag?Number(fpsFlag.split('=')[1]):null,isTimeline=timelineFps!==null;
if(args.some(arg=>arg!=='--no-save-frames'&&!arg.startsWith('--timeline-fps='))||isTimeline&&(!Number.isInteger(timelineFps)||timelineFps<1||timelineFps>120))throw new Error('Usage: node scripts/check-principle-frames.mjs [--timeline-fps=30] [--no-save-frames]');
// Timeline mode preserves the existing 1,936 PNGs and contact sheets. Its
// complete pixel buffers are audited in memory rather than encoded to PNG.
const saveFrames=!isTimeline&&!args.includes('--no-save-frames'),fixedFrames=121,issues=[],results=[];
const started=performance.now();
let current,labels,primitives;
function auditContext(ctx){
  return new Proxy(ctx,{get(target,key){
    const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
    return (...args)=>{
      if(['arc','ellipse','moveTo','lineTo','fillRect','clearRect','roundRect'].includes(key)){
        const numeric=key==='arc'?args.slice(0,5):key==='ellipse'?args.slice(0,7):key==='roundRect'?args.slice(0,4):args;
        if(numeric.some(v=>typeof v!=='number'||!Number.isFinite(v)))issues.push({...current,type:'nonfinite',method:key,args});
        if(key==='arc'&&args[2]<0||key==='ellipse'&&(args[2]<0||args[3]<0))issues.push({...current,type:'negative-radius',method:key,args});
        if(key==='arc'&&args.length!==5)issues.push({...current,type:'arc-arity',args});
        if(key==='arc'){
          const [x,y,r,start,end]=args,angles=[start,end];
          for(let k=-8;k<=8;k++){const a=k*Math.PI/2;if(a>=start&&a<=end)angles.push(a);}
          const xs=angles.map(a=>x+r*Math.cos(a)),ys=angles.map(a=>y+r*Math.sin(a));
          if(Math.min(...xs)<0||Math.max(...xs)>600||Math.min(...ys)<0||Math.max(...ys)>430)issues.push({...current,type:'geometry-boundary',method:key,args});
        }
        if(['moveTo','lineTo'].includes(key)&&(args[0]<0||args[0]>600||args[1]<0||args[1]>430))issues.push({...current,type:'geometry-boundary',method:key,args});
        primitives++;
      }
      if(key==='fillText'){
        const [text,x,y]=args,m=target.measureText(text),left=x-m.actualBoundingBoxLeft,right=x+m.actualBoundingBoxRight,top=y-m.actualBoundingBoxAscent,bottom=y+m.actualBoundingBoxDescent;
        const b={text,left,right,top,bottom};labels.push(b);
        if(left<12||right>588||top<10||bottom>420)issues.push({...current,type:'text-boundary',...b});
      }
      return value.apply(target,args);
    };
  },set(target,key,value){return Reflect.set(target,key,value,target);}});
}
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
function auditPixels(ctx){
  const pixels=ctx.getImageData(0,0,600,430).data;
  let nonOpaquePixels=0,minChannel=255,maxChannel=0;
  for(let i=0;i<pixels.length;i+=4){
    if(pixels[i+3]!==255)nonOpaquePixels++;
    const value=pixels[i];if(value<minChannel)minChannel=value;if(value>maxChannel)maxChannel=value;
  }
  const contrast=maxChannel-minChannel;
  if(nonOpaquePixels)issues.push({...current,type:'pixel-alpha',nonOpaquePixels});
  if(contrast<40)issues.push({...current,type:'pixel-low-contrast',contrast});
  return {hash:digest(pixels),contrast,opaque:nonOpaquePixels===0};
}
for(const topic of topics){
  const lesson=LESSONS.find(item=>item.id===topic);let stepOffset=0;
  for(let step=0;step<lesson.steps.length;step++){
    const seconds=lesson.steps[step].seconds,frames=isTimeline?Math.ceil(seconds*timelineFps):fixedFrames;
    const dir=path.join(out,topic,String(step+1));if(saveFrames)await mkdir(dir,{recursive:true});
    const hashes=[],canvas=createCanvas(600,430),raw=canvas.getContext('2d'),ctx=auditContext(raw);
    let minPixelContrast=255,opaqueFrames=0;
    for(let f=0;f<frames;f++){
      const lessonTime=stepOffset+(isTimeline?f/timelineFps:f/(frames-1)*seconds),mapped=isTimeline?lessonFrame(lesson,lessonTime):null;
      current={topic,step:step+1,frame:f,progress:isTimeline?mapped.progress:f/(frames-1),...(isTimeline?{lessonTimeSeconds:lessonTime}:{})};labels=[];primitives=0;
      if(isTimeline&&mapped.index!==step)issues.push({...current,type:'timeline-step-mismatch',actualStep:mapped.index+1});
      try{drawPrinciple(ctx,topic,step,current.progress);}catch(error){issues.push({...current,type:'exception',message:error.message});continue;}
      for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){
        const a=labels[i],b=labels[j],w=Math.min(a.right,b.right)-Math.max(a.left,b.left),h=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
        if(w>1&&h>1)issues.push({...current,type:'text-overlap',a:a.text,b:b.text,width:w,height:h});
      }
      if(primitives<10)issues.push({...current,type:'sparse-render',primitives});
      if(isTimeline){const pixels=auditPixels(raw);hashes.push(pixels.hash);minPixelContrast=Math.min(minPixelContrast,pixels.contrast);if(pixels.opaque)opaqueFrames++;}
      else{const png=canvas.toBuffer('image/png');hashes.push(digest(png));if(saveFrames)await writeFile(path.join(dir,`${String(f).padStart(3,'0')}.png`),png);}
    }
    const last=hashes.at(-1);drawPrinciple(ctx,topic,step,1);const repeated=isTimeline?auditPixels(raw).hash:digest(canvas.toBuffer('image/png'));
    const finalQuarterHeld=hashes.slice(isTimeline?Math.ceil(frames*.75):90).every(v=>v===repeated);
    results.push({topic,step:step+1,...(isTimeline?{seconds,lessonStartSeconds:stepOffset,lessonEndSeconds:stepOffset+seconds,firstFrameSeconds:stepOffset,lastFrameSeconds:stepOffset+(frames-1)/timelineFps,pixelAudit:{opaqueFrames,minRedChannelContrast:minPixelContrast,allPixelsHashed:true}}:{}),frames:hashes.length,distinctFrames:new Set(hashes).size,deterministicFinal:last===repeated,finalQuarterHeld});
    if(last!==repeated)issues.push({topic,step:step+1,type:'nondeterministic-final'});
    // Recorded for historical comparisons only. A fixed quarter-step hold is
    // no longer a quality gate; rhythm and continuity use the motion audit.
    stepOffset+=seconds;
    if(isTimeline)console.log(`${topic} step ${step+1}: ${frames} frames audited (${(performance.now()-started).toFixed(0)} ms elapsed)`);
  }
}
// 48 representative frames: each topic has four rows and three time samples.
if(saveFrames){
for(const topic of topics){
  const sheet=createCanvas(1800,4*466),ctx=sheet.getContext('2d');ctx.fillStyle='#f1f5f9';ctx.fillRect(0,0,sheet.width,sheet.height);
  for(let step=0;step<4;step++)for(const [col,f] of [0,45,90].entries()){
    const png=await loadImage(path.join(out,topic,String(step+1),`${String(f).padStart(3,'0')}.png`));
    const x=col*600,y=step*466;ctx.fillStyle='#34455c';ctx.font='18px "Microsoft YaHei"';ctx.fillText(`${topic} · ${step+1} · ${(f/120*100).toFixed(1)}%`,x+12,y+24);ctx.drawImage(png,x,y+36);
  }
  await writeFile(path.join(out,`${topic}-contact.png`),sheet.toBuffer('image/png'));
}
const overview=createCanvas(1200,4*240),oc=overview.getContext('2d');oc.fillStyle='#f1f5f9';oc.fillRect(0,0,1200,960);
for(let row=0;row<topics.length;row++)for(let step=0;step<4;step++){
  const img=await loadImage(path.join(out,topics[row],String(step+1),'090.png'));
  oc.fillStyle='#34455c';oc.font='14px "Microsoft YaHei"';oc.fillText(`${topics[row]} · ${step+1}`,step*300+8,row*240+18);oc.drawImage(img,step*300,row*240+25,300,215);
}
await writeFile(path.join(out,'all-scenes.png'),overview.toBuffer('image/png'));
}
const grouped=new Map();for(const issue of issues){const key=[issue.topic,issue.step,issue.type,issue.a,issue.b,issue.text,issue.method].join('|');if(!grouped.has(key))grouped.set(key,{...issue,occurrences:0});grouped.get(key).occurrences++;}
const report={created:new Date().toISOString(),dimensions:[600,430],mode:isTimeline?'full-timeline':'fixed-progress',totalFrames:results.reduce((s,r)=>s+r.frames,0),...(isTimeline?{fps:timelineFps,totalDurationSeconds:LESSONS.reduce((sum,lesson)=>sum+lessonDuration(lesson),0),supplementalStepEndRenders:results.length,frameConvention:'Every actual lesson clock t=k/fps in [0,duration), mapped through lessonFrame(); each step end at progress=1 is additionally drawn and pixel-hashed. Adjacent steps share a timestamp but are not double-counted as timeline frames.',pngEvidencePreserved:true,pixelAudit:'Every full 600×430 RGBA frame is SHA-256 hashed; every pixel is checked for full opacity; each frame is checked for sufficient red-channel range. Hashes report final-quarter sameness only as a historical diagnostic, not a pass condition.'}:{samplesPerStep:fixedFrames}),elapsedSeconds:(performance.now()-started)/1000,results,issues:[...grouped.values()],scope:`Automated: actual Canvas rendering for ${isTimeline?'the complete lesson timeline at '+timelineFps+' fps':'16×121 fixed progress values'}, finite coordinates/radii, arc arity, arc and line canvas bounds, text ink bounds, text-to-text overlap, deterministic end frames. Final-quarter sameness is descriptive only, not a quality requirement. ${isTimeline?'Every timeline frame also undergoes complete pixel-buffer checks and hashing. Existing PNGs and contact sheets are preserved. ':''}Contact sheets contain 48 representative frames for separate human inspection. These checks do not prove every glyph avoids every geometry stroke or that every frame was visually inspected.`};
await writeFile(path.join(out,isTimeline?'full-timeline-audit.json':'audit.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({totalFrames:report.totalFrames,results,issueGroups:report.issues},null,2));
process.exitCode=issues.length?1:0;
