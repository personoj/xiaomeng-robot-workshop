import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  localAvailability,
  LocalCommandSession,
} from "../frontend/workshop-controls.js";
const state = (status = "idle", task = null) => ({
  status,
  task,
  revision: 13,
  runtime_id: "current-runtime",
  scene_id: "one-world",
  objects: [],
});
test("offline lessons remain independent and local controls expose actual readiness", () => {
  const a = localAvailability(state(), { online: false });
  assert.equal(a.start, false);
  assert.equal(a.spawn, false);
  assert.match(a.reason, /原理讲解仍可使用/);
});
test("pause/resume/stop affordances follow task state, never hide the actual phase", () => {
  for (const [status, pause, resume, stop] of [
    ["idle", false, false, false],
    ["running", true, false, true],
    ["paused", false, true, true],
    ["completed", false, false, false],
    ["error", false, false, false],
  ]) {
    const a = localAvailability(state(status), { online: true });
    assert.deepEqual([a.pause, a.resume, a.stop], [pause, resume, stop]);
  }
});
test("local additions preserve the isolated-table exception during welding", () => {
  for (const kind of ["ball", "cube", "tray"])
    assert.equal(
      localAvailability(state("running", "weld_seam"), { online: true, kind })
        .spawn,
      true,
    );
  for (const kind of ["panel", "welder", "gripper"])
    assert.equal(
      localAvailability(state("running", "weld_seam"), { online: true, kind })
        .spawn,
      false,
    );
  assert.equal(
    localAvailability(state("paused", "pick_place"), {
      online: true,
      kind: "ball",
    }).spawn,
    false,
  );
  assert.equal(
    localAvailability(state("running", "weld_seam"), {
      online: true,
      pending: true,
    }).spawn,
    false,
  );
});
test("local exact-object actions retain revision and runtime guards; accepted never means completed", async () => {
  const calls = [];
  const c = {
    state: state(),
    command: async (...args) => {
      calls.push(args);
      return { accepted: true };
    },
  };
  const session = new LocalCommandSession(c);
  await session.run("pick_place", { source: "ball_5", target: "tray_3" });
  assert.deepEqual(calls[0], [
    "pick_place",
    { source: "ball_5", target: "tray_3" },
    { expectedRevision: 13, expectedRuntimeId: "current-runtime" },
  ]);
  assert.match(session.message, /已受理/);
  assert.match(session.message, /实际完成状态/);
});
test("repeated click creates one mutation and pending state is observable", async () => {
  let resolve;
  let writes = 0,
    changes = 0;
  const c = {
    state: state(),
    command: () => {
      writes++;
      return new Promise((r) => (resolve = r));
    },
  };
  const session = new LocalCommandSession(c, () => changes++),
    first = session.run("spawn", { kind: "ball" });
  assert.equal(session.pending, true);
  assert.equal(await session.run("spawn", { kind: "ball" }), false);
  assert.equal(writes, 1);
  resolve({ created: { spoken_name: "蓝色球五" } });
  await first;
  assert.equal(session.pending, false);
  assert.equal(changes, 2);
  assert.equal(session.message, "已添加蓝色球五");
});
test("lost response is sticky until readback; camera and stop do not erase uncertainty", async () => {
  let writes = 0;
  const c = {
    state: state(),
    command: async () => {
      if (++writes === 1)
        throw Object.assign(new Error("lost"), { outcome: "unknown" });
      return {};
    },
    refresh: async () => {},
  };
  const session = new LocalCommandSession(c);
  await session.run("spawn", { kind: "ball" });
  assert.equal(session.unknown, true);
  assert.match(session.message, /避免重复/);
  assert.equal(await session.run("spawn", { kind: "ball" }), false);
  await session.run("set_view", { view: 2 });
  assert.equal(session.unknown, true);
  await session.run("stop");
  assert.equal(session.unknown, true);
  assert.equal(await session.run("pick_place", {}), false);
  await session.refresh();
  assert.equal(session.unknown, false);
  assert.match(session.message, /核对/);
});
test("rejected command stays actionable and cannot show fabricated success", async () => {
  const session = new LocalCommandSession({
    state: state(),
    command: async () => {
      throw new Error("场景已改变，请读取最新状态");
    },
  });
  assert.equal(await session.run("spawn", {}), false);
  assert.equal(session.error, true);
  assert.equal(session.pending, false);
  assert.equal(session.message, "场景已改变，请读取最新状态");
});
test("a rejected stop cannot clear uncertainty from an earlier lost mutation", async () => {
  let count = 0;
  const c = {
    state: state(),
    command: async () => {
      count++;
      throw Object.assign(
        new Error("no active task"),
        count === 1 ? { outcome: "unknown" } : {},
      );
    },
  };
  const session = new LocalCommandSession(c);
  await session.run("spawn", {});
  await session.run("stop");
  assert.equal(session.unknown, true);
  assert.equal(await session.run("spawn", {}), false);
  assert.equal(count, 2);
});
test("accepted task feedback follows its real completion and never guesses success", async () => {
  const session = new LocalCommandSession({
    state: state(),
    command: async () => ({ accepted: true, task_id: "task-one" }),
  });
  await session.run("pick_place", {});
  const s = {
    ...state("running", "pick_place"),
    job: { id: "task-one", success: false },
    instruction: "synthetic task",
  };
  assert.match(session.feedback(s), /正在执行/);
  assert.match(session.feedback({ ...s, status: "paused" }), /暂停/);
  assert.match(session.feedback({ ...s, status: "completed" }), /未通过验证/);
  assert.match(
    session.feedback({
      ...s,
      status: "completed",
      job: { ...s.job, success: true },
    }),
    /任务完成/,
  );
  assert.match(
    session.feedback({ ...s, status: "error", message: "安全检查未通过" }),
    /安全检查未通过/,
  );
});
test("pause, resume and camera changes cannot mask later task completion or failure", async () => {
  const session = new LocalCommandSession({
    state: state(),
    command: async (action) =>
      action === "pick_place"
        ? { accepted: true, task_id: "task-one" }
        : { accepted: false },
  });
  await session.run("pick_place", {});
  await session.run("pause");
  await session.run("resume");
  await session.run("set_view", { view: 3 });
  const s = {
    ...state("completed", "pick_place"),
    job: { id: "task-one", success: true },
  };
  assert.match(session.feedback(s), /任务完成/);
  assert.match(
    session.feedback({ ...s, status: "error", message: "碰撞安全检查未通过" }),
    /碰撞安全检查未通过/,
  );
});
test("optional speech discovery cannot gate simulation startup (source integration guard)", async () => {
  const source = await readFile(
    new URL("../frontend/demo.js", import.meta.url),
    "utf8",
  );
  const startup = source.slice(
    source.lastIndexOf("// Local simulation starts first"),
  );
  assert.ok(
    startup.indexOf("controller.connectStream") <
      startup.indexOf("loadSessions()"),
  );
  assert.ok(startup.indexOf("poll();") < startup.indexOf("loadSessions()"));
  assert.doesNotMatch(startup, /await loadSessions/);
  assert.match(source, /signal: AbortSignal.timeout\(6000\)/);
  assert.match(source, /语音服务已连接/);
});
test("new voice task supersedes local task receipt and new prop receipt remains visible", async () => {
  const c = {
    state: {
      ...state("running", "pick_place"),
      job: { id: "task-a", success: false },
    },
    command: async (action) =>
      action === "pick_place"
        ? { accepted: true, task_id: "task-a" }
        : { created: { spoken_name: "红色球六" } },
  };
  const session = new LocalCommandSession(c);
  await session.run("pick_place", {});
  const newer = {
    ...state("error", "pick_place"),
    job: { id: "task-b", success: false },
    message: "新任务安全检查失败",
  };
  assert.equal(session.feedback(newer), "新任务安全检查失败");
  c.state = {
    ...state("completed", "pick_place"),
    job: { id: "task-b", success: true },
  };
  await session.run("spawn", {});
  assert.equal(session.feedback(c.state), "已添加红色球六");
  assert.match(
    session.feedback({
      ...state("running", "pick_place"),
      job: { id: "task-c" },
    }),
    /正在执行/,
  );
});
test("idle view receipt does not claim a robot task is continuing", async () => {
  const c = { state: state(), command: async () => ({ accepted: false }) };
  const session = new LocalCommandSession(c);
  await session.run("set_view", { view: 2 });
  assert.doesNotMatch(session.message, /任务继续/);
  assert.match(session.message, /对象保留/);
});
