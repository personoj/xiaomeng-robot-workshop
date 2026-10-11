import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {performance as clock} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {installVoiceHarness} from './voice-performance-harness.mjs';

const self=fileURLToPath(import.meta.url),current=path.resolve(path.dirname(self),'..');
const arg=name=>process.argv[process.argv.indexOf(name)+1];
const quantiles=values=>{
  const sorted=[...values].sort((a,b)=>a-b),at=p=>sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)];
  return {count:sorted.length,p50:at(.5),p95:at(.95),p99:at(.99),max:sorted.at(-1)};
};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const readOptional=async file=>fs.readFile(file,'utf8').then(s=>s.trim()).catch(()=>null);

if(process.argv.includes('--worker')){
  const root=arg('--root'),scenario=arg('--scenario'),output=arg('--result');
  let initMs=0,detail;
  const initial=clock.now(),initialCpu=process.cpuUsage();
  if(scenario==='preflight'){
    // Same spec and cold Node/module process; OS file cache is deliberately not
    // flushed. Includes model/mesh loading and every planner safety substep.
    process.argv=[process.execPath,path.join(root,'scripts/plan-workshop-weld.mjs'),arg('--spec'),arg('--plan')];
    await import(pathToFileURL(process.argv[1]));
  }else if(scenario==='weld-pose'){
    const {loadWeldingModel}=await import(pathToFileURL(path.join(root,'scripts/welding-model-loader.mjs')));
    const model=await loadWeldingModel({renderCables:true,cableShapeCacheSize:0});
    const plan=JSON.parse(await fs.readFile(arg('--plan'),'utf8'));initMs=clock.now()-initial;
    const durations=[],results=[],started=clock.now(),cpu=process.cpuUsage();
    for(const frame of plan.frames){
      model.root.position.fromArray(frame.position);model.root.rotation.z=frame.heading;
      const begin=clock.now(),result=model.setPose(frame.pose,{endpointOnly:true});durations.push(clock.now()-begin);
      if(!result.ok)throw new Error(`${frame.phase}: ${result.reason}`);
      results.push({ok:result.ok,angles:result.angles,substeps:result.substeps});
    }
    detail={scope:'Node CPU replay of WorkshopScene pose/cable mesh update path; no DOM, renderer, GPU, network or animation scheduling',frames:plan.frames.length,displayCables:true,endpointOnly:true,workloadWallMs:clock.now()-started,workloadCpu:process.cpuUsage(cpu),poseUpdateMs:quantiles(durations),rawPoseUpdateMs:durations,resultsSha256:digest(results)};
  }else if(scenario==='idle-meter'){
    const {VoiceVisuals}=await import(pathToFileURL(path.join(root,'frontend/voice-visuals.js')));
    const h=installVoiceHarness();let meter;
    try{
      meter=new VoiceVisuals(h.canvas,h.bars,h.caption);initMs=clock.now()-initial;
      const started=clock.now(),cpu=process.cpuUsage();
      for(let i=0;i<18000;i++)h.step();
      detail={scope:'Deterministic DOM/scheduler double, 18,000 simulated 60Hz ticks; not elapsed browser seconds or FPS',...h.stats,workloadWallMs:clock.now()-started,workloadCpu:process.cpuUsage(cpu)};
    }finally{meter?.dispose();h.restore();}
  }else throw new Error('Unknown scenario');
  await fs.writeFile(output,JSON.stringify({scenario,root,totalWallMs:clock.now()-initial,totalCpu:process.cpuUsage(initialCpu),maxRssKiB:process.resourceUsage().maxRSS,initMs,...detail},null,2));
}else{
  if(!process.argv.includes('--baseline')||!process.argv.includes('--output'))throw new Error('Usage: node scripts/benchmark-workshop-performance.mjs --baseline /path/to/untouched/checkout --output /path/to/evidence [--runs 3]');
  const baseline=path.resolve(arg('--baseline')),output=path.resolve(arg('--output')),runs=process.argv.includes('--runs')?Number(arg('--runs')):3;
  if(!Number.isInteger(runs)||runs<1)throw new Error('runs must be a positive integer');
  await fs.mkdir(output,{recursive:true});
  const spec=path.join(current,'tests/fixtures/performance/weld-spec.json'),samples=[];
  const environment={node:process.version,platform:os.platform(),arch:os.arch(),kernel:os.release(),cpuModel:os.cpus()[0]?.model,hostLogicalCpus:os.cpus().length,availableParallelism:os.availableParallelism(),hostMemoryBytes:os.totalmem(),cpuMax:await readOptional('/sys/fs/cgroup/cpu.max'),memoryMax:await readOptional('/sys/fs/cgroup/memory.max'),baselineCommit:spawnSync('git',['rev-parse','HEAD'],{cwd:baseline,encoding:'utf8'}).stdout.trim(),conditions:'Serial alternating fresh Node processes, same machine/dependencies/spec. Cold module/model start, warm OS filesystem cache. CPU microbenchmarks, not browser frame metrics.'};
  const invoke=(root,label,scenario,run,plan)=>{
    const result=path.join(output,`${label}-${scenario}-${run}.json`),started=clock.now();
    const child=spawnSync(process.execPath,[self,'--worker','--root',root,'--scenario',scenario,'--result',result,'--spec',spec,'--plan',plan],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
    if(child.status!==0)throw new Error(`${label}/${scenario}/${run}: ${child.stderr||child.stdout}`);
    return {result,processWallMs:clock.now()-started};
  };
  let referencePlan;
  for(let run=1;run<=runs;run++)for(const [label,root] of run%2?[['baseline',baseline],['current',current]]:[['current',current],['baseline',baseline]]){
    const plan=path.join(output,`${label}-plan-${run}.json`);
    for(const scenario of ['preflight','weld-pose','idle-meter']){
      const sample=invoke(root,label,scenario,run,plan),data=JSON.parse(await fs.readFile(sample.result,'utf8'));
      samples.push({label,run,...data,processWallMs:sample.processWallMs});
      console.log(`${label} ${scenario} ${run}: ${data.totalWallMs.toFixed(1)} ms`);
    }
    const parsed=JSON.parse(await fs.readFile(plan,'utf8'));
    if(referencePlan&&JSON.stringify(referencePlan)!==JSON.stringify(parsed))throw new Error('Full before/after planner JSON diverged');
    referencePlan=parsed;
    await fs.writeFile(path.join(output,'results.json'),JSON.stringify({environment,runs,validation:{exactPlanEquality:true,planSha256:digest(referencePlan),...referencePlan.validation},samples},null,2));
  }
}
