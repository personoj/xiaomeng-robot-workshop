import {lessonById,lessonDuration,lessonFrame} from './principle-lessons.js';

// This clock knows nothing about workshop jobs, camera state, or the robot API.
export class PrincipleTimeline {
  constructor(){this.lesson=null;this.elapsed=0;this.status='idle';this.mode='automatic';this.generation=0;this.runId=null;}
  renewRun(){this.runId=`${Date.now()}-${++this.generation}`;}
  load(topic,{autoplay=true,mode='automatic'}={}){
    const lesson=lessonById(topic);
    if(!lesson)throw new Error('未知讲解主题：'+topic);
    if(!['automatic','narration'].includes(mode))throw new Error('无效的讲解时钟');
    this.lesson=lesson;this.elapsed=0;this.mode=mode;this.status=autoplay?'playing':'paused';this.renewRun();
    return this.snapshot();
  }
  tick(seconds){
    if(this.status!=='playing'||this.mode!=='automatic'||!Number.isFinite(seconds)||seconds<0)return false;
    this.elapsed=Math.min(lessonDuration(this.lesson),this.elapsed+seconds);
    if(this.elapsed>=lessonDuration(this.lesson))this.status='completed';
    return true;
  }
  seek(seconds){
    return this.position(seconds,true);
  }
  position(seconds,invalidate=false){
    if(!this.lesson||!Number.isFinite(seconds))throw new Error('没有可定位的讲解时间');
    if(invalidate&&this.mode==='narration')this.renewRun();
    this.elapsed=Math.max(0,Math.min(lessonDuration(this.lesson),seconds));
    if(this.elapsed>=lessonDuration(this.lesson))this.status='completed';
    else if(this.status==='completed')this.status='paused';
    return this.snapshot();
  }
  seekStep(index,progress=0){
    return this.position(this.stepTime(index,progress),true);
  }
  stepTime(index,progress){
    if(!this.lesson||!Number.isInteger(index)||index<0||index>=this.lesson.steps.length||!Number.isFinite(progress)||progress<0||progress>1)throw new Error('无效的讲解步骤');
    return this.lesson.steps.slice(0,index).reduce((n,s)=>n+s.seconds,0)+this.lesson.steps[index].seconds*progress;
  }
  sync({runId,step,progress=0,elapsed}){
    if(!this.lesson||runId!==this.runId||this.mode!=='narration')return {accepted:false,reason:'stale_or_automatic_lesson'};
    // A TTS adapter must respect pause; late audio callbacks cannot resume the lesson.
    if(this.status!=='playing')return {accepted:false,reason:'lesson_not_playing'};
    if(elapsed!==undefined&&(!Number.isFinite(elapsed)||elapsed<0))throw new Error('无效的音频时间');
    const time=elapsed===undefined?this.stepTime(step,progress):Math.min(elapsed,lessonDuration(this.lesson));
    if(time<this.elapsed)return {accepted:false,reason:'out_of_order_cue'};
    this.position(time);
    return {accepted:true,...this.snapshot()};
  }
  pause(){if(this.status==='playing'){this.status='paused';if(this.mode==='narration')this.renewRun();}return this.snapshot();}
  resume(){
    if(!this.lesson)return this.snapshot();
    if(this.status==='completed')return this.load(this.lesson.id,{mode:this.mode});
    this.status='playing';return this.snapshot();
  }
  stop(){this.lesson=null;this.status='idle';this.elapsed=0;this.runId=null;return this.snapshot();}
  snapshot(){
    if(!this.lesson)return {status:'idle',topic:null,runId:null,elapsed:0,duration:0};
    const frame=lessonFrame(this.lesson,this.elapsed);
    return {topic:this.lesson.id,title:this.lesson.title,runId:this.runId,status:this.status,mode:this.mode,elapsed:this.elapsed,duration:lessonDuration(this.lesson),step:frame.index,stepId:frame.step.id,progress:frame.progress,narration:frame.step.speech,caption:frame.step.caption};
  }
}
