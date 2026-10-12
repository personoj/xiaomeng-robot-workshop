import { presentation } from "./workshop-presentation.js";
import { setTextIfChanged } from "./ui-feedback.js";

const ACTIVE = new Set(["running", "paused"]);
const SMALL_PROPS = new Set(["ball", "cube", "tray"]);
export function localAvailability(
  state,
  { online = false, pending = false, kind = "ball" } = {},
) {
  const active = ACTIVE.has(state?.status),
    ready = online && !!state && !pending;
  return {
    active,
    ready,
    pause: ready && state.status === "running",
    resume: ready && state.status === "paused",
    stop: ready && active,
    spawn:
      ready &&
      (!active || (state.task === "weld_seam" && SMALL_PROPS.has(kind))),
    start: ready && !active,
    reason: !online
      ? "仿真连接恢复后即可操作；原理讲解仍可使用。"
      : pending
        ? "正在确认操作结果…"
        : active
          ? state.task === "weld_seam"
            ? "焊接继续进行，可以添加球、方块和托盘。"
            : "抓放进行中，完成或停止后可添加道具。"
          : "本地仿真 · 无需语音连接。编号保留，不会重新排序。",
  };
}

// Manual controls use the same guarded commands as voice. Their feedback never
// turns an accepted operation or a lost response into a claimed completed task.
export class LocalCommandSession {
  constructor(controller, onChange = () => {}) {
    this.controller = controller;
    this.onChange = onChange;
    this.pending = false;
    this.message = "";
    this.error = false;
    this.unknown = false;
    this.taskId = null;
    this.ackContext = null;
  }
  async run(action, params = {}) {
    if (this.pending || this.controller.busy) return false;
    if (this.unknown && !["pause", "stop", "set_view"].includes(action))
      return false;
    const observed = this.controller.state;
    this.pending = true;
    this.message = "正在确认操作…";
    this.error = this.unknown;
    this.onChange();
    try {
      const options = observed
        ? {
            expectedRevision: observed.revision,
            expectedRuntimeId: observed.runtime_id,
          }
        : {};
      const result = await this.controller.command(action, params, options);
      if (result.accepted) this.taskId = result.task_id;
      else if (!["pause", "resume", "stop", "set_view"].includes(action))
        this.taskId = null;
      const current = this.controller.state;
      this.ackContext = {
        job: current?.job?.id,
        status: current?.status,
        runtime: current?.runtime_id,
      };
      if (!["pause", "stop", "set_view"].includes(action)) this.unknown = false;
      this.message = result.accepted
        ? "任务已受理，正在执行。结果以实际完成状态为准。"
        : result.created
          ? `已添加${result.created.spoken_name || result.created.name}`
          : {
              pause: "任务已暂停，场景和进度保留。",
              resume: "任务已继续。",
              stop: "任务已停止，场内对象保留。",
              set_view: ACTIVE.has(current?.status)
                ? "视角已切换，机器人任务继续。"
                : "视角已切换，场内对象保留。",
            }[action] || "操作已完成。";
      if (this.unknown) this.message += " 之前的操作结果仍待确认，请刷新状态。";
      return result;
    } catch (error) {
      this.error = true;
      this.unknown = this.unknown || error.outcome === "unknown";
      this.message = this.unknown
        ? "操作回执丢失，结果暂不确定。请刷新状态确认，避免重复添加或启动。"
        : error.message;
      return false;
    } finally {
      this.pending = false;
      this.onChange();
    }
  }
  feedback(state) {
    if (this.pending || this.error || this.unknown) return this.message;
    const changed =
      this.ackContext &&
      (state?.job?.id !== this.ackContext.job ||
        state?.status !== this.ackContext.status ||
        state?.runtime_id !== this.ackContext.runtime);
    if (this.taskId || changed) {
      if (!state?.job) return "仿真就绪，可以添加道具或开始任务。";
      const p = presentation(state);
      return state.status === "completed"
        ? p.success
          ? "任务完成，已通过实际结果检查。"
          : "执行已结束，结果未通过验证，请查看场景。"
        : state.status === "error"
          ? state.message || "执行未完成，请查看当前场景。"
          : p.title;
    }
    return this.message;
  }
  async refresh() {
    if (this.pending) return;
    this.pending = true;
    this.onChange();
    try {
      await this.controller.refresh();
      this.error = false;
      this.unknown = false;
      this.message = "已读取最新场景。请核对道具和任务状态后继续。";
    } catch {
      this.error = true;
      this.message = "暂时无法读取仿真状态。请检查工作坊服务，再刷新。";
    } finally {
      this.pending = false;
      this.onChange();
    }
  }
}

