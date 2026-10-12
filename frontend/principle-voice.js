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
  constructor(player, getBridge) {
    Object.assign(this, {player, getBridge, active:null, pending:null, epoch:0, disposed:false, cache:new Map(), unconfirmed:new Set()});
    this.listener = event => {
      if (!this.cancel() && event.detail.type !== 'dispose') {
        event.preventDefault();
        this.player.interruptNarration('语音端停止未确认，请检查连接后重试');
      }
    };
    player.root.addEventListener('principle:control', this.listener);
  }
  retire(request) {
    if (!request) return true;
    request.retired = true;
    request.abort.abort();
    // Use the captured connection and source call, never a replacement connection.
    // Also repeat after a late prepare resolves: cancellation may have preceded preparation.
    try { request.bridge.cancelNarration(request.id, request.callId); return true; } catch { return false; }
  }
  cancel({connectionClosed = false} = {}) {
    this.epoch++;
    const requests = new Set([this.pending, this.active, ...this.unconfirmed]);
    this.pending = this.active = null; this.unconfirmed.clear();
    for (const request of requests) {
      const sent = this.retire(request);
      if (!sent && request?.preparing && !connectionClosed && request.bridge === this.getBridge()) this.unconfirmed.add(request);
    }
    const confirmed = this.unconfirmed.size === 0;
    if (!confirmed) this.player.interruptNarration('语音端停止未确认，请检查连接后重试');
    return confirmed;
  }
  abandon(request) {
    const sent = this.retire(request);
    if (!sent && request.preparing && request.bridge === this.getBridge()) this.unconfirmed.add(request);
    const owned = this.pending === request || this.active === request;
    if (this.pending === request) this.pending = null;
    if (this.active === request) this.active = null;
    if (owned) this.player.interruptNarration(this.unconfirmed.size ? '语音端停止未确认，请检查连接后重试' : '讲解已中断，可在此继续');
  }
  current(request) {
    return !this.disposed && !this.player.disposed && !request.retired && request.epoch === this.epoch
      && request.bridge === this.getBridge() && (!request.isCurrent || request.isCurrent());
  }
  event(event) {
    if (this.disposed) return;
    if (event.type === 'transport.closed' || event.type === 'turn.started'
      || (event.type === 'state' && ['disconnected', 'error'].includes(event.state))) {
      const hadNarration = this.pending || this.active || this.unconfirmed.size;
      this.cancel({connectionClosed:event.type === 'transport.closed' || event.type === 'state'});
      if (hadNarration) this.player.interruptNarration(this.unconfirmed.size ? '语音端停止未确认，请检查连接后重试' : '讲解已中断，可在此继续');
      return;
    }
    if (event.type === 'narration.stopped' || event.type === 'narration.failed') {
      for (const retired of this.unconfirmed) {
        if (event.narration_id === retired.id) {
          this.unconfirmed.delete(retired);
          if (!this.pending && !this.active) this.player.interruptNarration('讲解已中断，可在此继续');
        }
      }
    }
    const request = this.active || this.pending;
    if (!request || event.narration_id !== request.id || !this.current(request)) return;
    if (event.type === 'narration.stopped' || event.type === 'narration.failed') {
      // The server has acknowledged retirement; no extra cancellation is needed.
      request.preparing = false; this.cancel();
      this.player.interruptNarration(event.type === 'narration.failed' ? '配音未能开始，可在此播放' : '讲解已中断，可在此继续');
      return;
    }
    if (request !== this.active) return;
    if (event.type === 'narration.started') {
      // Started means sent, not heard. The diagram still waits for played samples.
      this.player.audioMessage = '等待已播放回执'; this.player.render();
    }
    if (event.type === 'narration.progress' && Number.isFinite(event.played_seconds) && event.played_seconds >= 0) {
      this.player.audioPending = false; this.player.audioMessage = '';
      this.player.speakerProgress(event.played_seconds, {complete:!!event.completed});
      this.player.render();
      if (event.completed && this.player.snapshot().status === 'completed') this.active = null;
    }
  }
  async begin(topic, {callId, isCurrent} = {}) {
    const bridge = this.getBridge(), lesson = lessonById(topic);
    const cancelled = () => ({result:{error:'narration_cancelled', message:'本次讲解已取消，机器人任务不受影响。'}});
    if (this.disposed || this.player.disposed || (isCurrent && !isCurrent())) return cancelled();
    if (!bridge?.prepareNarration || !bridge?.cancelNarration || !lesson?.audio)
      return {result:{error:'narration_not_available', message:'语音端讲解尚未就绪，可在页面播放。'}};
    if (!this.cancel()) return {result:{error:'narration_stop_unconfirmed', message:'语音端停止未确认，请检查连接后重试。'}};
    const request = {id:crypto.randomUUID(), topic, callId, isCurrent, bridge, epoch:this.epoch, abort:new AbortController(), retired:false};
    this.pending = request;
    this.player.startNarration(topic);
    this.player.audioPending = true; this.player.audioMessage = '正在准备语音端配音'; this.player.render();
    try {
      if (!this.cache.has(topic)) {
        const response = await fetch(lesson.audio, {signal:request.abort.signal});
        if (!this.current(request)) { this.abandon(request); return cancelled(); }
        if (!response.ok) throw new Error('audio_unavailable');
        const buffer = await response.arrayBuffer();
        if (!this.current(request)) { this.abandon(request); return cancelled(); }
        this.cache.set(topic, wavePCM(buffer));
      }
      if (!this.current(request)) { this.abandon(request); return cancelled(); }
      const text = lesson.steps.map(step => step.speech).join('');
      request.preparing = true;
      await bridge.prepareNarration({sourceCallId:callId, narrationId:request.id, text, pcm:this.cache.get(topic)});
      if (!this.current(request)) { this.abandon(request); return cancelled(); }
      this.pending = null; this.active = request;
      this.player.audioMessage = '配音已受理，等待播放'; this.player.render();
      return {result:{accepted:true, narration_id:request.id, topic, duration:lesson.steps.reduce((n, step) => n + step.seconds, 0), message:'配音已受理，等待扬声器播放；机器人任务继续。'}};
    } catch (error) {
      if (!this.current(request)) { this.abandon(request); return cancelled(); }
      const stopped = this.cancel();
      this.player.interruptNarration(stopped ? '语音端配音不可用，可在此播放' : '语音端停止未确认，请检查连接后重试');
      return {result:{error:'narration_unavailable', message:'本次讲解未能开始，可在页面播放。机器人任务不受影响。'}};
    }
  }
  tools() { return [
    {name:'show_principle_lesson', description:'用小萌现有声音讲解一个约一分钟的原理，右侧数学动画按实际朗读同步。只打开讲解，焊接和抓取任务继续。用户问焊接感知原理可选pointnet；坐标变换coordinates，逆运动学inverse_kinematics，碰撞/路径规划planning。系统直接播放已录配音，无需再朗读工具内容或额外介绍。', side_effect:true, parameters:{type:'object', properties:{topic:{type:'string', enum:LESSONS.map(l => l.id)}}, required:['topic'], additionalProperties:false},
      execute:({topic}, execution) => this.begin(topic, execution)},
    {name:'stop_principle_lesson', description:'结束当前原理讲解和配音；不停止机械臂或焊接任务。', side_effect:true, parameters:{type:'object', properties:{}, additionalProperties:false}, execute:async(_, {isCurrent} = {}) => {
      if (this.disposed || (isCurrent && !isCurrent())) return {result:{error:'narration_cancelled', message:'该讲解指令已失效。'}};
      if (!this.cancel()) return {result:{error:'narration_stop_unconfirmed', message:'语音端停止未确认，请检查连接后重试。'}};
      this.player.stop(); return {result:{stopped:true}};
    }},
  ]; }
  dispose() {
    this.cancel(); this.disposed = true;
    this.player.root.removeEventListener('principle:control', this.listener);
  }
}
