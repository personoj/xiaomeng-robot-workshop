# Offline performance review (2026-10-11)

## Scope and baseline

Baseline is public snapshot `be50a45966674425785cf0cb4732b03a274bbb1b`, not the historical timings in `PERFORMANCE.md`. Measurements use the same Node version, dependencies, synthetic panel/seam/robot input, and cloud machine. The reproducible harness alternates baseline/current in serial, fresh Node processes. OS filesystem caches are warm; module loading and model construction are cold in each process. No CPU affinity or dedicated physical host is assumed.

```sh
node scripts/benchmark-workshop-performance.mjs \
  --baseline /path/to/untouched/xiaoyun-robot-demo \
  --output /path/to/evidence --runs 3
node --test tests/welding-performance.test.mjs tests/voice-performance.test.mjs \
  tests/xiaoyun-presentation.test.mjs
```

The baseline needs the same installed dependencies (`npm ci` from its lockfile, or a link to this checkout's identical dependency tree). The benchmark performs no HTTP/API calls or persistent workshop mutations. Raw outputs include every pose-update duration, CPU user/system time, wall time, maximum RSS, environment fields, full plan JSON and its SHA-256. The harness refuses differing full plans.

## Measured result

Three clean baseline/current pairs on Node 24.19.0, Linux 6.18.44, AMD EPYC 9V74 (9 visible logical CPUs, 9 available parallelism; 10,451,464,192 host-reported memory bytes). Container CPU/memory limit files were unavailable. A pre-existing animation audit overlapped the start of the initial first pair; that whole pair was excluded, retained in raw evidence, and replaced with one complete quiet pair. The reported pairs are original runs 2/3 plus the replacement run.

| CPU workload | Baseline | Current | Change |
|---|---:|---:|---:|
| Complete preflight, median wall | 24.956 s | 13.124 s | −47.4% |
| Complete preflight, median user+system CPU | 26.308 s | 14.311 s | −45.6% |
| Pose/cable-display replay, median wall including initialization | 25.597 s | 14.066 s | −45.0% |
| Pose/cable-display replay, median user+system CPU | 26.531 s | 14.766 s | −44.3% |
| Pose update p50 (7,335 pooled updates per version) | 10.015 ms | 5.365 ms | CPU cost only |
| Pose update p95 | 12.138 ms | 6.766 ms | CPU cost only |
| Pose update p99 | 14.961 ms | 8.717 ms | CPU cost only |
| Pose-replay process peak RSS, range across runs | 305.9–324.1 MiB | 228.4–231.1 MiB | Includes initialization and measurement arrays |
| Preflight process peak RSS, range across runs | 359.0–389.1 MiB | 353.6–387.0 MiB | No robust memory reduction claimed |

All six clean full-plan outputs are exactly JSON-equal: 2,445 frames, 14 stitches, locked parked base, maximum cable length error 0.038964 mm, connector error below `1.4e-12` mm, maximum tip error 0.017436 mm, and no rejected collision in the accepted plan. These are model checks, not physical welding certification. Complete-plan SHA-256: `99ff052e20c8c0d719f7e6f3d4c004189e02b319f0fffd2d9b05e4dab962db5b`.

Raw evidence from this cloud run is delivered with the review under `evidence/performance/`: `clean-results.json`, original `final/` and clean `replacement/` runs, `measurement-exclusions.json`, source hashes, exploratory CPU profiles, regression logs and the baseline 2 mm stale-connector reproduction. No historical machine timing was used as a denominator. The very short idle scheduler-double wall/CPU timings are retained as raw data but are not used to claim browser CPU savings.

## Changes and safety boundaries

- `DressCurve.getPoint` computes the same Bernstein polynomial without a new weights array or repeated general powers per sample. A 4,097-point comparison with the original definition bounds the numerical difference below `1e-14` metres.
- The innermost cable-pair AABB rejection uses the same x/y/z inequalities directly. Capsule/triangle checks, sampled segment count, bend radii, fixed lengths, thresholds, self-collision loops, rigid collisions, obstacle validation and every angular substep remain unchanged.
- Cable cache keys include the local transform and parent of every node on each anchor path. Rigid world placement cancels in the arm coordinate frame; wrist joints J4–J6 are not cable anchors. An anchor outside the model root disables reuse. Cache size remains bounded. Every hit still calls the complete collision validator.
- The baseline cache accepted a stale route after a connector was moved by 2 mm, leaving a 2 mm gap. The regression checks route invalidation and exact connector attachment, as well as a newly inserted world obstacle rejecting an otherwise cached pose.
- Offline display meshes remain disabled only through the existing `renderCables:false` option. Cached/offline and uncached/displayed models are compared across accepted/rejected moves, matching substep counts, fixed-length curves, diagnostics and rejection rollback.
- `VoiceVisuals` now sleeps once levels decay to zero. Telemetry/reset/resize wakes one coalesced RAF; a lone transcript uses its original expiry time. Disposal cancels both the frame and timeout. Active wave styling, particle counts, safety checks and playback clocks are not reduced or replaced.

## What the measurements mean

`preflight` is the complete 2,445-frame, 14-stitch offline plan, including model loading and all safety substeps. `weld-pose` replays that same plan through the browser's pose/cable-display-mesh update path in Node (`renderCables:true`, `endpointOnly:true`), after recording initialization separately. Its p50/p95/p99 are CPU pose-update costs, **not rendered frame intervals**. This matches the browser's endpoint display update only; the preflight still validates intermediate angular substeps.

`idle-meter` uses deterministic DOM and scheduler doubles for 18,000 simulated 60 Hz ticks. Baseline schedules 18,000 RAF callbacks and 36,000 dataset writes; current schedules one callback and two writes. Both draw the idle wave once. This is a scheduling count, **not a five-minute browser CPU run or FPS claim**. Regression tests cover wake, decay, stale telemetry, text expiry, resize, reset, coalescing and disposal.

## Browser and hardware acceptance still required

The cloud Chromium launch was blocked by the execution environment's Unix socket restriction. No bypass was attempted. Browser/GPU performance acceptance remains open:

| Scenario | Local evidence | Still unmeasured |
|---|---|---|
| Idle | Deterministic voice-meter scheduler regression | Browser CPU, actual RAF/frame intervals, GPU, long tasks |
| Grasp/place | Existing FK/interpolation regression suite | Browser frame/CPU/network profile during real simulated grasp |
| Principle only | Separate principle math/Canvas checks | Integrated browser panel GPU/frame profile |
| Weld preflight | Complete real offline planner CPU/wall/RSS and plan equality | Browser responsiveness while the service plans |
| Weld animation | Real model/cable-display geometry CPU replay | GPU rendering, frame pacing, draw calls/triangles, visual parity |
| Welding + principle | Independent component checks only | Concurrent browser workload and real audio synchronization |
| Add/remove props | Existing state/controller tests | Browser memory/resource disposal, asset load count and network bytes |

Run the browser comparison in an allowed environment with the same browser build, viewport, DPR, zoom and warm/cold cache policy. Capture at least the seven scenarios above, raw frame intervals/p50/p95/p99, long tasks, renderer calls/triangles, asset loads, transfer bytes, process CPU and memory. Hardware, cloud-model, actual first-visible-frame and ESP32 acoustic/played-sample measurements were not performed. Nothing here establishes stable 60 FPS or end-to-end voice latency.
