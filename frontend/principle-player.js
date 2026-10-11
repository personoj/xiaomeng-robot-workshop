import {LESSONS,lessonById,lessonFrame} from './principle-lessons.js';
import {PrincipleTimeline} from './principle-timeline.js';
import {drawPrinciple} from './principle-diagrams.js';
import {drawPrincipleTimeline,principleTransitionAt} from './principle-compositor.js';
import './principle-player.css';

const LABELS={coordinates:['参照系','旋转','平移','变换链'],inverse_kinematics:['正解','误差','迭代','多解'],pointnet:['点集','采样','分组','聚合'],planning:['碰撞','间隙','搜索','验证']};
const fmt=n=>Math.floor(n/60)+':'+String(Math.floor(n%60)).padStart(2,'0');
export class PrinciplePlayer {
  constructor(root,{onChange=()=>{}}={}){
    Object.assign(this,{root,onChange,timeline:new PrincipleTimeline(),lastStep:'',lastTime:null,disposed:false,skipBefore:-1,source:'browser',audioEpoch:0,audioMessage:'',externalTarget:0});
    this.audio=new Audio();this.audio.preload='auto';root.classList.add('principle-player');
    root.innerHTML='<header class="principle-heading"><svg class="principle-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7v14M3 3h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5v17h-5a4 4 0 0 0-4 1 4 4 0 0 0-4-1H3z"/></svg><h2>原理讲解</h2><span class="principle-status"></span></header><div class="principle-board"><div class="principle-intro"><div class="principle-kicker"><span class="principle-number">01</span><span class="principle-eyebrow"></span><i></i></div><h3 class="principle-title"></h3></div><div class="principle-figure"><canvas role="img" aria-label="机器人原理讲解示意"></canvas></div><div class="principle-formula" aria-label="本步公式"></div><div class="principle-reading"><p class="principle-caption"></p></div><ol class="principle-chapters" aria-label="讲解章节"></ol><div class="principle-playback"><span class="principle-clock"></span><span class="principle-audio-status"></span></div></div><footer class="principle-footer"><span>原理示意 · 机器人继续工作</span><a class="principle-source" target="_blank" rel="noopener">原理出处 ↗</a></footer>';
    this.audio.hidden=true;root.appendChild(this.audio);
    this.el=s=>root.querySelector(s);this.canvas=this.el('canvas');this.ctx=this.canvas.getContext('2d');
    this.resize=new ResizeObserver(()=>{this.fitFormula();this.draw();});this.resize.observe(root);this.reduced=matchMedia('(prefers-reduced-motion: reduce)');
    this.audio.addEventListener('ended',()=>{if(this.source==='browser'&&this.timeline.status==='playing')this.sync({runId:this.timeline.runId,elapsed:this.snapshot().duration});});
    this.audio.addEventListener('error',()=>{if(this.source==='browser'&&this.timeline.lesson){this.pause();this.audioMessage='音频未能载入';this.render();}});
    this.animate=now=>{
      if(this.disposed)return;
      const dt=this.lastTime===null?0:Math.min(.1,(now-this.lastTime)/1000);this.lastTime=now;
      let changed=this.timeline.tick(dt);
      if(this.source==='browser'&&this.timeline.status==='playing'&&!this.audio.paused&&!this.audio.seeking){
        const time=this.audio.currentTime;
        if(time!==this.timeline.elapsed)changed=this.timeline.sync({runId:this.timeline.runId,elapsed:time}).accepted;
      }
      if(this.source==='external'&&this.timeline.status==='playing'&&this.externalTarget>this.timeline.elapsed){
        // Approach only speaker-acknowledged samples, never extrapolate ahead.
        const time=Math.min(this.externalTarget,this.timeline.elapsed+Math.max(dt,(this.externalTarget-this.timeline.elapsed)*dt*12));
        changed=this.timeline.sync({runId:this.timeline.runId,elapsed:time}).accepted;
      }
      if(changed){this.render();this.draw();}
      this.frame=requestAnimationFrame(this.animate);
    };
    this.render();this.draw();this.frame=requestAnimationFrame(this.animate);
  }
  notify(type){const detail={type,...this.snapshot()};this.onChange(detail);this.root.dispatchEvent(new CustomEvent('principle:state',{detail,bubbles:true}));}
  start(topic,{autoplay=true,mode='audio'}={}){
    this.audioEpoch++;this.audio.pause();this.source=mode==='audio'?'browser':mode==='narration'?'external':'silent';this.externalTarget=0;this.audioMessage='';
    this.timeline.load(topic,{autoplay,mode:mode==='automatic'?'automatic':'narration'});this.skipBefore=-1;this.lastTime=null;this.lastStep='';
    if(this.source==='browser'){
      const url=this.timeline.lesson.audio;
      if(url){this.audio.src=url;this.audio.load();if(autoplay)this.playAudio();}
      else{this.timeline.pause();this.audioMessage='讲解音频准备中';}
    }
    this.render();this.draw();this.notify('start');return this.snapshot();
  }
  async playAudio(){
    const epoch=this.audioEpoch;
    try{await this.audio.play();if(epoch===this.audioEpoch){this.audioMessage='';this.render();}}
    catch(error){if(epoch!==this.audioEpoch||error.name==='AbortError')return;this.timeline.pause();this.audioMessage=error.name==='NotAllowedError'?'点击播放，开启声音':'音频未能播放';this.render();this.notify('pause');}
  }
  pause(){
    this.audioEpoch++;this.audio.pause();
    if(this.source==='browser'&&this.timeline.status==='playing')this.timeline.sync({runId:this.timeline.runId,elapsed:this.audio.currentTime});
    this.timeline.pause();this.render();this.draw();this.notify('pause');return this.snapshot();
  }
  resume(){
    if(this.timeline.status==='completed')return this.start(this.timeline.lesson.id,{mode:this.source==='browser'?'audio':this.source==='external'?'narration':'automatic'});
    this.timeline.resume();this.lastTime=null;
    if(this.source==='browser'){this.audio.currentTime=this.timeline.elapsed;this.playAudio();}
    this.render();this.draw();this.notify('resume');return this.snapshot();
  }
  stop(){this.audioEpoch++;this.audio.pause();this.audio.removeAttribute('src');this.audio.load();this.timeline.stop();this.lastStep='';this.externalTarget=0;this.audioMessage='';this.render();this.draw();this.notify('stop');return this.snapshot();}
  seek(seconds){this.timeline.seek(seconds);this.skipBefore=this.timeline.elapsed;if(this.source==='browser'&&this.audio.src)this.audio.currentTime=this.timeline.elapsed;this.externalTarget=this.timeline.elapsed;this.render();this.draw();this.notify('seek');return this.snapshot();}
  seekStep(index,progress=0){return this.seek(this.timeline.stepTime(index,progress));}
  sync(update){const result=this.timeline.sync(update);if(result.accepted){this.render();this.draw();}return result;}
  speakerProgress(elapsed,{complete=false}={}){if(this.source!=='external'||this.timeline.status!=='playing')return;this.externalTarget=Math.max(this.externalTarget,elapsed);if(complete)this.sync({runId:this.timeline.runId,elapsed:this.snapshot().duration});}
  snapshot(){return this.timeline.snapshot();}
  script(topic=this.timeline.lesson?.id){const lesson=lessonById(topic);if(!lesson)throw new Error('未知讲解主题');return {topic:lesson.id,title:lesson.title,audio:lesson.audio,voice:lesson.voice,steps:lesson.steps.map(({id,title,speech,seconds,beats},index)=>({index,id,title,speech,seconds,beats})),source:lesson.source};}
  render(){
    const s=this.snapshot(),lesson=this.timeline.lesson||lessonById('pointnet'),frame=s.topic?lessonFrame(lesson,s.elapsed):{step:lesson.steps[2],index:2},signature=[s.topic,s.step??0,s.runId].join(':');
    this.root.dataset.topic=s.topic||'idle';this.root.dataset.status=s.status;this.root.dataset.step=String(s.step??-1);this.root.dataset.progress=String(s.progress??0);
    this.el('.principle-status').textContent=({idle:'随时开讲',playing:'讲解中',paused:'已暂停',completed:'讲解完成'})[s.status];
    this.el('.principle-clock').textContent=s.topic?fmt(s.elapsed)+' / '+fmt(s.duration):'四个主题 · 随问随讲';
    this.el('.principle-audio-status').textContent=this.audioMessage||(s.status==='playing'?(this.source==='external'?'小萌正在讲解':this.source==='browser'?'小萌原声':'静音预览'):'');
    const opacity=s.topic?principleTransitionAt(lesson,s.elapsed,{skipBefore:this.skipBefore}).contentOpacity:1;
    this.root.style.setProperty('--chapter-presence',String(opacity));
    if(signature!==this.lastStep){
      this.lastStep=signature;this.el('.principle-number').textContent=String(LESSONS.indexOf(lesson)+1).padStart(2,'0');this.el('.principle-eyebrow').textContent=lesson.title;
      this.el('.principle-title').replaceChildren(document.createTextNode(frame.step.headline[0]+'，'),Object.assign(document.createElement('em'),{textContent:frame.step.headline[1]}));
      this.el('.principle-formula').innerHTML=frame.step.formula;this.el('.principle-formula').setAttribute('aria-label',frame.step.formulaLabel);this.el('.principle-caption').textContent=frame.step.caption;
      this.el('.principle-chapters').innerHTML=lesson.steps.map((step,i)=>'<li '+(i===frame.index?'aria-current="step"':'')+'><i><b></b></i><span>'+String(i+1).padStart(2,'0')+' '+LABELS[lesson.id][i]+'</span></li>').join('');
      const source=this.el('.principle-source');source.href=lesson.source.url;source.title=lesson.source.title;
      this.canvas.setAttribute('aria-label',lesson.title+'：'+frame.step.title+'。'+frame.step.caption);this.fitFormula();if(s.topic)this.notify('step');
    }
    this.el('.principle-chapters [aria-current] b')?.style.setProperty('width',(s.progress||0)*100+'%');
    if(s.status==='completed'&&this.lastStatus!=='completed')this.notify('complete');this.lastStatus=s.status;
  }
  fitFormula(){const host=this.el('.principle-formula'),math=host?.querySelector('math');if(!math)return;math.style.fontSize='';const max=host.clientWidth-24,width=math.getBoundingClientRect().width;if(width>max&&max>0)math.style.fontSize=parseFloat(getComputedStyle(math).fontSize)*max/width+'px';}
  draw(){
    const rect=this.canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2),w=Math.round(rect.width*dpr),h=Math.round(rect.height*dpr);
    if(!w||!h)return;if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
    const s=this.snapshot();
    if(this.timeline.lesson&&!this.reduced.matches)drawPrincipleTimeline(this.ctx,this.timeline.lesson,s.elapsed,{width:w,height:h,skipBefore:this.skipBefore});
    else drawPrinciple(this.ctx,s.topic||'pointnet',s.step??2,this.reduced.matches?1:s.progress??.65,{width:w,height:h});
  }
  dispose(){this.disposed=true;this.audioEpoch++;this.audio.pause();this.audio.removeAttribute('src');this.audio.load();cancelAnimationFrame(this.frame);this.resize.disconnect();}
}
export function attachPrincipleAPI(player,target=window){
  const api=Object.freeze({list:()=>LESSONS.map(({id,title,summary})=>({id,title,summary})),start:(topic,options)=>player.start(topic,options),pause:()=>player.pause(),resume:()=>player.resume(),stop:()=>player.stop(),seek:seconds=>player.seek(seconds),seekStep:(step,progress)=>player.seekStep(step,progress),sync:cue=>player.sync(cue),state:()=>player.snapshot(),script:topic=>player.script(topic)});
  target.xiaomengPrinciples=api;return ()=>{if(target.xiaomengPrinciples===api)delete target.xiaomengPrinciples;};
}
