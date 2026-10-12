import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {CameraTransition} from '../frontend/camera-transition.js';
import {WorkshopScene} from '../frontend/workshop-scene.js';

const A = {position: [-2, -8, 5], target: [0, 0, 1]};
const B = {position: [-2.34, -2.02, 1.97], target: [-2.28, -.30, 1]};
const C = {position: [1.4, .1, 2.2], target: [3, 1.85, 1.58]};
const poseOf = scene => ({position: scene.camera.position.toArray(), target: scene.controls.target.toArray()});
const closePose = (actual, expected) => {
  for (const key of ['position', 'target']) for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(actual[key][i] - expected[key][i]) < 1e-10,
      `${key}[${i}]: ${actual[key][i]} != ${expected[key][i]}`);
  }
};

test('camera interpolation eases both endpoints, stays bounded, and ends exactly', () => {
  const motion = new CameraTransition();
  assert.deepEqual(motion.start(A, B, 100), A);
  assert.deepEqual(motion.sample(50), A);
  const middle = motion.sample(280);
  for (const key of ['position', 'target']) {
    assert.deepEqual(middle[key], A[key].map((value, i) => value + (B[key][i] - value) / 2));
    const early = motion.sample(136)[key];
    for (let i = 0; i < 3; i++) {
      assert.ok(early[i] >= Math.min(A[key][i], B[key][i]));
      assert.ok(early[i] <= Math.max(A[key][i], B[key][i]));
      assert.ok(Math.abs(early[i] - A[key][i]) <= Math.abs(B[key][i] - A[key][i]) * .1);
    }
  }
  assert.deepEqual(motion.sample(460), B);
  assert.equal(motion.active, false);
  assert.equal(motion.sample(1000), null);
});

test('newest A to B to C transition starts at the displayed pose without stale completion', () => {
  const motion = new CameraTransition();
  motion.start(A, B, 0);
  const displayed = motion.sample(120);
  assert.deepEqual(motion.start(displayed, C, 120), displayed);
  assert.deepEqual(motion.sample(120), displayed);
  assert.notDeepEqual(motion.sample(360), B);
  assert.deepEqual(motion.sample(1000), C);
});

test('cancellation, immediate and identical destinations never leave active work', () => {
  const motion = new CameraTransition();
  motion.start(A, B, 0);
  motion.cancel();
  assert.equal(motion.sample(500), null);
  assert.equal(motion.finish(), null);
  assert.deepEqual(motion.start(A, C, 0, {immediate: true}), C);
  assert.equal(motion.active, false);
  assert.deepEqual(motion.start(B, B, 0), B);
  assert.equal(motion.active, false);
  assert.deepEqual(new CameraTransition(0).start(A, B, 0), B);
});

test('coordinator copies input and output poses instead of retaining mutable vectors', () => {
  const motion = new CameraTransition();
  const from = structuredClone(A), to = structuredClone(B);
  const first = motion.start(from, to, 0);
  from.position[0] = 900; to.target[0] = 900; first.position[0] = 900;
  assert.deepEqual(motion.sample(0), A);
  assert.deepEqual(motion.finish(), B);
  assert.equal(motion.active, false);
});

// Node integration uses actual Three.js cameras and OrbitControls, with only the
// DOM, render submission and RAF clock replaced. It is not a browser/GPU test.
class EventHost {
  constructor() { this.listeners = new Map(); this.style = {}; }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type, event = {}) {
    for (const callback of [...(this.listeners.get(type) || [])]) callback({type, ...event});
  }
}

