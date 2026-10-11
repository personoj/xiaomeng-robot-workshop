// Audience-facing descriptions belong to tasks, never to ASR transcripts.
export const TASK_COPY = {
  transfer: {
    instruction: "把红色方块放进蓝色托盘。",
    target: "蓝色托盘",
    kind: "tray",
  },
  stack: {
    instruction: "把红色方块放到蓝色方块上。",
    target: "蓝色方块",
    kind: "cube",
  },
  barrier: {
    instruction: "让红色方块越过障碍，放进蓝色托盘。",
    target: "蓝色托盘",
    kind: "tray",
  },
};

export const STAGES = ["对准目标", "抓取方块", "移动至目标", "放置验证"];
const PHASE_STAGE = {
  approach: 0,
  descend: 0,
  grasp: 1,
  lift: 1,
  carry: 2,
  lower: 2,
  release: 3,
  withdraw: 3,
  finish: 3,
  recover: 1,
};

export function presentation(state) {
  const started = state.status !== "idle";
  const observation = state.frame?.observation || {};
  const success = state.status === "completed" && observation.success === true;
  const stage = PHASE_STAGE[state.phase] ?? 0;
  const distance =
    observation.relative_geometry?.object_destination_xy_distance_m;
  const arrived = started && Number.isFinite(distance) && distance < 0.025;
  const stable =
    arrived &&
    observation.support_contact === true &&
    observation.stable_seconds >= 0.4 &&
    observation.gripper === "open" &&
    !observation.forbidden_contact;
  return {
    started,
    success,
    arrived,
    stable,
    copy: started ? TASK_COPY[state.task] : null,
    stages: STAGES.map((label, index) => ({
      label,
      status: !started
        ? "pending"
        : success || index < stage
          ? "done"
          : index === stage
            ? "current"
            : "pending",
    })),
    status: success
      ? "success"
      : [
            "error",
            "stopped",
            "stalled",
            "exhausted",
            "uncertain",
            "completed",
          ].includes(state.status)
        ? "error"
        : state.status,
    title: success
      ? "任务完成"
      : {
          idle: "等待指令",
          running: "正在执行",
          paused: "任务已暂停",
          stopped: "任务已停止",
          uncertain: "等待确认",
        }[state.status] || "验证未通过",
  };
}
