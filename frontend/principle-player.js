import {LESSONS, lessonById, lessonFrame} from './principle-lessons.js';
import {PrincipleTimeline} from './principle-timeline.js';
import {drawPrinciple} from './principle-diagrams.js';
import {drawPrincipleTimeline, principleTransitionAt} from './principle-compositor.js';
import './principle-player.css';

const LABELS = {coordinates:['参照系','旋转','平移','变换链'], inverse_kinematics:['正解','误差','迭代','多解'], pointnet:['点集','采样','分组','聚合'], planning:['碰撞','间隙','搜索','验证']};
const TOPICS = {coordinates:'坐标变换', inverse_kinematics:'逆运动学', pointnet:'点云感知', planning:'路径规划'};
const fmt = n => Math.floor(n / 60) + ':' + String(Math.floor(n % 60)).padStart(2, '0');

export class PrinciplePlayer {
  constructor(root, {onChange = () => {}} = {}) {
    Object.assign(this, {root, onChange, timeline:new PrincipleTimeline(), lastStep:'', lastTime:null, disposed:false, skipBefore:-1, source:'browser', audioEpoch:0, audioMessage:'', audioPending:false, audioRetry:false, externalTarget:0, selectedTopic:'pointnet'});
    this.audio = new Audio();
    this.audio.preload = 'auto';
    root.classList.add('principle-player');
    root.innerHTML = `<header class="principle-heading"><svg class="principle-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7v14M3 3h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5v17h-5a4 4 0 0 0-4 1 4 4 0 0 0-4-1H3z"/></svg><h2>原理讲解</h2><span class="principle-status" role="status" aria-live="polite"></span></header>
      <div class="principle-topics" role="group" aria-label="选择讲解主题">${LESSONS.map(lesson => `<button type="button" data-lesson-topic="${lesson.id}" aria-pressed="false" title="${lesson.summary}">${TOPICS[lesson.id]}</button>`).join('')}</div>
      <div class="principle-board">
        <div class="principle-intro"><div class="principle-kicker"><span class="principle-number">01</span><span class="principle-eyebrow"></span><i></i></div><h3 class="principle-title"></h3></div>
        <div class="principle-figure"><canvas role="img" aria-label="机器人原理讲解示意"></canvas></div>
        <div class="principle-formula" aria-label="本步公式"></div><div class="principle-reading"><p class="principle-caption"></p></div>
        <ol class="principle-chapters" aria-label="定位讲解章节"></ol>
        <div class="principle-controls">
          <div class="principle-transport"><button type="button" class="principle-play">播放讲解</button><button type="button" class="principle-replay" aria-label="从头播放本主题">重播</button><span class="principle-clock"></span></div>
          <input class="principle-seek" type="range" min="0" max="1" step="0.1" value="0" aria-label="讲解进度">
          <div class="principle-playback"><span class="principle-audio-status" role="status" aria-live="polite"></span><a class="principle-source" target="_blank" rel="noopener">原理出处 ↗</a></div>
          <p class="principle-control-note">本页原声播放 · 无需语音连接</p>
        </div>
      </div><footer class="principle-footer">原理示意 · 讲解控制不影响机器人任务</footer>`;
    this.audio.hidden = true;
    root.appendChild(this.audio);
    this.el = selector => root.querySelector(selector);
    this.canvas = this.el('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.topicButtons = [...root.querySelectorAll('[data-lesson-topic]')];
    this.topicButtons.forEach(button => button.addEventListener('click', () => this.start(button.dataset.lessonTopic)));
    this.el('.principle-play').addEventListener('click', () => this.timeline.status === 'playing' ? this.pause() : this.resume());
    this.el('.principle-replay').addEventListener('click', () => this.start(this.timeline.lesson?.id || this.selectedTopic));
    // Keep these native buttons mounted: chapter changes must not steal keyboard focus.
    this.el('.principle-chapters').innerHTML = [0,1,2,3].map(i => `<li><button type="button" data-lesson-step="${i}"><i aria-hidden="true"><b></b></i><span></span></button></li>`).join('');
    this.chapterButtons = [...root.querySelectorAll('[data-lesson-step]')];
    this.chapterButtons.forEach((button, i) => button.addEventListener('click', () => {
      if (!this.timeline.lesson) this.start(this.selectedTopic, {autoplay:false});
      this.seekStep(i);
    }));
    this.el('.principle-seek').addEventListener('input', event => this.seek(Number(event.target.value)));
    this.resize = new ResizeObserver(() => { if (!this.disposed) { this.fitFormula(); this.draw(); } });
    this.resize.observe(root);
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.audio.addEventListener('ended', () => {
      if (!this.disposed && this.source === 'browser' && this.timeline.status === 'playing') this.sync({runId:this.timeline.runId, elapsed:this.audio.currentTime});
    });
    this.audio.addEventListener('error', () => {
      if (!this.disposed && this.source === 'browser' && this.timeline.lesson && this.audio.error) {
        this.pause(); this.audioRetry = true; this.audioMessage = '音频载入失败，请点击重试'; this.audioPending = false; this.render();
      }
    });
    this.animate = now => {
      this.frame = null;
      if (this.disposed) return;
      const dt = this.lastTime === null ? 0 : Math.min(.1, (now - this.lastTime) / 1000);
      this.lastTime = now;
      let changed = this.timeline.tick(dt);
      if (this.source === 'browser' && this.timeline.status === 'playing' && !this.audio.paused && !this.audio.seeking) {
        const time = this.audio.currentTime;
        if (time !== this.timeline.elapsed) changed = this.timeline.sync({runId:this.timeline.runId, elapsed:time}).accepted;
      }
      if (this.source === 'external' && this.timeline.status === 'playing' && this.externalTarget > this.timeline.elapsed) {
        // Approach only speaker-acknowledged samples, never extrapolate ahead.
        const time = Math.min(this.externalTarget, this.timeline.elapsed + Math.max(dt, (this.externalTarget - this.timeline.elapsed) * dt * 12));
        changed = this.timeline.sync({runId:this.timeline.runId, elapsed:time}).accepted;
      }
      if (changed) { this.render(); this.draw(); }
      if (this.timeline.status === 'playing' && (this.source === 'silent'
        || (this.source === 'browser' && !this.audio.paused)
        || (this.source === 'external' && this.externalTarget > this.timeline.elapsed))) this.wake();
    };
    this.render(); this.draw();
  }
  wake() {
    if (!this.disposed && this.frame == null) this.frame = requestAnimationFrame(this.animate);
  }
  // The bridge retires pending and playing narration synchronously BEFORE local controls act.
  control(type) {
    if (this.disposed) return false;
    return this.root.dispatchEvent(new CustomEvent('principle:control', {detail:{type, source:this.source}, bubbles:true, cancelable:true}));
  }
  notify(type) {
    const detail = {type, ...this.snapshot()};
    this.onChange(detail);
    this.root.dispatchEvent(new CustomEvent('principle:state', {detail, bubbles:true}));
  }
  start(topic, options = {}) {
    if (!lessonById(topic)) throw new Error('未知讲解主题：' + topic);
    if (!this.control('start')) return this.snapshot();
    return this.load(topic, options);
  }
  // Called only by the narration owner; normal start/pause/seek always retire that owner.
  startNarration(topic) { if (!this.disposed) return this.load(topic, {mode:'narration'}); }
  load(topic, {autoplay = true, mode = 'audio'} = {}) {
    this.audioEpoch++; this.audio.pause();
    this.source = mode === 'audio' ? 'browser' : mode === 'narration' ? 'external' : 'silent';
    this.externalTarget = 0; this.audioMessage = ''; this.audioPending = false;
    this.timeline.load(topic, {autoplay, mode:mode === 'automatic' ? 'automatic' : 'narration'});
    this.selectedTopic = topic; this.skipBefore = -1; this.lastTime = null; this.lastStep = '';
    if (this.source === 'browser') {
      this.loadAudio();
      if (autoplay) this.playAudio();
    }
    this.render(); this.draw(); this.notify('start');
    if (autoplay) this.wake();
    return this.snapshot();
  }
  loadAudio() {
    this.audioRetry = false;
    this.audio.src = this.timeline.lesson.audio;
    this.audio.load();
    this.audio.currentTime = this.timeline.elapsed;
  }
  async playAudio() {
    const epoch = ++this.audioEpoch;
    this.audioPending = true;
    try {
      await this.audio.play();
      if (!this.disposed && epoch === this.audioEpoch) { this.audioPending = false; this.audioMessage = ''; this.render(); this.wake(); }
    } catch (error) {
      if (this.disposed || epoch !== this.audioEpoch) return;
      this.timeline.pause(); this.audioPending = false; this.audioRetry = error.name !== 'NotAllowedError';
      this.audioMessage = error.name === 'NotAllowedError' ? '点击播放，开启本页声音' : '音频未能播放，请点击重试';
      this.render(); this.draw(); this.notify('pause');
    }
  }
  pause() {
    if (!this.control('pause')) return this.snapshot();
    this.audioEpoch++; this.audio.pause(); this.audioPending = false;
    if (this.timeline.status === 'playing') {
      if (this.source === 'browser') this.timeline.sync({runId:this.timeline.runId, elapsed:this.audio.currentTime});
      if (this.source === 'external') this.timeline.sync({runId:this.timeline.runId, elapsed:this.externalTarget});
    }
    this.timeline.pause();
    if (this.source === 'external') this.audioMessage = '语音端讲解已取消，可在此继续';
    this.render(); this.draw(); this.notify('pause');
    return this.snapshot();
  }
  interruptNarration(message) {
    if (this.disposed || this.source !== 'external') return;
    if (this.timeline.status === 'playing') this.timeline.sync({runId:this.timeline.runId, elapsed:this.externalTarget});
    this.timeline.pause(); this.audioPending = false; this.audioMessage = message;
    this.render(); this.draw(); this.notify('pause');
  }
  resume() {
    if (!this.timeline.lesson || this.timeline.status === 'completed') return this.start(this.timeline.lesson?.id || this.selectedTopic);
    if (this.timeline.status === 'playing' || !this.control('resume')) return this.snapshot();
    if (this.source === 'external') { this.source = 'browser'; this.loadAudio(); }
    else if (this.source === 'browser' && (this.audio.error || this.audioRetry)) this.loadAudio();
    this.timeline.resume(); this.lastTime = null; this.audioMessage = '';
    if (this.source === 'browser') { this.audio.currentTime = this.timeline.elapsed; this.playAudio(); }
    this.render(); this.draw(); this.notify('resume'); this.wake();
    return this.snapshot();
  }
  stop() {
    if (!this.control('stop')) return this.snapshot();
    this.audioEpoch++; this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load();
    this.timeline.stop(); this.lastStep = ''; this.externalTarget = 0; this.audioMessage = ''; this.audioPending = false;
    this.render(); this.draw(); this.notify('stop');
    return this.snapshot();
  }
  seek(seconds) {
    if (!this.timeline.lesson || !Number.isFinite(seconds)) return this.snapshot();
    if (!this.control('seek')) return this.snapshot();
    // The external protocol has no seek. Retire it and position a paused local recording.
    if (this.source === 'external') {
      this.timeline.pause(); this.source = 'browser'; this.audioPending = false;
      this.audioMessage = '已切换本页，点击播放继续'; this.loadAudio();
    }
    this.timeline.seek(seconds); this.skipBefore = this.timeline.elapsed;
    if (this.source === 'browser' && this.audio.src) this.audio.currentTime = this.timeline.elapsed;
    if (this.timeline.status === 'completed') { this.audioEpoch++; this.audio.pause(); this.audioPending = false; }
    this.externalTarget = this.timeline.elapsed;
    this.render(); this.draw(); this.notify('seek');
    return this.snapshot();
  }
  seekStep(index, progress = 0) { return this.seek(this.timeline.stepTime(index, progress)); }
  sync(update) { const result = this.timeline.sync(update); if (result.accepted) { this.render(); this.draw(); } return result; }
  speakerProgress(elapsed, {complete = false} = {}) {
    if (this.disposed || this.source !== 'external' || this.timeline.status !== 'playing' || !Number.isFinite(elapsed) || elapsed < 0) return;
    this.externalTarget = Math.max(this.externalTarget, Math.min(elapsed, this.snapshot().duration));
    // Completion still uses the speaker's reported clock, never a fabricated end time.
    if (complete) this.sync({runId:this.timeline.runId, elapsed:this.externalTarget});
    else this.wake();
  }
  snapshot() { return {...this.timeline.snapshot(), source:this.source}; }
  script(topic = this.timeline.lesson?.id) {
    const lesson = lessonById(topic);
    if (!lesson) throw new Error('未知讲解主题');
    return {topic:lesson.id, title:lesson.title, audio:lesson.audio, voice:lesson.voice, steps:lesson.steps.map(({id,title,speech,seconds,beats}, index) => ({index,id,title,speech,seconds,beats})), source:lesson.source};
  }
  setText(selector, text) {
    const element = this.el(selector);
    if (element.textContent !== text) element.textContent = text;
  }
  render() {
    const s = this.snapshot(), lesson = this.timeline.lesson || lessonById(this.selectedTopic);
    const frame = s.topic ? lessonFrame(lesson, s.elapsed) : {step:lesson.steps[2], index:2};
    const signature = [lesson.id, s.step ?? 2, s.runId].join(':');
    this.root.dataset.topic = s.topic || 'idle'; this.root.dataset.status = s.status; this.root.dataset.source = this.source;
    this.root.dataset.step = String(s.step ?? -1); this.root.dataset.progress = String(s.progress ?? 0);
    this.setText('.principle-status', s.status === 'playing' && this.audioPending ? '准备声音' : ({idle:'选择主题，开始听', playing:'讲解中', paused:'已暂停', completed:'讲解完成'})[s.status]);
    this.el('.principle-clock').textContent = s.topic ? fmt(s.elapsed) + ' / ' + fmt(s.duration) : '约 1 分钟';
    const source = this.source === 'external' ? '语音端配音' : this.source === 'silent' ? '静音预览' : '本页原声';
    this.setText('.principle-audio-status', this.audioMessage ? source + ' · ' + this.audioMessage : source);
    this.el('.principle-control-note').textContent = this.source === 'external'
      ? '暂停、定位或选主题会结束语音端讲解；继续时在此播放。机器人任务不受影响。'
      : '本页播放 · 无需语音连接 · 不影响机器人任务';
    const play = this.el('.principle-play');
    play.textContent = s.status === 'playing' ? '暂停讲解' : s.status === 'completed' ? '再听一次' : (this.audio.error || this.audioRetry) && this.source === 'browser' ? '重试播放' : this.source === 'external' ? '在此继续' : '播放讲解';
    play.setAttribute('aria-label', s.status === 'playing' && this.source === 'external' ? '暂停讲解并结束语音端配音' : play.textContent);
    this.el('.principle-replay').disabled = !s.topic;
    const seek = this.el('.principle-seek');
    seek.disabled = !s.topic; seek.max = String(s.duration || 1); seek.value = String(s.elapsed);
    seek.setAttribute('aria-label', this.source === 'external' ? '讲解进度，调整后结束语音端配音并切换本页' : '讲解进度');
    seek.setAttribute('aria-valuetext', s.topic ? `${fmt(s.elapsed)}，共 ${fmt(s.duration)}` : '尚未播放');
    this.topicButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.lessonTopic === lesson.id)));
    const opacity = s.topic ? principleTransitionAt(lesson, s.elapsed, {skipBefore:this.skipBefore}).contentOpacity : 1;
    this.root.style.setProperty('--chapter-presence', String(opacity));
    if (signature !== this.lastStep) {
      this.lastStep = signature;
      this.el('.principle-number').textContent = String(LESSONS.indexOf(lesson) + 1).padStart(2, '0');
      this.el('.principle-eyebrow').textContent = lesson.title;
      this.el('.principle-title').replaceChildren(document.createTextNode(frame.step.headline[0] + '，'), Object.assign(document.createElement('em'), {textContent:frame.step.headline[1]}));
      this.el('.principle-formula').innerHTML = frame.step.formula;
      this.el('.principle-formula').setAttribute('aria-label', frame.step.formulaLabel);
      this.el('.principle-caption').textContent = frame.step.caption;
      this.chapterButtons.forEach((button, i) => {
        button.setAttribute('aria-current', s.topic && i === frame.index ? 'step' : 'false');
        button.setAttribute('aria-label', `定位第 ${i + 1} 章：${lesson.steps[i].title}`);
        button.querySelector('span').textContent = String(i + 1).padStart(2, '0') + ' ' + LABELS[lesson.id][i];
        button.querySelector('b').style.width = s.topic && i < frame.index ? '100%' : '0%';
      });
      const link = this.el('.principle-source'); link.href = lesson.source.url; link.title = lesson.source.title;
      this.canvas.setAttribute('aria-label', lesson.title + '：' + frame.step.title + '。' + frame.step.caption);
      this.fitFormula();
      if (s.topic) this.notify('step');
    }
    this.el('.principle-chapters [aria-current="step"] b')?.style.setProperty('width', (s.progress || 0) * 100 + '%');
    if (s.status === 'completed' && this.lastStatus !== 'completed') this.notify('complete');
    this.lastStatus = s.status;
  }
  fitFormula() {
    const host = this.el('.principle-formula'), math = host?.querySelector('math');
    if (!math) return;
    math.style.fontSize = '';
    const max = host.clientWidth - 24, width = math.getBoundingClientRect().width;
    if (width > max && max > 0) math.style.fontSize = parseFloat(getComputedStyle(math).fontSize) * max / width + 'px';
  }
  draw() {
    const rect = this.canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2), w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
    if (!w || !h) return;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const s = this.snapshot();
    if (this.timeline.lesson && !this.reduced.matches) drawPrincipleTimeline(this.ctx, this.timeline.lesson, s.elapsed, {width:w, height:h, skipBefore:this.skipBefore});
    else drawPrinciple(this.ctx, s.topic || this.selectedTopic, s.step ?? 2, this.reduced.matches ? 1 : s.progress ?? .65, {width:w, height:h});
  }
  dispose() {
    if (!this.control('dispose')) return;
    this.disposed = true; this.timeline.pause(); this.audioEpoch++; this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load();
    cancelAnimationFrame(this.frame); this.frame = null; this.resize.disconnect();
  }
}
export function attachPrincipleAPI(player, target = window) {
  const api = Object.freeze({list:() => LESSONS.map(({id,title,summary}) => ({id,title,summary})), start:(topic,options) => player.start(topic,options), pause:() => player.pause(), resume:() => player.resume(), stop:() => player.stop(), seek:seconds => player.seek(seconds), seekStep:(step,progress) => player.seekStep(step,progress), sync:cue => player.sync(cue), state:() => player.snapshot(), script:topic => player.script(topic)});
  target.xiaomengPrinciples = api;
  return () => { if (target.xiaomengPrinciples === api) delete target.xiaomengPrinciples; };
}
