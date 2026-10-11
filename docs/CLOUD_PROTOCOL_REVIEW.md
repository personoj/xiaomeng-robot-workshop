# Cloud protocol regression review, 2026-10-11

All inputs are synthetic and all execution is on the cloud filesystem. No cloud model, physical robot, ESP32, credentials or remote publication were used. The two sibling repositories are `xiaoyun-realtime` and `xiaoyun-esp32`, as in `INTEGRATION.md`.

## Correctness changes

- Recheck the SDK's `execution.isCurrent()` after every awaited state/decision read and immediately before a command POST. An interrupted read must not submit an old voice intent. A known command receipt is still preserved after submission; it is not converted into a retryable failure because the display changed.
- Carry an optional `expected_runtime_id` alongside `expected_revision`. A newly started server can reuse the old numeric revision, but never its runtime UUID. The backend rejects a stale guarded request before model evaluation or mutation, including pause/stop/view controls.
- An updated snapshot advertises `capabilities.runtime_identity_guard: true`. Updated browsers only add the extra field when the server advertises it; a resolved decision carries its originating runtime into the following command.
- Reject a decision if the observed runtime changed while the decision was pending, even with a legacy resolver that cannot return a runtime guard.
- Cache retired runtimes, stage all weld-delta merges before committing, and preserve the previously accepted cache if a packet has missing points. Sequence ordering within one runtime remains unchanged.
- A newer SSE runtime takes priority over an HTTP request that started earlier, including an unseen old runtime. Callbacks and gap-recovery reads from replaced/disposed EventSources cannot update the active connection.

The Harness SDK must also invalidate execution closures on a new turn, a stopped voice session, source-response audio cancellation and transport replacement. Workshop checks alone are insufficient if the SDK reports an old intent as current. This does not pause or stop a robot task that was already accepted.

## Compatibility and deployment order

1. Upgrade the workshop backend first. Old clients remain accepted because the new request field is optional. They retain revision checks, but do not gain the server-side runtime guard.
2. Upgrade/reload the workshop browser and Harness SDK together, after any in-flight tool has reached a known outcome. The updated browser negotiates `runtime_identity_guard`; the updated SDK supplies the full intent-lifecycle check.
3. New client + old server remains wire-compatible: no unsupported request field is sent when the capability is absent. Its local observed-runtime and cancellation checks still help, but it cannot protect a server restart that occurs after the final local check and before the old server executes the request.
4. Full restart protection requires the upgraded backend and client. Full BOOT/session-stop cancellation requires the upgraded SDK and workshop controller. Do not downgrade or replace either browser/SDK while a mutation's result is unknown; inspect current state rather than resubmitting it.
5. ESP32 playback changes are independent of this API capability. They retain the existing wire protocol and can be reviewed/flashed separately after hardware authorization. No device flash is part of this review.

## Evidence and exact commands

From the workshop directory, with the declared dependencies installed in the parent `.venv`:

```sh
node --test tests/workshop-controller.test.mjs tests/workshop-cancellation.test.mjs tests/workshop-runtime.test.mjs tests/workshop-state-ordering.test.mjs tests/workshop-sdk-cancellation.test.mjs
../.venv/bin/python -m pytest tests/test_workshop.py tests/test_workshop_boundaries.py tests/test_xiaoyun_demo.py -q
```

The cross-repository SDK test discovers `../xiaoyun-realtime/web/client.js`, or accepts `XIAOMENG_HARNESS_SDK=/absolute/path/to/web/client.js`. It explicitly skips if the sibling checkout is absent. Do not count a skipped integration test as a pass.

Before/after negative controls are reproducible with the untouched baseline worktrees:

```sh
WORKSHOP_CONTROLLER_MODULE="$PWD/../baselines/xiaoyun-robot-demo/frontend/workshop-controller.js" node --test tests/workshop-cancellation.test.mjs
WORKSHOP_STATE_MODULE="$PWD/../baselines/xiaoyun-robot-demo/frontend/workshop-state.js" node --test tests/workshop-state-ordering.test.mjs
XIAOMENG_HARNESS_SDK="$PWD/../baselines/xiaoyun-realtime/web/client.js" node --test tests/workshop-sdk-cancellation.test.mjs
```

Expected negative controls: baseline controller fails 3/4 cancellation cases; baseline cache fails 3/3 transactional/runtime cases; baseline SDK fails all 9 BOOT/session-stop/audio-clear × state-read/resolve-read/decision integration cases even with the updated workshop controller.

The integration tests use the actual SDK and controller with injected protocol events and delayed HTTP doubles. In the existing Harness routing, page-only connections receive BOOT and stop through `turn.started` and `state`; `audio.clear` is sent to the audio role. Those three extra audio-clear cases cover duplex/explicit-forwarding SDK behavior, not a claim that page-only clients receive that event on the wire.

Additional offline boundary tests cover one-panel first/top seam versus multiple-panel clarification, ASR homophone/absent unnumbered correction as model evidence, explicit missing numbers, normal cube identity constraints, decision-time scene changes, non-reused object IDs and table-only additions during running/paused welding. These tests inject finite model choices; they do not establish an online model's ASR or semantic accuracy.

## Still requires local acceptance

- Real BOOT press/release through USB/Wi-Fi, final transcription, initial actual screen frame, actual device first audio and final DMA-drained playback.
- Stop/disconnect/reconnect during each request boundary with the actual browser and device; verify accepted mechanical work continues independently of cancelled speech.
- Full browser resize/MathML/occlusion and GPU frame-time acceptance. Cloud Chromium creation was blocked by its socket sandbox; the permitted platform browser could not reach the isolated backend and disallowed file URLs. Offscreen Canvas evidence is not this browser acceptance.
- Keep clocks distinct: Harness durations use its monotonic clock, browser presentation uses browser timing, and ESP playback uses real played samples. Never subtract timestamps from different processes without explicit alignment.
