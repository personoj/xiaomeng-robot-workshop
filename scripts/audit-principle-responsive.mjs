// Real-browser companion to audit-principle-annotations.mjs. Never infer DOM
// dimensions from the offline canvas audit. Requires a Chromium-capable host.
// node scripts/audit-principle-responsive.mjs --source=. --output=.local/readability
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const options=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),source=path.resolve(options.source||repo),output=path.resolve(options.output||'.local/principle-responsive');
const modules=path.join(repo,'node_modules');
const {LESSONS}=await import(pathToFileURL(path.join(source,'frontend/principle-lessons.js')));
await mkdir(output,{recursive:true});
const report={source,browser:null,deviceScaleFactor:1,zoom:1,viewports:[[1920,1080],[1440,900],[1280,720],[1080,720]],scope:'Actual studio and workshop principle-panel dimensions, 48 narration beat frames + 36 chapter transition frames per viewport. MathML token bounds, DOM clipping and canvas aspect ratio. Silent acknowledged-clock injections, not hardware/audio playback certification. Contact sheets still require visual review.',frames:[],errors:[],issues:[]};
let server,browser;
try{
 server=await createServer({configFile:false,root:path.join(source,'frontend'),cacheDir:path.join(output,'vite-cache'),resolve:{alias:[{find:/^three$/,replacement:modules+'/three/build/three.module.js'},{find:'three/addons',replacement:modules+'/three/examples/jsm'},{find:'three-mesh-bvh',replacement:modules+'/three-mesh-bvh/src/index.js'},{find:'lucide',replacement:modules+'/lucide/dist/esm/lucide.js'}]},server:{host:'127.0.0.1',port:0,fs:{allow:[path.dirname(source),repo]}}});await server.listen();
 const address=server.httpServer.address(),url=`http://127.0.0.1:${address.port}`;
 browser=await chromium.launch({executablePath:options.chromium||process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',chromiumSandbox:true});report.browser=browser.version();
 for(const[width,height]of report.viewports)for(const surface of ['workshop','studio']){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push({surface,width,height,message:e.message}));
  // No external network, voice server or model API is needed for layout QA.
  await page.route('**/*',route=>new URL(route.request().url()).origin===url?route.continue():route.abort());
  await page.goto(url+(surface==='studio'?'/principle-studio.html':'/'),{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.xiaomengPrinciples);await page.evaluate(()=>document.fonts.ready);
  for(const lesson of LESSONS){
   await page.evaluate(id=>window.xiaomengPrinciples.start(id,{autoplay:true,mode:'narration'}),lesson.id);
   const samples=[];let boundary=0;
   lesson.steps.forEach((step,index)=>{let offset=boundary;step.beats.forEach((beat,b)=>{samples.push({time:offset+beat.seconds*.6,kind:'beat',chapter:index+1,beat:b+1});offset+=beat.seconds;});if(index){for(const delta of[-1/30,.2,.5])samples.push({time:boundary+delta,kind:'transition',chapter:index+1,delta});}boundary+=step.seconds;});
   samples.sort((a,b)=>a.time-b.time);const captures=[];
   for(const sample of samples){
    await page.evaluate(time=>{const api=window.xiaomengPrinciples;api.sync({runId:api.state().runId,elapsed:time});},sample.time);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const metrics=await page.evaluate(()=>{
     const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
     const root=document.querySelector('.principle-player'),formula=root.querySelector('.principle-formula'),math=formula.querySelector('math');const fr=rect(formula);
     const tokens=[...math.querySelectorAll('*')].filter(e=>!e.children.length&&e.textContent.trim()).map(e=>({text:e.textContent,...rect(e)}));
     return {dpr:devicePixelRatio,zoom:visualViewport.scale,root:rect(root),board:rect(root.querySelector('.principle-board')),figure:rect(root.querySelector('canvas')),formula:fr,math:rect(math),mathCount:formula.querySelectorAll('math').length,fontSize:getComputedStyle(math).fontSize,formulaOpacity:getComputedStyle(formula).opacity,tokens,clippedTokens:tokens.filter(r=>r.x<fr.x+10||r.right>fr.right-10||r.y<fr.y||r.bottom>fr.bottom),caption:rect(root.querySelector('.principle-caption'))};
    });
    const key=`${surface}-${width}x${height}-${lesson.id}-${sample.kind}-${sample.time.toFixed(3)}`,filename=key+'.png';
    await page.locator('.principle-player').screenshot({path:path.join(output,filename)});captures.push({filename,sample});
    report.frames.push({surface,width,height,topic:lesson.id,...sample,filename,metrics});
    if(metrics.clippedTokens.length||metrics.mathCount!==1)report.issues.push({key,type:'formula',clippedTokens:metrics.clippedTokens,mathCount:metrics.mathCount});
   }
   for(const kind of ['beat','transition']){
    const selected=captures.filter(c=>c.sample.kind===kind),images=await Promise.all(selected.map(c=>loadImage(path.join(output,c.filename))));const cellWidth=Math.max(...images.map(i=>i.width)),cellHeight=Math.max(...images.map(i=>i.height))+28,sheet=createCanvas(cellWidth*3,cellHeight*Math.ceil(images.length/3)),c=sheet.getContext('2d');
    images.forEach((image,i)=>{const x=i%3*cellWidth,y=Math.floor(i/3)*cellHeight;c.fillStyle='#edf3fb';c.fillRect(x,y,cellWidth,cellHeight);c.fillStyle='#172d4f';c.font='14px sans-serif';c.fillText(`${lesson.id} ${selected[i].sample.time.toFixed(3)}s`,x+8,y+20);c.drawImage(image,x,y+28);});
    await writeFile(path.join(output,`${surface}-${width}x${height}-${lesson.id}-${kind}-contact.png`),sheet.toBuffer('image/png'));
   }
  }
  await page.close();
 }
}catch(error){report.blocked=error.stack||String(error);process.exitCode=1;}
finally{await browser?.close();await server?.close();await writeFile(path.join(output,'responsive-audit.json'),JSON.stringify(report,null,2));}
if(report.issues.length)process.exitCode=1;
console.log(JSON.stringify({frames:report.frames.length,issues:report.issues.length,blocked:report.blocked?.split('\n')[0]},null,2));
