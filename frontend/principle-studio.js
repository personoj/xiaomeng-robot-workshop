import {LESSONS,lessonById,lessonDuration} from './principle-lessons.js';
import {PrinciplePlayer,attachPrincipleAPI} from './principle-player.js';
import './principle-studio.css';
const $=id=>document.getElementById(id),format=n=>`${Math.floor(n/60).toString().padStart(2,'0')}:${Math.floor(n%60).toString().padStart(2,'0')}`;
$('app').innerHTML=`<div class="lesson-studio"><header class="studio-header"><a href="/" class="studio-brand">小萌<span>原理讲解室</span></a><span class="studio-mode">小萌原声 · 同步讲解</span><a href="/" class="studio-return">返回工作坊 ↗</a></header>
<div class="studio-intro"><div><span class="studio-kicker">UNDERSTAND THE MOTION</span><h1>让每一次动作，都有迹可循。</h1></div><p>四个主题，一步一步看懂机器人。<br>在这里独立播放、暂停与检查讲解内容。</p></div>
<nav class="topic-tabs" aria-label="讲解主题">${LESSONS.map((lesson,i)=>`<button type="button" data-topic="${lesson.id}" aria-pressed="false"><span class="topic-number">0${i+1}</span><strong>${lesson.title}</strong><small>${lesson.summary}</small></button>`).join('')}</nav>
<main class="studio-main"><section class="studio-visual"><div id="lesson-player"></div><div class="studio-transport"><button id="previous" aria-label="上一段">←</button><button id="play" class="play-button">播放</button><button id="next" aria-label="下一段">→</button><span id="clock">00:00 / 00:00</span><label class="sr-only" for="seek">讲解时间</label><input type="range" id="seek" min="0" max="100" value="0" step="0.01"><button id="replay" aria-label="从头播放">重播</button></div></section>
<aside class="studio-script"><div class="script-heading"><div><span class="studio-kicker">NARRATION</span><h2>随画面讲解</h2></div><span id="step-label"></span></div><p class="script-note">小萌原声已录制。画面跟随实际已播放的声音，暂停、定位也同步。</p><ol id="script-list"></ol><div class="script-footer"><span>可点选分段，反复观察变化。</span><a id="studio-source" target="_blank" rel="noopener">查看原理出处 ↗</a></div></aside></main>
<footer class="studio-footer">讲解示意独立于机器人执行，不修改工位、物体或焊接状态。<span id="duration-note"></span></footer></div>`;
let player,dragging=false,currentTopic='';
function refresh(detail){
  if(!player)return;
  const state=player.snapshot();$('play').textContent=state.status==='playing'?'暂停':state.status==='completed'?'再看一次':'播放';
  $('step-label').textContent=state.topic?`${state.step+1} / 4`:'';
  $('previous').disabled=!state.topic||state.step===0;$('next').disabled=!state.topic||state.step===3;
  document.querySelectorAll('[data-script-step]').forEach(el=>{const current=Number(el.dataset.scriptStep)===state.step;el.dataset.current=String(current);el.querySelector('button').setAttribute('aria-current',current?'step':'false');});
  if(detail?.type==='step'&&state.topic){
    const list=$('script-list'),item=list.querySelector(`[data-script-step="${state.step}"]`);
    if(item)list.scrollTo({top:list.scrollTop+item.getBoundingClientRect().top-list.getBoundingClientRect().top,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
}
player=new PrinciplePlayer($('lesson-player'),{onChange:refresh});const detach=attachPrincipleAPI(player);
function selectTopic(id,autoplay=true){
  const lesson=lessonById(id);if(!lesson)return;currentTopic=id;
  document.querySelectorAll('[data-topic]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.topic===id)));
  $('script-list').innerHTML=lesson.steps.map((s,i)=>`<li data-script-step="${i}"><button type="button"><span>0${i+1}</span><strong>${s.title}</strong><small>${s.seconds.toFixed(1)}秒</small></button><p>${s.speech}</p></li>`).join('');
  $('script-list').querySelectorAll('button').forEach((button,i)=>button.onclick=()=>{player.pause();player.seekStep(i,0);refresh();});
  $('studio-source').href=lesson.source.url;$('studio-source').title=lesson.source.title;$('seek').max=String(lessonDuration(lesson));$('duration-note').textContent=`本主题 ${lesson.steps.length} 段 · 实录 ${lessonDuration(lesson).toFixed(1)} 秒`;
  player.start(id,{autoplay});refresh();const url=new URL(location.href);url.searchParams.set('topic',id);history.replaceState(null,'',url);
}
document.querySelectorAll('[data-topic]').forEach(button=>button.onclick=()=>selectTopic(button.dataset.topic));
$('play').onclick=()=>{player.snapshot().status==='playing'?player.pause():player.resume();refresh();};
$('previous').onclick=()=>{player.pause();player.seekStep(Math.max(0,player.snapshot().step-1));refresh();};
$('next').onclick=()=>{player.pause();player.seekStep(Math.min(3,player.snapshot().step+1));refresh();};
$('replay').onclick=()=>selectTopic(currentTopic);
$('seek').addEventListener('pointerdown',()=>{dragging=true;});
$('seek').addEventListener('input',()=>{player.pause();player.seek(Number($('seek').value));refresh();});
$('seek').addEventListener('change',()=>{dragging=false;});
const clock=setInterval(()=>{const s=player.snapshot();$('clock').textContent=`${format(s.elapsed)} / ${format(s.duration)}`;if(!dragging)$('seek').value=String(s.elapsed);},100);
const query=new URLSearchParams(location.search);selectTopic(query.get('topic')||'coordinates',query.get('play')==='1');
window.addEventListener('pagehide',()=>{clearInterval(clock);detach();player.dispose();});
