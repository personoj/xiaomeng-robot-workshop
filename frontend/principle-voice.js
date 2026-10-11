import {LESSONS,lessonById} from './principle-lessons.js';

// WAV parsing stays local. No audio URL or binary payload is sent to the model.
export function wavePCM(buffer){
  const view=new DataView(buffer),bytes=new Uint8Array(buffer),tag=o=>String.fromCharCode(...bytes.slice(o,o+4));
  if(tag(0)!=='RIFF'||tag(8)!=='WAVE')throw new Error('无效讲解音频');
  let format=false,pcm=null;
  for(let p=12;p+8<=bytes.length;){
    const size=view.getUint32(p+4,true),end=p+8+size;if(end>bytes.length)throw new Error('音频不完整');
    if(tag(p)==='fmt ')format=view.getUint16(p+8,true)===1&&view.getUint16(p+10,true)===1&&view.getUint32(p+12,true)===24000&&view.getUint16(p+22,true)===16;
    if(tag(p)==='data')pcm=bytes.slice(p+8,end);
    p=end+(size%2);
  }
  if(!format||!pcm||pcm.byteLength%2)throw new Error('讲解需要24kHz单声道PCM');
  return pcm;
}
export class PrincipleVoice {
  constructor(player,getBridge){
    this.player=player;this.getBridge=getBridge;this.active=null;this.cache=new Map();
    this.listener=event=>{if(event.detail.type==='stop')this.cancel();};
    player.root.addEventListener('principle:state',this.listener);
  }
  cancel(){const active=this.active;this.active=null;if(active)try{this.getBridge()?.cancelNarration(active.id);}catch{}}
  event(event){
    const active=this.active;
    if(!active)return;
    if(event.type==='transport.closed'||event.type==='turn.started'){
      this.active=null;this.player.pause();return;
    }
    if(event.narration_id!==active.id)return;
    if(event.type==='narration.started'){this.player.audioMessage='';this.player.render();}
    if(event.type==='narration.progress'){
      this.player.speakerProgress(event.played_seconds,{complete:!!event.completed});
      if(event.completed)this.active=null;
    }
    if(event.type==='narration.stopped'||event.type==='narration.failed'){
      this.active=null;this.player.pause();
      if(event.type==='narration.failed'){this.player.audioMessage='配音播放中断';this.player.render();}
    }
  }
  tools(){return [
    {name:'show_principle_lesson',description:'用小萌现有声音讲解一个约一分钟的原理，右侧数学动画按实际朗读同步。只打开讲解，焊接和抓取任务继续。用户问焊接感知原理可选pointnet；坐标变换coordinates，逆运动学inverse_kinematics，碰撞/路径规划planning。系统直接播放已录配音，无需再朗读工具内容或额外介绍。',side_effect:true,parameters:{type:'object',properties:{topic:{type:'string',enum:LESSONS.map(l=>l.id)}},required:['topic'],additionalProperties:false},
      execute:async({topic},{callId}={})=>{
        const bridge=this.getBridge(),lesson=lessonById(topic);
        if(!bridge?.prepareNarration||!lesson?.audio)return {result:{error:'narration_not_available',message:'讲解音频尚未就绪。'}};
        try{
          if(!this.cache.has(topic)){
            const response=await fetch(lesson.audio);if(!response.ok)throw new Error('audio_unavailable');
            this.cache.set(topic,wavePCM(await response.arrayBuffer()));
          }
          this.cancel();
          const id=crypto.randomUUID(),text=lesson.steps.map(s=>s.speech).join('');
          await bridge.prepareNarration({sourceCallId:callId,narrationId:id,text,pcm:this.cache.get(topic)});
          this.active={id,topic};this.player.start(topic,{mode:'narration'});
          this.player.audioMessage='准备朗读';this.player.render();
          return {result:{accepted:true,narration_id:id,topic,duration:lesson.steps.reduce((n,s)=>n+s.seconds,0),message:'配音已受理，等待扬声器播放；机器人任务继续。'}};
        }catch(error){return {result:{error:'narration_unavailable',message:'本次讲解未能开始，机器人任务不受影响。'}};}
      }
    },
    {name:'stop_principle_lesson',description:'结束当前原理讲解和配音；不停止机械臂或焊接任务。',side_effect:true,parameters:{type:'object',properties:{},additionalProperties:false},execute:async()=>{this.cancel();this.player.stop();return {result:{stopped:true}};}},
  ];}
  dispose(){this.cancel();this.player.root.removeEventListener('principle:state',this.listener);}
}

