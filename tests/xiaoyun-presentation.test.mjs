import test from "node:test";
import assert from "node:assert/strict";
import { presentation } from "../frontend/demo-presentation.js";
import { AudioActivity } from "../frontend/voice-visuals.js";

test("idle hides task; accepted task selects canonical copy independently of user speech", () => {
  const s = { status: "idle", task: "stack", phase: null };
  assert.equal(presentation(s).copy, null);
  assert.ok(presentation(s).stages.every((x) => x.status === "pending"));
  assert.equal(
    presentation({ ...s, status: "running", transcript: "嗯，那个东西弄一下" })
      .copy.instruction,
    "把红色方块放到蓝色方块上。",
  );
});
test("last phase and cycle count cannot fabricate physical completion or stability", () => {
  const s = {
    task: "stack",
    status: "paused",
    phase: "withdraw",
    cycles: 8,
    frame: {
      observation: {
        relative_geometry: { object_destination_xy_distance_m: 0.01 },
        support_contact: true,
        stable_seconds: 0.1,
        gripper: "open",
      },
    },
  };
  let p = presentation(s);
  assert.equal(p.success, false);
  assert.equal(p.stable, false);
  assert.equal(p.arrived, true);
  assert.equal(p.stages[3].status, "current");
  p = presentation({
    ...s,
    status: "completed",
    frame: {
      observation: {
        ...s.frame.observation,
        stable_seconds: 0.5,
        success: true,
      },
    },
  });
  assert.equal(p.success, true);
  assert.equal(p.stable, true);
  assert.ok(p.stages.every((x) => x.status === "done"));
  assert.equal(
    presentation({ ...s, frame: { observation: {} } }).arrived,
    false,
  );
});
test("input text/levels and output levels are isolated and stale meters decay to idle", () => {
  const a = new AudioActivity();
  a.update(
    { channel: "input", level: 0.7, active: true, text: "帮我放进去" },
    1000,
  );
  assert.deepEqual(a.sample(1100), {
    input: 0.7,
    output: 0,
    text: "帮我放进去",
  });
  a.update({ channel: "output", level: 0.4, active: true }, 1100);
  assert.deepEqual(a.sample(1200), {
    input: 0.7,
    output: 0.4,
    text: "帮我放进去",
  });
  assert.deepEqual(a.sample(2000), { input: 0, output: 0, text: "帮我放进去" });
  assert.equal(
    a.update({ channel: "output", level: NaN, active: true }, 2000),
    false,
  );
  a.update({ channel: "output", level: 1, active: false }, 2100);
  assert.equal(a.sample(2101).output, 0);
  a.reset();
  assert.deepEqual(a.sample(2102), { input: 0, output: 0, text: "" });
});