function harness({reduced = false, setup = true} = {}) {
  let now = 0, nextFrame = 0, draws = 0;
  const frames = new Map();
  const originals = Object.fromEntries(['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'matchMedia']
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const preference = new EventHost(); preference.matches = reduced;
  Object.assign(globalThis, {
    requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id),
    performance: {now: () => now},
    matchMedia: () => preference,
  });
  const document = new EventHost(), dom = new EventHost();
  Object.assign(dom, {
    clientWidth: 960, clientHeight: 640,
    getRootNode: () => document,
    setPointerCapture() {}, releasePointerCapture() {}, remove() {},
    getBoundingClientRect: () => ({left: 0, top: 0, width: 960, height: 640}),
  });
  const scene = Object.create(WorkshopScene.prototype);
  scene.container = dom;
  scene.camera = new T.PerspectiveCamera(36, 1.5, .01, 100);
  scene.camera.up.set(0, 0, 1);
  scene.camera.position.fromArray(A.position);
  scene.controls = new OrbitControls(scene.camera, dom);
  scene.controls.target.fromArray(A.target);
  scene.controls.enableDamping = true;
  scene.controls.dampingFactor = .08;
  scene.controls.minDistance = .5;
  scene.controls.maxDistance = 50;
  scene.controls.maxPolarAngle = Math.PI * .49;
  scene.controls.update();
  scene.controls.addEventListener('change', () => scene.requestRender());
  scene.latestObjects = [{id: 'panel_2', kind: 'panel', position: [3, 2, 1.5]}];
  scene.labels = new Map(); scene.objects = new Map();
  scene.scene = new T.Scene(); scene.robot = new T.Group(); scene.scene.add(scene.robot);
  scene.weldFX = {dispose() {}};
  scene.observer = {disconnect() {}};
  scene.renderer = {domElement: dom, dispose() {}, forceContextLoss() {}};
  scene.drawScene = () => { draws++; };
  if (setup) scene.setupCameraTransitions();
  const step = (milliseconds = 16) => {
    now += milliseconds;
    const pending = [...frames.values()]; frames.clear();
    for (const callback of pending) callback(now);
  };
  const settle = () => { for (let i = 0; i < 400 && frames.size; i++) step(); assert.equal(frames.size, 0); };
  return {
    scene, dom, frames, preference, step, settle,
    get draws() { return draws; },
    drag(type, x = 100, y = 100, overrides = {}) {
      dom.emit(type, {pointerId: 1, pointerType: 'mouse', button: 0,
        clientX: x, clientY: y, pageX: x, pageY: y, ...overrides});
    },
    restore() {
      scene.dispose();
      for (const [key, descriptor] of Object.entries(originals)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
      }
    },
  };
}

function legacyHome(scene) {
  const camera = scene.camera.clone();
  const right = Math.max(5.5, ...scene.latestObjects.map(o => o.position[0] + (o.kind === 'panel' ? 1.2 : o.kind === 'welder' ? 1.5 : 0)));
  const centre = new T.Vector3((right - 3.1) / 2, .15, 1.15), direction = new T.Vector3(-.4, -1, .65).normalize();
  camera.position.copy(centre).addScaledVector(direction, 20); camera.lookAt(centre); camera.updateMatrixWorld(true);
  const inverse = camera.quaternion.clone().invert(), tan = Math.tan(camera.fov * Math.PI / 360);
  let distance = 0;
  for (const x of [-3.1, right]) for (const y of [-2.5, 2.75]) for (const z of [0, 2.6]) {
    const p = new T.Vector3(x, y, z).sub(centre).applyQuaternion(inverse);
    distance = Math.max(distance, p.z + Math.abs(p.x) / (tan * camera.aspect * .90), p.z + Math.abs(p.y) / (tan * .90));
  }
  return {target: centre.toArray(), position: centre.clone().addScaledVector(direction, distance).toArray()};
}

test('home is safe before subclass setup and initial server view is immediate and stable', () => {
  const h = harness({setup: false});
  try {
    const expected = legacyHome(h.scene);
    h.scene.cameraHome(); h.settle(); closePose(poseOf(h.scene), expected);
    assert.equal(h.scene.cameraMotion, undefined);
    h.scene.setupCameraTransitions();
    h.scene.applyView(1, 0); h.settle(); closePose(poseOf(h.scene), B);
    assert.equal(h.scene.cameraMotion.active, false);
    assert.equal(h.frames.size, 0);
  } finally { h.restore(); }
});

test('scene presets replace smoothly, duplicate state does not restart, world identity is preserved', () => {
  const h = harness();
  try {
    const world = h.scene.scene, robot = h.scene.robot, objects = structuredClone(h.scene.latestObjects);
    h.scene.applyView(1, 0); h.settle();
    h.scene.applyView(3, 1, 'panel_2'); closePose(poseOf(h.scene), B);
    const firstMotion = h.scene.cameraMotion.motion;
    h.scene.applyView(3, 1, 'panel_2'); assert.equal(h.scene.cameraMotion.motion, firstMotion);
    h.step(120); const visible = poseOf(h.scene);
    h.scene.applyView(2, 2); closePose(poseOf(h.scene), visible);
    h.step(60); const next = poseOf(h.scene);
    h.scene.applyView(3, 3, 'panel_2'); closePose(poseOf(h.scene), next);
    h.settle(); closePose(poseOf(h.scene), C);
    assert.equal(h.scene.cameraMotion.active, false);
    assert.equal(h.scene.scene, world); assert.equal(h.scene.robot, robot);
    assert.deepEqual(h.scene.latestObjects, objects);
    const draws = h.draws; h.step(10000); assert.equal(h.draws, draws);
    h.scene.applyView(3, 4, 'panel_2');
    assert.equal(h.scene.cameraMotion.active, false); h.settle();
  } finally { h.restore(); }
});

test('actual OrbitControls drag cancels a transition and newer presets clear residual inertia', () => {
  const h = harness();
  try {
    h.scene.applyView(1, 0); h.settle();
    h.scene.applyView(3, 1, 'panel_2'); h.step(100);
    const before = poseOf(h.scene);
    h.drag('pointerdown');
    assert.equal(h.scene.cameraMotion.active, false);
    closePose(poseOf(h.scene), before);
    h.drag('pointermove', 160, 110);
    assert.notDeepEqual(poseOf(h.scene), before);
    h.drag('pointerup', 160, 110);
    const afterDrag = poseOf(h.scene);
    h.scene.applyView(1, 2); closePose(poseOf(h.scene), afterDrag);
    assert.equal(h.scene.controls.enableDamping, true);
    h.settle(); closePose(poseOf(h.scene), B);
    h.scene.applyView(3, 3, 'panel_2'); h.step(100);
    h.drag('pointerdown'); h.drag('pointermove', 130, 100); h.drag('pointerup', 130, 100);
    h.settle(); const manual = poseOf(h.scene);
    assert.notDeepEqual(manual, C);
    h.step(10000); closePose(poseOf(h.scene), manual);
    h.scene.applyView(3, 3, 'panel_2'); // Repeated server snapshot cannot reclaim the camera.
    closePose(poseOf(h.scene), manual); assert.equal(h.frames.size, 0);
  } finally { h.restore(); }
});

test('actual OrbitControls wheel and touch start interrupt the camera motion', () => {
  const h = harness();
  try {
    h.scene.applyView(1, 0); h.settle();
    h.scene.applyView(3, 1, 'panel_2'); h.step(60);
    h.dom.emit('wheel', {deltaY: 100, deltaMode: 0, clientX: 100, clientY: 100, preventDefault() {}});
    assert.equal(h.scene.cameraMotion.active, false); h.settle();
    h.scene.applyView(1, 2); h.step(60);
    h.drag('pointerdown', 100, 100, {pointerType: 'touch'});
    assert.equal(h.scene.cameraMotion.active, false);
    h.drag('pointerup', 100, 100, {pointerType: 'touch'}); h.settle();
  } finally { h.restore(); }
});

test('a preset arriving during a held orbit gesture cannot fight the user', () => {
  const h = harness();
  try {
    h.scene.applyView(1, 0); h.settle();
    h.drag('pointerdown'); h.drag('pointermove', 140, 100);
    const manual = poseOf(h.scene);
    h.scene.applyView(3, 1, 'panel_2');
    closePose(poseOf(h.scene), manual);
    assert.equal(h.scene.cameraMotion.active, false);
    h.drag('pointermove', 150, 100); h.drag('pointerup', 150, 100); h.settle();
    h.scene.applyView(3, 2, 'panel_2'); h.settle(); closePose(poseOf(h.scene), C);
  } finally { h.restore(); }
});

test('reduced motion is immediate and enabling it mid-flight finishes once then sleeps', () => {
  const h = harness({reduced: true});
  try {
    h.scene.applyView(1, 0); h.settle();
    h.scene.applyView(3, 1, 'panel_2'); closePose(poseOf(h.scene), C);
    assert.equal(h.scene.cameraMotion.active, false); h.settle();
    h.preference.matches = false; h.preference.emit('change');
    h.scene.applyView(1, 2); h.step(80);
    assert.equal(h.scene.cameraMotion.active, true);
    h.preference.matches = true; h.preference.emit('change');
    closePose(poseOf(h.scene), B);
    assert.equal(h.scene.cameraMotion.active, false); h.settle();
    const draws = h.draws; h.step(10000); assert.equal(h.draws, draws);
  } finally { h.restore(); }
});

test('home interruption is immediate and overview retargets safely when resized during motion', () => {
  const h = harness();
  try {
    h.scene.applyView(1, 0); h.settle();
    h.scene.applyView(3, 1, 'panel_2'); h.step(60);
    h.scene.cameraHome(); closePose(poseOf(h.scene), legacyHome(h.scene));
    assert.equal(h.scene.cameraMotion.active, false); h.settle();
    h.scene.applyView(1, 2); h.settle();
    h.scene.applyView(2, 3); h.step(80);
    const beforeResize = poseOf(h.scene);
    h.scene.camera.aspect = .7; h.scene.camera.updateProjectionMatrix();
    h.scene.requestRender(); h.step(16);
    closePose(poseOf(h.scene), beforeResize);
    h.settle(); closePose(poseOf(h.scene), legacyHome(h.scene));
    assert.equal(h.frames.size, 0);
  } finally { h.restore(); }
});

test('hidden scene does not spin RAF and finishes on the next visible render', () => {
  const h = harness();
  try {
    h.scene.applyView(1, 0); h.settle();
    h.scene.applyView(3, 1, 'panel_2');
    h.dom.clientHeight = 0; h.step(2000);
    assert.equal(h.frames.size, 0);
    h.dom.clientHeight = 640; h.scene.requestRender(); h.step(); h.settle();
    closePose(poseOf(h.scene), C);
    assert.equal(h.scene.cameraMotion.active, false);
  } finally { h.restore(); }
});

test('dispose cancels pending render and motion, removes listeners and prevents later writes', () => {
  const h = harness();
  try {
    h.scene.applyView(1, 0); h.settle();
    h.scene.applyView(3, 1, 'panel_2');
    const pending = [...h.frames.values()], before = poseOf(h.scene), draws = h.draws;
    h.scene.dispose();
    assert.equal(h.frames.size, 0); assert.equal(h.scene.cameraMotion.active, false);
    assert.equal(h.preference.listeners.get('change').size, 0);
    assert.equal(h.scene.controls._listeners.start.length, 0);
    assert.equal(h.scene.controls._listeners.end.length, 0);
    for (const callback of pending) callback(5000);
    h.scene.applyView(1, 2); h.scene.cameraHome(); h.scene.focus('panel');
    h.preference.matches = true; h.preference.emit('change'); h.step(1000);
    closePose(poseOf(h.scene), before); assert.equal(h.draws, draws);
    assert.equal(h.frames.size, 0);
  } finally { h.restore(); }
});
