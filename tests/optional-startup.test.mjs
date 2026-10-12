import test from "node:test";
import assert from "node:assert/strict";
import { optionalStartup } from "../frontend/optional-startup.js";
const flush = () => new Promise((resolve) => setImmediate(resolve));
for (const order of [
  ["speechReady", "simulationReady"],
  ["simulationReady", "speechReady"],
])
  test(`saved reconnect joins ${order.join(" then ")} without blocking simulation`, async () => {
    let calls = 0;
    const startup = optionalStartup({
      hasSession: () => true,
      connect: () => calls++,
    });
    startup[order[0]]();
    await flush();
    assert.equal(calls, 0);
    startup[order[1]]();
    await flush();
    assert.equal(calls, 1);
    for (let i = 0; i < 100; i++) startup.simulationReady();
    startup.speechReady();
    await flush();
    assert.equal(calls, 1);
  });
test("speech may hang forever while scene readiness remains independent", async () => {
  let calls = 0;
  const startup = optionalStartup({
    hasSession: () => true,
    connect: () => calls++,
  });
  for (let i = 0; i < 100; i++) startup.simulationReady();
  await flush();
  assert.equal(calls, 0);
});
test("no stored session does not trigger new account/session creation", async () => {
  let calls = 0;
  const startup = optionalStartup({
    hasSession: () => false,
    connect: () => calls++,
  });
  startup.simulationReady();
  startup.speechReady();
  await flush();
  assert.equal(calls, 0);
});
test("page exit cancels queued reconnect and failed reconnect is not looped", async () => {
  let calls = 0;
  const startup = optionalStartup({
    hasSession: () => true,
    connect: () => calls++,
  });
  startup.simulationReady();
  startup.speechReady();
  startup.cancel();
  await flush();
  assert.equal(calls, 0);
  let errors = 0;
  const failure = optionalStartup({
    hasSession: () => true,
    connect: () => {
      calls++;
      throw new Error("offline");
    },
    onError: () => errors++,
  });
  failure.simulationReady();
  failure.speechReady();
  await flush();
  failure.simulationReady();
  await flush();
  assert.equal(calls, 1);
  assert.equal(errors, 1);
});
