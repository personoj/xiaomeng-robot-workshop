import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rotate2, fk, ik, ikIterations, makeCloud, farthestPoints, neighborhood,
  PLAN, pointSegmentDistance, clearSegment, planRoute, alongPath,
} from '../frontend/principle-math.js';

const length = p => Math.hypot(...p);
const gap = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const close = (actual, expected, epsilon = 1e-10) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ≠ ${expected}`);
const vectorClose = (actual, expected, epsilon = 1e-10) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((v, i) => close(v, expected[i], epsilon));
};

test('rotation preserves length and relative geometry at every displayed angle', () => {
  const p = [.9, .6], q = [-.2, .8];
  for (let frame = 0; frame <= 1440; frame++) {
    const angle = -Math.PI + frame * Math.PI / 720;
    const rp = rotate2(p, angle), rq = rotate2(q, angle);
    close(length(rp), length(p));
    close(gap(rp, rq), gap(p, q));
    vectorClose(rotate2(rp, -angle), p);
  }
  vectorClose(rotate2([1, 0], Math.PI / 2), [0, 1]);
});

test('forward kinematics retains both physical link lengths over all joint quadrants', () => {
  for (const links of [[1.1, .85], [2, .5]]) {
    for (let a = -Math.PI; a <= Math.PI; a += .13) {
      for (const b of [-Math.PI, -1, 0, .8, Math.PI]) {
        const { elbow, tip } = fk([a, b], links);
        close(length(elbow), links[0]);
        close(gap(tip, elbow), links[1]);
      }
    }
  }
  vectorClose(fk([0, Math.PI / 2], [2, 1]).tip, [2, 1]);
});

test('analytic IK returns two distinct valid branches throughout the reachable annulus', () => {
  for (const radius of [.251, .4, 1, 1.94]) {
    for (let angle = -Math.PI; angle <= Math.PI; angle += .17) {
      const target = [radius * Math.cos(angle), radius * Math.sin(angle)];
      const up = ik(target, [1.1, .85], 1), down = ik(target, [1.1, .85], -1);
      assert.ok(up && down);
      vectorClose(fk(up).tip, target);
      vectorClose(fk(down).tip, target);
      assert.ok(up[1] > 0 && down[1] < 0);
      assert.ok(gap(fk(up).elbow, fk(down).elbow) > 1e-4);
    }
  }
});

test('IK accepts exact workspace boundaries but rejects physically unreachable targets', () => {
  for (let angle = -Math.PI; angle <= Math.PI; angle += .11) {
    for (const radius of [.25, 1.95]) {
      const target = [radius * Math.cos(angle), radius * Math.sin(angle)];
      const q = ik(target);
      assert.ok(q, `boundary radius ${radius} angle ${angle} was rejected`);
      vectorClose(fk(q).tip, target, 1e-7);
    }
  }
  for (const target of [[0, 0], [.249, 0], [1.951, 0], [3, 3]]) {
    assert.equal(ik(target), null);
  }
});

test('DLS animation records real FK errors and takes bounded steps that reduce error', () => {
  for (const target of [[1.35, .9], [.8, .7], [1.7, -.2]]) {
    const frames = ikIterations(target);
    assert.equal(frames.length, 29);
    assert.ok(frames.at(-1).error < 1e-5, `failed to converge at ${target}`);
    for (const [i, frame] of frames.entries()) {
      vectorClose(frame.tip, fk(frame.q).tip);
      vectorClose(frame.elbow, fk(frame.q).elbow);
      close(frame.error, gap(frame.tip, target));
      if (i === 0) continue;
      assert.ok(frame.error <= frames[i - 1].error + 1e-12,
        `error increased from ${frames[i - 1].error} to ${frame.error}`);
      frame.q.forEach((q, k) => assert.ok(Math.abs(q - frames[i - 1].q[k]) <= .180000001));
      // Rendering between solver states must also preserve each rigid link.
      for (let subframe = 0; subframe <= 20; subframe++) {
        const q = frame.q.map((v, k) => frames[i - 1].q[k] + (v - frames[i - 1].q[k]) * subframe / 20);
        const pose = fk(q);
        close(length(pose.elbow), 1.1);
        close(gap(pose.tip, pose.elbow), .85);
      }
    }
  }
});

test('DLS never fabricates a solved pose for an unreachable or singular target', () => {
  const frames = ikIterations([3, 0], [.6, -.8], 80);
  assert.ok(frames.every(frame => frame.q.every(Number.isFinite) && Number.isFinite(frame.error)));
  assert.ok(frames.at(-1).error >= 3 - 1.95 - 1e-10);
  assert.ok(frames.at(-1).error < frames[0].error);
  const singular = ikIterations([1, 0], [0, 0]);
  assert.ok(singular.every(frame => frame.q.every(Number.isFinite)));
  assert.ok(singular.at(-1).error > .1, 'a zero-Jacobian direction must not report fake convergence');
});

test('FPS selects unique input indices and the actual max-min point at every step', () => {
  const points = makeCloud(), selected = farthestPoints(points, 12, 154);
  assert.equal(points.length, 616);
  assert.equal(selected.length, 12);
  assert.equal(selected[0], 154);
  assert.equal(new Set(selected).size, 12);
  for (let step = 1; step < selected.length; step++) {
    const prefix = selected.slice(0, step);
    const minDistances = points.map(point => Math.min(...prefix.map(index => gap(point, points[index]))));
    close(minDistances[selected[step]], Math.max(...minDistances));
  }
  assert.deepEqual(farthestPoints(points, 12, 154), selected, 'the replay must be deterministic');
});

test('FPS handles empty sets, zero requests, duplicate coordinates and oversized requests', () => {
  assert.deepEqual(farthestPoints([], 12), []);
  assert.deepEqual(farthestPoints([[0, 0, 0]], 0), []);
  assert.deepEqual(farthestPoints([[0, 0, 0]], -2), []);
  const points = [[0, 0, 0], [0, 0, 0], [1, 0, 0], [1, 0, 0]];
  const selected = farthestPoints(points, 99);
  assert.equal(selected.length, 4);
  assert.equal(new Set(selected).size, 4);
  assert.equal(selected[1], 2);
  assert.throws(() => farthestPoints(points, 1, -1), RangeError);
  assert.throws(() => farthestPoints(points, 1, 4), RangeError);
});

test('ball query uses 3D Euclidean distance with an inclusive spherical boundary', () => {
  const points = [[0, 0, 2], [0, 0, .5], [.3, .4, 0], [.3, .4, .01], [0, 0, 0]];
  assert.deepEqual(neighborhood(points, [0, 0, 0], .5), [1, 2, 4]);
  assert.deepEqual(neighborhood(points, [0, 0, 0], 0), [4]);
  const cloud = makeCloud(), center = cloud[154];
  for (let frame = 0; frame <= 240; frame++) {
    const radius = .6 * frame / 240;
    const selected = new Set(neighborhood(cloud, center, radius));
    cloud.forEach((point, index) => assert.equal(selected.has(index), gap(point, center) <= radius));
  }
});

test('segment collision checks the entire edge, including tangent and degenerate edges', () => {
  close(pointSegmentDistance([0, 1], [-1, 0], [1, 0]), 1);
  close(pointSegmentDistance([3, 4], [0, 0], [0, 0]), 5);
  close(pointSegmentDistance([3, 0], [-1, 0], [1, 0]), 2);
  const obstacle = { c: [4.1, 4], r: 1 };
  const plan = { obstacles: [obstacle], body: .3, margin: .22 };
  assert.equal(clearSegment([1, 4], [9, 4], plan), false, 'clear endpoints do not imply a clear edge');
  assert.equal(clearSegment([1, 5.6], [9, 5.6], plan), true);
  assert.equal(clearSegment([4.1, 4], [4.1, 4], plan), false);
  const tangentPlan = { obstacles: [{ c: [0, 0], r: .5 }], body: .3, margin: .2 };
  assert.equal(clearSegment([-2, 1], [2, 1], tangentPlan), true);
  assert.equal(clearSegment([-2, .999], [2, .999], tangentPlan), false);
});

test('unobstructed A* chooses a shortest eight-connected grid route', () => {
  const plan = { start: [1, 1], goal: [2, 1.5], body: .3, margin: .22, obstacles: [] };
  const route = planRoute(plan);
  const traveled = route.path.slice(1).reduce((sum, point, i) => sum + gap(point, route.path[i]), 0);
  close(traveled, .25 * (2 + 2 * Math.SQRT2));
  assert.deepEqual(route.simplified, [plan.start, plan.goal]);
});

test('A* forbids diagonals between blocked cardinal neighbors and rejects blocked endpoints', () => {
  const plan = {
    start: [1, 1], goal: [1.25, 1.25], body: 0, margin: 0,
    obstacles: [{ c: [1.25, 1], r: .07 }, { c: [1, 1.25], r: .07 }],
  };
  const route = planRoute(plan);
  vectorClose(route.path[0], plan.start);
  vectorClose(route.path.at(-1), plan.goal);
  assert.ok(route.path.length > 2, 'a blocked grid corner cannot be crossed diagonally');
  const blocked = planRoute({ ...plan, obstacles: [{ c: plan.start, r: .1 }] });
  assert.equal(blocked.path.length, 0);
  assert.equal(blocked.simplified.length, 0);
});

test('A* and every shortcut edge leave the required disk radius plus clearance', () => {
  const route = planRoute();
  assert.ok(route.visited.length > route.path.length);
  assert.ok(route.simplified.length < route.path.length);
  for (const path of [route.path, route.simplified]) {
    vectorClose(path[0], PLAN.start);
    vectorClose(path.at(-1), PLAN.goal);
    // Dense independent edge sampling catches interior collisions, beyond vertex checks.
    for (let i = 1; i < path.length; i++) {
      for (let sample = 0; sample <= 300; sample++) {
        const p = path[i].map((v, k) => path[i - 1][k] + (v - path[i - 1][k]) * sample / 300);
        for (const obstacle of PLAN.obstacles) {
          assert.ok(gap(p, obstacle.c) - obstacle.r - PLAN.body >= PLAN.margin - 1e-10);
        }
      }
    }
  }
  // This is more frequent than a 60 fps, 8 second playback, including both endpoints.
  for (let frame = 0; frame <= 1920; frame++) {
    const p = alongPath(route.simplified, frame / 1920);
    for (const obstacle of PLAN.obstacles) {
      assert.ok(gap(p, obstacle.c) >= obstacle.r + PLAN.body + PLAN.margin - 1e-10);
    }
  }
});

test('path interpolation uses traveled length, clamps time and handles repeated vertices', () => {
  const path = [[0, 0], [3, 0], [3, 0], [3, 4]];
  vectorClose(alongPath(path, -.2), [0, 0]);
  vectorClose(alongPath(path, 1 / 7), [1, 0]);
  vectorClose(alongPath(path, 3 / 7), [3, 0]);
  vectorClose(alongPath(path, 4 / 7), [3, 1]);
  vectorClose(alongPath(path, 1.2), [3, 4]);
  vectorClose(alongPath([[2, 5]], .5), [2, 5]);
  vectorClose(alongPath([[2, 5], [2, 5]], .5), [2, 5]);
  assert.equal(alongPath([], .5), undefined);
  for (let frame = 1; frame <= 140; frame++) {
    close(gap(alongPath(path, frame / 140), alongPath(path, (frame - 1) / 140)), .05);
  }
});