export class WorkshopControls {
  constructor({ root, dock, controller }) {
    Object.assign(this, { root, dock, controller, online: false });
    root.innerHTML = `<div class="view-presets" role="group" aria-label="场景视角"><button type="button" data-view="1">抓取台</button><button type="button" data-view="2">全景</button><button type="button" data-view="3">焊接工位</button></div><div class="task-transport" role="group" aria-label="机器人任务控制"><button type="button" data-action="pause">暂停任务</button><button type="button" data-action="stop">停止任务</button></div><p class="control-notice" role="status" aria-live="polite"></p><button type="button" class="state-refresh" hidden>刷新状态</button>`;
    dock.innerHTML = `<div class="local-heading"><strong>动手试一试</strong><span>无需语音连接</span></div><form class="spawn-controls"><label>道具<select name="kind" aria-label="添加的道具类型"><option value="ball">球</option><option value="cube">方块</option><option value="tray">托盘</option><option value="panel">管排</option><option value="welder">小萌 H7</option><option value="gripper">抓手机械臂</option></select></label><label>颜色<select name="color" aria-label="道具颜色"><option value="blue">蓝色</option><option value="red">红色</option><option value="yellow">黄色</option><option value="green">绿色</option></select></label><button class="local-primary" type="submit">添加道具</button></form><p class="local-reason"></p><div class="direct-tasks"><form class="pick-controls"><h3>抓取与放置</h3><label>抓取<select name="source" aria-label="抓取对象"></select></label><label>放到<select name="target" aria-label="放置目标"></select></label><button type="submit">开始抓放</button><p class="pick-hint"></p></form><form class="weld-controls"><h3>点焊</h3><label>管排<select name="panel" aria-label="焊接管排"></select></label><label>焊缝<select name="seam" aria-label="从上往下的焊缝编号">${Array.from({ length: 7 }, (_, i) => `<option value="${i + 1}">第 ${i + 1} 条${i === 0 ? "（最上方）" : ""}</option>`).join("")}</select></label><button type="submit">开始点焊</button><p class="weld-hint"></p></form></div><details class="manage-props"><summary>管理道具</summary><form class="remove-controls"><label>场内对象<select name="object" aria-label="移除的准确对象"></select></label><button type="submit">移除此道具</button><button type="button" class="park-welder">返回停靠位</button></form><p>任务结束后可管理。移除不改变其他对象的编号；返回停靠位只移动小萌 H7。</p></details>`;
    this.session = new LocalCommandSession(controller, () => this.render());
    root.addEventListener("click", (e) => {
      const button = e.target.closest("button");
      if (!button || button.disabled) return;
      if (button.dataset.view)
        this.session.run("set_view", { view: Number(button.dataset.view) });
      else if (button.dataset.action) this.session.run(button.dataset.action);
      else if (button.classList.contains("state-refresh"))
        this.session.refresh();
    });
    dock.addEventListener("change", () => this.render());
    dock.querySelector(".spawn-controls").addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.currentTarget,
        kind = form.elements.kind.value;
      this.session.run("spawn", {
        kind,
        color:
          kind === "welder"
            ? "yellow"
            : ["panel", "gripper"].includes(kind)
              ? "steel"
              : form.elements.color.value,
      });
    });
    dock.querySelector(".pick-controls").addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      this.session.run("pick_place", {
        source: form.elements.source.value,
        target: form.elements.target.value,
      });
    });
    dock.querySelector(".weld-controls").addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      this.session.run("weld_seam", {
        target: form.elements.panel.value,
        seam: Number(form.elements.seam.value),
      });
    });
    dock.querySelector(".remove-controls").addEventListener("submit", (e) => {
      e.preventDefault();
      this.session.run("remove", {
        object_id: e.currentTarget.elements.object.value,
      });
    });
    dock
      .querySelector(".park-welder")
      .addEventListener("click", () => this.session.run("exit_welder"));
    this.render();
  }
  update(state, online = this.online) {
    this.state = state;
    this.online = online;
    this.render();
  }
  options(select, objects, placeholder) {
    const signature = objects.map((o) => o.id + ":" + o.spoken_name).join("|");
    if (select.dataset.signature === signature) return;
    select.dataset.signature = signature;
    const previous = select.value;
    select.replaceChildren(
      ...objects.map((o) => new Option(o.spoken_name || o.name || o.id, o.id)),
    );
    if (!objects.length) select.add(new Option(placeholder, ""));
    if (objects.some((o) => o.id === previous)) select.value = previous;
  }
  render() {
    const state = this.state || this.controller.state,
      objects = state?.objects || [];
    const spawn = this.dock.querySelector(".spawn-controls"),
      kind = spawn.elements.kind.value;
    const pending = this.session?.pending || this.controller.busy;
    const a = localAvailability(state, { online: this.online, pending, kind });
    const pause = this.root.querySelector(
      '[data-action="pause"], [data-action="resume"]',
    );
    pause.dataset.action = state?.status === "paused" ? "resume" : "pause";
    setTextIfChanged(
      pause,
      state?.status === "paused" ? "继续任务" : "暂停任务",
    );
    pause.disabled = !(a.pause || a.resume);
    this.root.querySelector('[data-action="stop"]').disabled = !a.stop;
    for (const button of this.root.querySelectorAll("[data-view]")) {
      button.disabled = !a.ready;
      button.setAttribute(
        "aria-pressed",
        String(Number(button.dataset.view) === state?.view),
      );
    }
    this.root.setAttribute("aria-busy", String(!!pending));
    const notice = this.root.querySelector(".control-notice");
    setTextIfChanged(
      notice,
      this.session?.feedback(state) ||
        (state?.job
          ? presentation(state).title
          : "先添加道具，再选择抓放或点焊。也可以直接听一段原理。"),
    );
    notice.dataset.error = String(!!this.session?.error);
    this.root.querySelector(".state-refresh").hidden = !this.session?.error;
    this.root.querySelector(".state-refresh").disabled = !!pending;
    this.dock.querySelector(".local-reason").textContent = a.reason;
    spawn.elements.color.disabled = !SMALL_PROPS.has(kind);
    spawn.querySelector("button").disabled = !a.spawn || this.session?.unknown;
    const pick = this.dock.querySelector(".pick-controls");
    this.options(
      pick.elements.source,
      objects.filter((o) => ["ball", "cube"].includes(o.kind)),
      "请先添加球或方块",
    );
    const source = objects.find((o) => o.id === pick.elements.source.value);
    this.options(
      pick.elements.target,
      objects.filter(
        (o) =>
          o.id !== source?.id &&
          (o.kind === "tray" || (source?.kind === "cube" && o.kind === "cube")),
      ),
      "请先添加放置目标",
    );
    const canPick =
      !!source &&
      !!pick.elements.target.value &&
      objects.some((o) => o.kind === "gripper");
    pick.querySelector("button").disabled =
      !a.start || !canPick || this.session?.unknown;
    this.dock.querySelector(".pick-hint").textContent = canPick
      ? "真实物理抓放，完成后检查放置结果。"
      : "需要抓手机械臂、球或方块，以及托盘或另一方块。";
    const weld = this.dock.querySelector(".weld-controls");
    this.options(
      weld.elements.panel,
      objects.filter((o) => o.kind === "panel"),
      "请先添加管排",
    );
    const panel = objects.find((o) => o.id === weld.elements.panel.value);
    for (const option of weld.elements.seam.options)
      option.disabled = !!panel?.welded_seams?.includes(Number(option.value));
    if (weld.elements.seam.selectedOptions[0]?.disabled)
      weld.elements.seam.value =
        [...weld.elements.seam.options].find((o) => !o.disabled)?.value || "";
    const canWeld =
      !!panel &&
      objects.some((o) => o.kind === "welder") &&
      !!weld.elements.seam.value;
    weld.querySelector("button").disabled =
      !a.start || !canWeld || this.session?.unknown;
    const management = this.dock.querySelector(".remove-controls");
    this.options(management.elements.object, objects, "场内还没有对象");
    management.querySelector("[type=submit]").disabled =
      !a.start || !management.elements.object.value || this.session?.unknown;
    management.querySelector(".park-welder").disabled =
      !a.start ||
      !objects.some((o) => o.kind === "welder") ||
      this.session?.unknown;
    this.dock.querySelector(".weld-hint").textContent = canWeld
      ? "先检查路径，再驶入、锁定底盘并点焊。"
      : "需要小萌 H7、管排和一条尚未完成的焊缝。";
  }
}
