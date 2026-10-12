import { WorkshopScene as RobotScene } from "./workshop-scene.js";
import {
  DemoController,
  TERMINAL,
  summarize,
  voiceActions,
  api,
} from "./workshop-controller.js";
import { presentation } from "./workshop-presentation.js";
import { VoiceVisuals } from "./voice-visuals.js";
import { PrinciplePlayer, attachPrincipleAPI } from "./principle-player.js";
import { PrincipleVoice } from "./principle-voice.js";
import { WorkshopControls } from "./workshop-controls.js";
import { optionalStartup } from "./optional-startup.js";
import { setTextIfChanged } from "./ui-feedback.js";
import {
  createIcons,
  Settings,
  Mic,
  FileText,
  Box,
  ArrowRight,
  X,
  Copy,
  ArrowUpRight,
  RotateCcw,
} from "lucide";
import "./demo.css";
import "./workshop.css";
import "./workshop-explainer.css";
import "./workshop-experience.css";

const $ = (id) => document.getElementById(id),
  icon = (name) => `<i data-lucide="${name}"></i>`;
const armIcon='<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 24h11v-4H4zM7 19l-1-7 5-4 9-4 3 4-10 5-2 7M21 8l3 3 2-1M24 11v4"/><circle cx="8" cy="11" r="3"/><circle cx="21" cy="6" r="3"/></svg>';
const stored = {
  sessionId: localStorage.getItem("xiaoyun.robot.session") || "",
  serverURL:
    localStorage.getItem("xiaoyun.robot.server") || "http://127.0.0.1:8766",
};
const querySession = new URLSearchParams(location.search).get("session");
if (querySession && /^[a-f0-9]{32}$/.test(querySession))
  stored.sessionId = querySession;
