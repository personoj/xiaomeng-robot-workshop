// Deterministic scheduler/DOM-double harness. It measures JavaScript scheduling,
// not browser frame timing, rasterization, GPU work or real audio playback.
export function installVoiceHarness(){
  const saved=new Map(),rafs=new Map(),timers=new Map();let now=0,id=0,draws=0,writes=0,callbacks=0;
  const replace=(key,value)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});};
  replace('performance',{now:()=>now});
  replace('requestAnimationFrame',callback=>{const key=++id;rafs.set(key,callback);return key;});
  replace('cancelAnimationFrame',key=>rafs.delete(key));
  replace('setTimeout',(callback,delay)=>{const key=++id;timers.set(key,{callback,at:now+delay});return key;});
  replace('clearTimeout',key=>timers.delete(key));
  replace('ResizeObserver',class{constructor(callback){this.callback=callback;}observe(){this.callback();}disconnect(){}});
  replace('matchMedia',()=>({matches:false}));replace('devicePixelRatio',1);
  const dataset=()=>new Proxy({},{set(target,key,value){writes++;target[key]=value;return true;}});
  const ctx={setTransform(){},clearRect(){draws++;},beginPath(){},moveTo(){},lineTo(){},stroke(){}};
  const canvas={getContext:()=>ctx,getBoundingClientRect:()=>({width:240,height:64}),dataset:dataset()};
  const bars={children:Array.from({length:11},()=>({style:{}}))},caption={textContent:'',parentElement:{dataset:dataset()}};
  return {
    canvas,bars,caption,rafs,timers,
    get now(){return now;},get stats(){return {callbacks,draws,datasetWrites:writes,pendingFrames:rafs.size,pendingTimers:timers.size};},
    step(ms=1000/60){
      now+=ms;
      for(const [key,timer] of [...timers])if(timer.at<=now){timers.delete(key);timer.callback();}
      const queue=[...rafs.values()];rafs.clear();
      for(const callback of queue){callbacks++;callback(now);}
    },
    restore(){for(const [key,descriptor] of saved)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];},
  };
}
