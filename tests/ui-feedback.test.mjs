import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTextIfChanged } from "../frontend/ui-feedback.js";
test("300 streamed frames with one message cause one live-text mutation", () => {
  let text = "",
    writes = 0;
  const live = {
    get textContent() {
      return text;
    },
    set textContent(v) {
      text = v;
      writes++;
    },
  };
  for (let frame = 0; frame < 300; frame++) setTextIfChanged(live, "正在点焊");
  assert.equal(writes, 1);
  setTextIfChanged(live, "任务已暂停");
  assert.equal(writes, 2);
  for (let frame = 0; frame < 300; frame++)
    setTextIfChanged(live, "任务已暂停");
  assert.equal(writes, 2);
});
test("all new streamed live-region writers use the change-only helper (source integration guard)", async () => {
  const demo = await readFile(
    new URL("../frontend/demo.js", import.meta.url),
    "utf8",
  );
  const controls = await readFile(
    new URL("../frontend/workshop-controls.js", import.meta.url),
    "utf8",
  );
  assert.match(demo, /setTextIfChanged\(\$\("voice-readiness"\)/);
  assert.match(demo, /setTextIfChanged\(\$\("workshop-phase"\)/);
  assert.match(controls, /setTextIfChanged\(\s*notice,/);
  assert.doesNotMatch(controls, /notice.textContent\s*=/);
});