$("app").innerHTML = `
<div class="app-shell">
 <header class="topbar"><div class="brand"><span class="xiaomeng-mark"><img src="/brand/xiaomeng-mark.png" alt="小萌 XIAO MENG"></span><span class="brand-divider"></span><img class="university-emblem" src="/brand/wut-emblem.png" alt="武汉理工大学校徽"><img class="university-wordmark" src="/brand/wut-wordmark.png" alt="武汉理工大学"></div><div class="workshop-title"><div><strong>机器人工作坊</strong><span>ROBOTICS WORKSHOP</span></div><i></i></div><div class="top-actions"><span class="connection-state" id="connection-state" title="本地仿真与语音通道分别显示"><i></i><span id="connection-label">正在连接仿真</span></span><span class="separator"></span><button class="icon-button" id="settings" aria-label="设置">${icon("settings")}<span>设置</span></button></div></header>
 <main class="workspace">
  <aside class="voice-panel panel" aria-label="语音交互">
   <h1>${icon("mic")}<span>语音交互</span></h1>
   <div class="voice-wave"><canvas id="output-wave" role="img" aria-label="小萌说话的波形"></canvas></div>
   <div class="input-voice" aria-label="用户语音输入"><div id="input-bars" class="input-bars" aria-hidden="true">${"<i></i>".repeat(11)}</div><p id="input-caption" aria-live="polite"></p></div>
   <section class="instruction"><h2>${icon("file-text")}本次指令</h2><p id="instruction-text" class="instruction-copy empty" tabindex="0" aria-label="本次指令内容">从道具与任务开始，也可以先听一段原理。</p><button type="button" class="local-start" id="open-local-controls">添加道具，开始体验</button>
    <div class="object-flow workshop-object-flow" id="object-flow" hidden><span id="source-label"></span><span class="flow-arrow">${icon("arrow-right")}</span><span id="target-label"></span><span id="target-shape" hidden></span></div>
   </section>
   <div class="voice-guidance"><p id="voice-readiness" role="status">原理讲解与本地仿真无需语音连接。</p><button type="button" class="text-button" id="voice-setup">连接语音</button></div><div class="voice-circuits" aria-hidden="true"></div>
  </aside>
  <section class="scene-panel panel" aria-label="机械臂仿真场景"><div class="scene-heading"><h2>${armIcon}<span>机器人工作坊</span></h2><span id="workshop-phase" class="workshop-phase"></span></div><div id="workshop-controls" class="workshop-controls" aria-label="视角与机器人任务"></div><div id="scene" class="scene"><div id="loading">正在准备三维场景…</div></div><details class="prop-dock" id="prop-dock"><summary class="dock-heading"><span>${icon("box")}道具与任务</span><small>添加 · 抓放 · 点焊</small></summary><div id="local-controls" class="local-controls"></div><div class="dock-items" id="dock-items"></div></details></section>
  <aside class="right-column panel" aria-label="原理讲解"><div id="principle-panel"></div></aside>
 </main>
</div>
<dialog id="connection-dialog" aria-labelledby="settings-title">
 <div class="dialog-heading"><div><span class="eyebrow">连接与演示控制</span><h2 id="settings-title">演示设置</h2></div><button class="icon-button" id="close-dialog" aria-label="关闭设置">${icon("x")}</button></div>
 <section class="zero-mode" aria-labelledby="zero-title">
  <div class="zero-heading"><h3 id="zero-title">归零模式</h3><button class="button secondary" id="zero-demo">${icon("rotate-ccw")}<span>一键归零</span></button></div>
  <p>清空球、方块、盘子和管排，收起小萌 H7；保留桌子与白色机械臂，回到抓取视角。之后可用语音重新添加，语音连接保持不变。</p>
  <p id="zero-status" role="status" hidden></p>
 </section>
 <div class="session-heading"><h3>选择会话</h3><button class="text-button" id="refresh-sessions">刷新列表</button></div>
 <label class="sr-only" for="session-select">已有会话</label><select id="session-select"><option value="">正在读取会话…</option></select>
 <p id="session-detail" class="session-detail">选择已有会话，继续之前的对话。</p>
 <button class="button primary session-connect" id="connect">连接所选会话</button>
 <div class="new-session-row"><label class="sr-only" for="new-session-name">新会话名称</label><input id="new-session-name" placeholder="新会话名称（可选）" maxlength="60"><button class="button secondary" id="new-session">新建并连接</button></div>
 <p id="connection-detail" class="connection-detail">设备会同步绑定所选会话，旧对话保留。</p>
 <details class="advanced-connection"><summary>高级连接设置</summary>
  <label for="server-url">语音服务地址</label><input id="server-url" value="http://127.0.0.1:8766" autocomplete="off">
  <label for="session-id">会话 ID</label><div class="input-row"><input id="session-id" placeholder="也可手动填写会话 ID" autocomplete="off"><button id="copy-session" class="icon-button" aria-label="复制会话 ID">${icon("copy")}</button></div>
 </details>
 <a id="open-workbench" href="http://127.0.0.1:8766/" target="_blank" rel="noopener">打开语音工作台 ${icon("arrow-up-right")}</a>
 <div class="preview-links"><a href="/principle-studio.html" target="_blank" rel="noopener">原理讲解预览 ${icon("arrow-up-right")}</a><a href="/model-studio.html" target="_blank" rel="noopener">模型检视 ${icon("arrow-up-right")}</a><a href="/weld-effects-studio.html" target="_blank" rel="noopener">焊接效果检视 ${icon("arrow-up-right")}</a></div>
</dialog><div id="toast" role="status" hidden></div>`;
createIcons({
  icons: {
    Settings,
    Mic,
    FileText,
    Box,
    ArrowRight,
    X,
    Copy,
    ArrowUpRight,
    RotateCcw,
  },
});
let sceneId = null,
  sceneRequest = 0,
  bridge = null,
  bridgeGeneration = 0,
  contextSignature = "",
  contextDirty = false,
  voiceExecution = 0,
  stopped = false,
  toastTimer,
  pollTimer;
let localControls = null, startup = null;
let simulationOnline = false,
  zeroing = false;
let catalog = { sessions: [], device_available: false },
  catalogRequest = 0,
  connecting = false;
const jobs = new Map();
const contextKey = (s) => JSON.stringify([s.id, s.revision, s.task, s.status, s.message,s.view,s.view_revision]);
function saveJobs() {
  if (stored.sessionId)
    localStorage.setItem(
      "xiaoyun.robot.jobs." + stored.sessionId,
      JSON.stringify([...jobs].slice(-20)),
    );
}
const scene = new RobotScene($("scene"), {
  onError: (message) => toast(message),
});
const principle = new PrinciplePlayer($("principle-panel"));
const detachPrincipleAPI = attachPrincipleAPI(principle);
const principleVoice = new PrincipleVoice(principle, () => bridge);
const previewLesson = new URLSearchParams(location.search).get('lesson');
if(previewLesson)try{principle.start(previewLesson);}catch{}
const visuals = new VoiceVisuals(
  $("output-wave"),
  $("input-bars"),
  $("input-caption"),
);
// Optional device adapter: feed normalized input levels and partial/final recognized text.
const audioHandler = (event) => visuals.activity.update(event.detail);
window.addEventListener("xiaoyun:audio", audioHandler);
window.xiaoyunDemoAudio = Object.freeze({
  update: (event) => visuals.activity.update(event),
  transcript: (text) => visuals.activity.transcript(text),
});
function toast(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => ($("toast").hidden = true), 5000);
}
function setConnection(connected = !!bridge) {
  $("connection-state").classList.toggle("online", simulationOnline);
  setTextIfChanged($("connection-label"), simulationOnline
    ? connected ? "仿真就绪 · 语音服务已连接" : "仿真就绪 · 语音未连接"
    : "仿真连接中断");
  setTextIfChanged($("voice-readiness"), connected
    ? "语音服务已连接。可打开语音工作台；使用设备时，按住 BOOT 说话、松开提交。"
    : "直接添加道具或播放原理即可体验。语音是可选的。");
  setTextIfChanged($("voice-setup"), connected ? "语音连接设置" : "连接语音");
  localControls?.update(controller.state, simulationOnline);
}
async function render(state) {
  const assetKey=state.scene_id+':'+(state.runtime_id||'');
  if (sceneId !== assetKey) {
    const token = ++sceneRequest;
    const data = await api("/api/workshop/assets");
    if (token !== sceneRequest || data.episode_id !== state.scene_id) return;
    scene.load(data);
    sceneId = assetKey;
    $("loading").hidden = true;
  }
  scene.syncAssets(state.objects);
  scene.setWeldState(state);
  scene.applyView(state.view||2,state.view_revision||0,state.view_target);
  scene.setSelected([state.job?.source,state.job?.target].filter(Boolean));
  simulationOnline = true;
  startup?.simulationReady();
  setConnection();
  const p = presentation(state);
  const instruction = p.copy?.instruction || "从道具与任务开始，也可以先听一段原理。";
  if($("instruction-text").textContent !== instruction) $("instruction-text").textContent = instruction;
  $("instruction-text").classList.toggle('long-copy', instruction.length > 42);
  $("instruction-text").classList.toggle("empty", !p.copy);
  $("open-local-controls").hidden = !!p.copy;
  $("object-flow").hidden = !p.copy;
  if (p.copy) {
    $("target-label").textContent = p.copy.target;
    $("source-label").textContent = p.copy.source;
    for(const [id,key] of [['source-label','source'],['target-label','target']]){
      const object=state.objects.find(o=>o.id===state.job?.[key]);
      $(id).dataset.kind=object?.kind||'';
      $(id).style.setProperty('--object-color',({blue:'#2769e8',red:'#f3545d',yellow:'#eec23e',green:'#4bbc98'})[object?.color]||'#638dbb');
    }
    $("target-shape").classList.toggle("tray", p.copy.kind === "tray");
  }
  setTextIfChanged($("workshop-phase"), p.started ? p.title : '仿真就绪');
  $("workshop-phase").setAttribute("role", "status");
  $("workshop-phase").dataset.status = p.status;
  scene.render(state.frame,{moving:state.status==='running'&&state.task==='pick_place'});
  renderDock(state.objects);
  contextDirty = true;
  publishContext();
  await reportCompletion(state);
}
function renderDock(objects){
  const kinds=[['gripper','抓手机械臂'],['welder','小萌 H7'],['panel','钢管管排'],['ball','彩色球'],['cube','方块'],['tray','托盘']];
  const signature=objects.map(o=>o.id).join('|');if(renderDock.signature===signature)return;renderDock.signature=signature;
  $('dock-items').replaceChildren(...kinds.map(([kind,label])=>{const button=document.createElement('button');button.type='button';button.className='prop-card';button.setAttribute('aria-label','查看'+label);button.innerHTML=`<img class="prop-model-thumb" alt=""><strong>${label}</strong><small>场内 ${objects.filter(o=>o.kind===kind).length}</small>`;const image=button.querySelector("img");image.dataset.kind=kind;button.onclick=()=>localControls.session.run('set_view',{view:['welder','panel'].includes(kind)?3:1});return button;}));
  if($("prop-dock").open)loadDockImages();
}
function loadDockImages(){
  for(const image of $('dock-items').querySelectorAll('img[data-kind]')){
    const kind=image.dataset.kind;delete image.dataset.kind;
    scene.thumbnail(kind).then(url=>{image.src=url;}).catch(()=>{image.hidden=true;});
  }
}
$('prop-dock').addEventListener('toggle',()=>{if($('prop-dock').open)loadDockImages();});
const controller = new DemoController({ onState: render, onError: toast });
localControls = new WorkshopControls({root: $("workshop-controls"), dock: $("local-controls"), controller});
startup = optionalStartup({hasSession:() => !!stored.sessionId, connect:() => connect(false, false), onError:error => { if (!stopped) $("connection-detail").textContent = error.message; }});
$("voice-setup").onclick = showConnection;
$("open-local-controls").onclick = () => { $("prop-dock").open = true; $("local-controls").querySelector("select").focus({preventScroll:false}); };
function publishContext() {
  if (!bridge || !controller.state || voiceExecution || controller.busy) return;
  const snapshot = summarize(controller.state),
    signature = contextKey(controller.state);
  if (signature === contextSignature) {
    contextDirty = false;
    return;
  }
  bridge.updateContext(snapshot);
  contextSignature = signature;
  contextDirty = false;
}
function showConnection() {
  $("connection-dialog").showModal();
  loadSessions();
}
function serviceOrigin() {
  const url = new URL($("server-url").value.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("请填写有效的语音服务地址。");
  return url.origin;
}
const sessionTime = (seconds) =>
  seconds
    ? new Date(seconds * 1000).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "";
function describeSession() {
  const item = catalog.sessions.find(
    (s) => s.session_id === $("session-select").value,
  );
  $("session-detail").textContent = item
    ? [
        item.is_device ? "ESP32 当前绑定" : "独立会话",
        item.audio_connected ? "语音在线" : "语音待机",
        item.updated_at
          ? "最近使用 " + sessionTime(item.updated_at)
          : "尚未开始对话",
      ].join(" · ")
    : "还没有会话，可以直接新建。";
}
// Speech discovery is optional and bounded. It never owns simulation startup.
function speechFetch(url, init = {}) {
  if (init.method && init.method.toUpperCase() !== "GET") return fetch(url, init);
  return fetch(url, {...init, signal: AbortSignal.timeout(6000)});
}
async function loadSessions() {
  const request = ++catalogRequest;
  $("refresh-sessions").disabled = true;
  try {
    const response = await speechFetch(serviceOrigin() + "/api/sessions");
    if (!response.ok) throw new Error("无法读取会话列表，请检查语音服务地址。");
    const result = await response.json();
    if (request !== catalogRequest) return;
    catalog = result;
    const selected =
      $("session-id").value || stored.sessionId || result.device_session_id;
    $("session-select").replaceChildren();
    for (const item of result.sessions) {
      const option = document.createElement("option");
      option.value = item.session_id;
      option.textContent =
        (item.is_device ? "ESP32 · " : "") +
        (item.name ||
          (item.is_device
            ? "设备会话"
            : "会话 " + sessionTime(item.created_at))) +
        (item.session_id === stored.sessionId && bridge ? "（当前连接）" : "");
      if (item.page_connected && item.session_id !== stored.sessionId) {
        option.disabled = true;
        option.textContent += " · 其他页面使用中";
      }
      $("session-select").append(option);
    }
    if (result.sessions.some((item) => item.session_id === selected))
      $("session-select").value = selected;
    if (!result.sessions.length)
      $("session-select").append(new Option("暂无会话，请新建", ""));
    $("session-id").value = $("session-select").value;
    describeSession();
    $("connect").disabled = connecting || !$("session-select").value;
    $("connection-detail").textContent = result.device_available
      ? "切换后设备先回待机；再次说“你好小萌”进入所选会话，旧对话保留。"
      : "选择或新建后，可在语音工作台中开始对话。";
  } catch (error) {
    $("session-detail").textContent = error.message;
  } finally {
    if (request === catalogRequest) $("refresh-sessions").disabled = false;
  }
}
$("refresh-sessions").onclick = loadSessions;
$("session-select").onchange = () => {
  $("session-id").value = $("session-select").value;
  describeSession();
};
$("server-url").onchange = () => {
  $("session-id").value = "";
  loadSessions();
};

async function zeroDemo() {
  if (zeroing) return;
  if (controller.busy || voiceExecution) {
    $("zero-status").textContent = "上一个操作正在处理中，请稍后归零。";
    $("zero-status").hidden = false;
    return;
  }
  zeroing = true;
  $("zero-demo").disabled = true;
  $("zero-demo").lastElementChild.textContent = "正在归零…";
  $("zero-status").hidden = true;
  try {
    await controller.refresh();
    // Finalize an active job before replacing its episode, so the harness receives cancellation.
    if (["running", "paused", "uncertain"].includes(controller.state.status))
      await controller.command("stop");
    await controller.command("reset");
    visuals.activity.reset();
    principle.stop();
    publishContext();
    $("connection-dialog").close();
    toast("已清空道具，可以用语音重新添加。");
  } catch (error) {
    // A lost write reply must be reconciled from the server, never reported as success.
    await controller.refresh().catch(() => {});
    publishContext();
    $("zero-status").textContent =
      error.outcome === "unknown"
        ? "未收到完整归零回执，已尝试同步实际状态，请检查后重试。"
        : error.message;
    $("zero-status").hidden = false;
  } finally {
    zeroing = false;
    $("zero-demo").disabled = false;
    $("zero-demo").lastElementChild.textContent = "一键归零";
  }
}
$("zero-demo").onclick = zeroDemo;
$("settings").onclick = showConnection;
$("close-dialog").onclick = () => $("connection-dialog").close();
$("server-url").value = stored.serverURL;
$("session-id").value = stored.sessionId;
function workbenchLink() {
  const url = new URL(stored.serverURL);
  url.pathname = "/";
  url.search = stored.sessionId ? "?session_id=" + stored.sessionId : "";
  $("open-workbench").href = url.href;
}
workbenchLink();
$("copy-session").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("session-id").value);
    toast("会话 ID 已复制。");
  } catch {
    toast("请手动复制会话 ID。");
  }
};
function connectionEvent(event) {
  principleVoice.event(event);
  if (event.type === "audio.activity") visuals.activity.update(event);
  if (event.type === "transcript.user") {visuals.activity.transcript(event.text);controller.transcript=event.text||"";}
  if (event.type === "state" && ["disconnected", "error"].includes(event.state))
    visuals.activity.reset();
  if (event.type === "tool.completed") {
    for (const job of jobs.values())
      if (job.callId === event.call_id) {
        job.accepted = event.status === "succeeded";
        if (!job.accepted) job.disabled = true;
      }
    saveJobs();
  }
  if (event.type === "task.ack") {
    const job = jobs.get(event.task_id);
    if (job) job.acked = true;
    saveJobs();
  }
  if (event.type === "transport.closed") {
    bridge = null;
    visuals.activity.reset();
    setConnection(false);
  }
  if (event.type === "error") toast(event.message || event.code);
}
async function connect(create = false, closeSettings = true) {
  if (connecting) return;
  if (
    voiceExecution ||
    controller.busy ||
    (closeSettings &&
      ["running", "paused", "uncertain"].includes(controller.state?.status))
  ) {
    toast("请先完成或停止当前任务，再切换会话。");
    return;
  }
  connecting = true;
  $("connect").disabled = $("new-session").disabled = true;
  const previousGeneration = bridgeGeneration;
  const generation = ++bridgeGeneration;
  try {
    const nextServer = serviceOrigin();
    let nextSession = $("session-id").value.trim();
    if (create) {
      const response = await speechFetch(nextServer + "/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: $("new-session-name").value.trim() }),
      });
      if (!response.ok) throw new Error("无法创建会话。");
      nextSession = (await response.json()).session_id;
    }
    if (!/^[a-f0-9]{32}$/.test(nextSession))
      throw new Error("请选择已有会话，或点击“新建并连接”。");
    const directory = await speechFetch(nextServer + "/api/sessions");
    if (!directory.ok) throw new Error("无法读取会话，请检查语音服务。");
    catalog = await directory.json();
    const target = catalog.sessions.find((s) => s.session_id === nextSession);
    if (
      target?.page_connected &&
      (nextSession !== stored.sessionId || nextServer !== stored.serverURL)
    )
      throw new Error("该会话正在被其他页面使用，请选择另一会话。");
    let deviceChanged = false;
    if (catalog.device_available && catalog.device_session_id !== nextSession) {
      const response = await speechFetch(nextServer + "/api/device/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: nextSession }),
      });
      if (!response.ok) {
        const detail = (await response.json()).detail;
        throw new Error(
          {
            target_audio_in_use:
              "所选会话的音频正在被电脑工作台使用，请先结束该工作台的语音。",
            device_operation_in_progress: "设备正在执行操作，请稍后切换。",
          }[detail] || "设备会话切换失败，请稍后重试。",
        );
      }
      deviceChanged = (await response.json()).changed;
    }
    bridge?.disconnect();
    bridge = null;
    contextSignature = "";
    visuals.activity.reset();
    setConnection(false);
    stored.serverURL = nextServer;
    stored.sessionId = nextSession;
    jobs.clear();
    try {
      for (const [id, job] of JSON.parse(
        localStorage.getItem("xiaoyun.robot.jobs." + stored.sessionId) || "[]",
      ))
        jobs.set(id, { ...job, sentAt: 0 });
    } catch {}
    if (!controller.state) await controller.refresh();
    const { connectFrontend } = await import(
      /* @vite-ignore */ stored.serverURL + "/static/frontend.js"
    );
    const actions = voiceActions(controller, (id, callId) => {
      jobs.set(id, { callId, accepted: false, acked: false, sentAt: 0 });
      saveJobs();
    }).map((action) => ({
      ...action,
      execute: async (...args) => {
        if (zeroing && action.side_effect)
          return {
            result: {
              error: "demo_reset_in_progress",
              message: "场景正在归零，请等待完成后再执行。",
            },
          };
        voiceExecution++;
        try {
          return await action.execute(...args);
        } finally {
          voiceExecution--;
          if (controller.state) contextSignature = contextKey(controller.state);
          publishContext();
        }
      },
    }));
    const connected = await connectFrontend({
      serverURL: stored.serverURL,
      sessionId: stored.sessionId,
      pageId: "xiaoyun-robot-demo",
      context: summarize(controller.state),
      actions: [...actions, ...principleVoice.tools()],
      onEvent: (event) => {
        if (generation === bridgeGeneration) connectionEvent(event);
      },
    });
    if (generation !== bridgeGeneration) {
      connected.disconnect();
      return;
    }
    bridge = connected;
    contextSignature = contextKey(controller.state);
    localStorage.setItem("xiaoyun.robot.session", stored.sessionId);
    localStorage.setItem("xiaoyun.robot.server", stored.serverURL);
    $("session-id").value = stored.sessionId;
    const pageURL = new URL(location.href);
    pageURL.searchParams.set("session", stored.sessionId);
    history.replaceState(null, "", pageURL);
    $("new-session-name").value = "";
    workbenchLink();
    await loadSessions();
    setConnection(true);
    $("connection-detail").textContent = deviceChanged
      ? "设备已绑定此会话，再次说“你好小萌”即可开始。"
      : "已连接所选会话。";
    if (deviceChanged) toast("会话已切换，再次说“你好小萌”开始对话。");
    if (closeSettings) $("connection-dialog").close();
  } catch (error) {
    if (bridge) bridgeGeneration = previousGeneration;
    setConnection(!!bridge);
    $("connection-detail").textContent = error.message;
    toast(error.message);
  } finally {
    connecting = false;
    $("connect").disabled = $("new-session").disabled = false;
  }
}
$("connect").onclick = () => connect();
$("new-session").onclick = () => connect(true);
async function reportCompletion(state) {
  const job = jobs.get(state.id);
  if (
    !bridge ||
    !job?.accepted ||
    job.acked ||
    job.disabled ||
    !TERMINAL.has(state.status) ||
    Date.now() - job.sentAt < 2500
  )
    return;
  const snapshot = summarize(state);
  const status = snapshot.success
    ? "succeeded"
    : state.status === "stopped"
      ? "cancelled"
      : "failed";
  try {
    bridge.reportTask({
      taskId: state.id,
      sourceCallId: job.callId,
      status,
      result: snapshot,
    });
    job.sentAt = Date.now();
  } catch {}
}
async function poll() {
  if (stopped) return;
  try {
    if (!controller.streamConnected && !controller.busy) await controller.refresh();
    if (contextDirty) publishContext();
  } catch (error) {
    simulationOnline = false;
    setConnection();
    if (!controller.state)
      $("loading").textContent = "仿真服务未就绪，请检查 8090 服务。";
  } finally {
    pollTimer = setTimeout(
      poll,
      600,
    );
  }
}
window.addEventListener("pagehide", () => {
  stopped = true;
  startup?.cancel();
  clearTimeout(pollTimer);
  clearTimeout(toastTimer);
  bridgeGeneration++;
  bridge?.disconnect();
  controller.dispose();
  scene.dispose();
  visuals.dispose();
  principle.dispose();
  principleVoice.dispose();
  detachPrincipleAPI();
  window.removeEventListener("xiaoyun:audio", audioHandler);
  delete window.xiaoyunDemoAudio;
});
// Local simulation starts first and remains live even if speech never responds.
controller.connectStream(online=>{simulationOnline=online;setConnection();});
window.xiaomengPerformance={snapshot:()=>({scene:{...scene.metrics,drawCalls:scene.renderer.info.render.calls,triangles:scene.renderer.info.render.triangles},controller:{...controller.metrics},streamConnected:controller.streamConnected})};
poll();
loadSessions().then(() => {
  if (stopped) return;
  if (!stored.sessionId) stored.sessionId = $("session-id").value;
  startup.speechReady();
}).catch(error => { if (!stopped) $("connection-detail").textContent = error.message; });
