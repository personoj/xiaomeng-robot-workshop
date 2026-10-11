import test from 'node:test';
import assert from 'node:assert/strict';
import { PrincipleTimeline } from '../frontend/principle-timeline.js';
import { LESSONS, lessonById, lessonDuration } from '../frontend/principle-lessons.js';

const firstTopic = 'coordinates';
const secondTopic = 'inverse_kinematics';

test('timeline can run every lesson with no browser, robot service, or network access', t => {
  const network = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('independent teaching playback must not invoke a service');
  });
  assert.equal(typeof window, 'undefined');
  for (const lesson of LESSONS) {
    const timeline = new PrincipleTimeline();
    assert.deepEqual(timeline.snapshot(), { status: 'idle', topic: null, runId: null, elapsed: 0, duration: 0 });
    assert.equal(timeline.tick(20), false);
    timeline.load(lesson.id);
    timeline.tick(lessonDuration(lesson));
    assert.equal(timeline.snapshot().status, 'completed');
    assert.equal(timeline.snapshot().progress, 1);
  }
  assert.equal(network.mock.callCount(), 0);
});

test('pause freezes progress, resume continues at the same point and stop clears the lesson', () => {
  const timeline = new PrincipleTimeline();
  const initial = timeline.load(firstTopic);
  timeline.tick(12.5);
  const paused = timeline.pause();
  assert.equal(paused.elapsed, 12.5);
  assert.equal(paused.status, 'paused');
  for (const dt of [0, .016, 5, 1000]) assert.equal(timeline.tick(dt), false);
  assert.deepEqual(timeline.snapshot(), paused);
  const resumed = timeline.resume();
  assert.equal(resumed.elapsed, 12.5);
  assert.equal(resumed.runId, initial.runId);
  timeline.tick(.5);
  assert.equal(timeline.snapshot().elapsed, 13);
  timeline.stop();
  assert.equal(timeline.snapshot().status, 'idle');
  assert.equal(timeline.snapshot().runId, null);
  assert.equal(timeline.tick(50), false);
  assert.equal(timeline.resume().status, 'idle');
});

test('seek clamps time, preserves pause, and a completed lesson can be replayed', () => {
  const timeline = new PrincipleTimeline();
  const loaded = timeline.load(firstTopic, { autoplay: false });
  assert.equal(loaded.status, 'paused');
  assert.equal(timeline.seek(-200).elapsed, 0);
  assert.equal(timeline.seek(10).status, 'paused');
  const end = timeline.seek(100000);
  assert.equal(end.elapsed, end.duration);
  assert.equal(end.status, 'completed');
  assert.equal(end.progress, 1);
  assert.equal(timeline.seek(5).status, 'paused');
  timeline.resume();
  assert.equal(timeline.seek(6).status, 'playing');
  timeline.seek(end.duration);
  const replay = timeline.resume();
  assert.equal(replay.elapsed, 0);
  assert.equal(replay.step, 0);
  assert.equal(replay.progress, 0);
  assert.equal(replay.status, 'playing');
  assert.notEqual(replay.runId, end.runId);
});

test('step boundaries switch exactly once and completion uses the final step at progress one', () => {
  const timeline = new PrincipleTimeline();
  timeline.load(firstTopic);
  const lesson = lessonById(firstTopic);
  const before = timeline.seekStep(0, 1 - 1e-9);
  assert.equal(before.step, 0);
  assert.ok(before.progress < 1);
  const boundary = timeline.seekStep(0, 1);
  assert.equal(boundary.elapsed, lesson.steps[0].seconds);
  assert.equal(boundary.step, 1);
  assert.equal(boundary.progress, 0);
  const end = timeline.seekStep(lesson.steps.length - 1, 1);
  assert.equal(end.status, 'completed');
  assert.equal(end.step, lesson.steps.length - 1);
  assert.equal(end.progress, 1);
  assert.equal(timeline.tick(1), false);
  assert.deepEqual(timeline.snapshot(), end);
});

test('invalid requests are rejected atomically and invalid tick intervals do not advance time', () => {
  const timeline = new PrincipleTimeline();
  assert.throws(() => timeline.seek(0));
  assert.throws(() => timeline.seekStep(0));
  timeline.load(firstTopic);
  timeline.tick(4);
  const unchanged = timeline.snapshot();
  for (const seconds of [NaN, Infinity, -Infinity, -1, undefined, '1']) {
    assert.equal(timeline.tick(seconds), false);
    assert.deepEqual(timeline.snapshot(), unchanged);
  }
  for (const seconds of [NaN, Infinity, -Infinity, undefined, '1']) {
    assert.throws(() => timeline.seek(seconds));
    assert.deepEqual(timeline.snapshot(), unchanged);
  }
  for (const [step, progress] of [[-1, 0], [4, 0], [.5, 0], [0, -1], [0, 1.01], [0, NaN], [0, Infinity]]) {
    assert.throws(() => timeline.seekStep(step, progress));
    assert.deepEqual(timeline.snapshot(), unchanged);
  }
  assert.throws(() => timeline.load('not_a_lesson'));
  assert.throws(() => timeline.load(secondTopic, { mode: 'audio-ish' }));
  assert.deepEqual(timeline.snapshot(), unchanged);
});

test('generation token stays unique even when multiple topics start in the same millisecond', t => {
  t.mock.method(Date, 'now', () => 12345);
  const timeline = new PrincipleTimeline();
  const ids = [];
  for (let i = 0; i < 20; i++) ids.push(timeline.load(LESSONS[i % LESSONS.length].id).runId);
  assert.equal(new Set(ids).size, ids.length);
});

test('automatic playback rejects narration cues, even when the run token is current', () => {
  const timeline = new PrincipleTimeline();
  const initial = timeline.load(firstTopic);
  const cue = timeline.sync({ runId: initial.runId, step: 2, progress: .6 });
  assert.equal(cue.accepted, false);
  assert.deepEqual(timeline.snapshot(), initial);
  timeline.tick(2);
  assert.equal(timeline.snapshot().elapsed, 2);
});

test('narration mode follows valid audio progress only and refuses paused or completed cues', () => {
  const timeline = new PrincipleTimeline();
  const initial = timeline.load(firstTopic, { mode: 'narration' });
  assert.equal(timeline.tick(1000), false);
  assert.equal(timeline.snapshot().elapsed, 0);
  const cue = timeline.sync({ runId: initial.runId, step: 1, progress: .5 });
  assert.equal(cue.accepted, true);
  assert.equal(cue.step, 1);
  assert.equal(cue.progress, .5);
  assert.equal(cue.runId, initial.runId, 'ordinary audio progress preserves its current run');
  const paused = timeline.pause();
  assert.notEqual(paused.runId, initial.runId, 'pause must invalidate queued audio');
  assert.equal(timeline.sync({ runId: initial.runId, step: 2, progress: .5 }).accepted, false);
  assert.equal(timeline.sync({ runId: paused.runId, step: 2, progress: .5 }).accepted, false);
  assert.deepEqual(timeline.snapshot(), paused);
  const resumed = timeline.resume();
  assert.equal(resumed.elapsed, paused.elapsed);
  assert.equal(timeline.sync({ runId: initial.runId, step: 2, progress: .5 }).accepted, false);
  const end = timeline.sync({ runId: resumed.runId, step: 3, progress: 1 });
  assert.equal(end.accepted, true);
  assert.equal(end.status, 'completed');
  const completed = timeline.snapshot();
  assert.equal(timeline.sync({ runId: resumed.runId, step: 0 }).accepted, false);
  assert.deepEqual(timeline.snapshot(), completed);
});

test('topic changes and stop invalidate cues from an older narration run', () => {
  const timeline = new PrincipleTimeline();
  const old = timeline.load(firstTopic, { mode: 'narration' });
  const current = timeline.load(secondTopic, { mode: 'narration' });
  assert.notEqual(old.runId, current.runId);
  assert.equal(timeline.sync({ runId: old.runId, step: 2, progress: .5 }).accepted, false);
  assert.deepEqual(timeline.snapshot(), current);
  timeline.stop();
  assert.equal(timeline.sync({ runId: current.runId, step: 2, progress: .5 }).accepted, false);
  assert.equal(timeline.snapshot().status, 'idle');
});

test('late narration cues within the current run cannot reverse the animation', () => {
  const timeline = new PrincipleTimeline();
  const { runId } = timeline.load(firstTopic, { mode: 'narration' });
  timeline.sync({ runId, step: 1, progress: .6 });
  const current = timeline.snapshot();
  for (const cue of [{ runId, step: 0, progress: .9 }, { runId, step: 1, progress: .5 }]) {
    assert.equal(timeline.sync(cue).accepted, false);
    assert.deepEqual(timeline.snapshot(), current);
  }
  assert.equal(timeline.sync({ runId, step: 1, progress: .7 }).accepted, true);
});

test('explicit narration seek invalidates queued audio from the pre-seek position', () => {
  const timeline = new PrincipleTimeline();
  const old = timeline.load(firstTopic, { mode: 'narration' });
  timeline.sync({ runId: old.runId, step: 2, progress: .5 });
  const replay = timeline.seekStep(0, 0);
  assert.notEqual(replay.runId, old.runId, 'the audio adapter needs a new generation for replay');
  assert.equal(timeline.sync({ runId: old.runId, step: 2, progress: .6 }).accepted, false);
  assert.deepEqual(timeline.snapshot(), replay);
  assert.equal(timeline.sync({ runId: replay.runId, step: 0, progress: .1 }).accepted, true);
});

test('invalid narration step/progress cannot partially mutate the current lesson', () => {
  const timeline = new PrincipleTimeline();
  const initial = timeline.load(firstTopic, { mode: 'narration' });
  for (const cue of [{ step: -1 }, { step: 4 }, { step: 0, progress: NaN }, { step: 0, progress: 1.1 }]) {
    assert.throws(() => timeline.sync({ runId: initial.runId, ...cue }));
    assert.deepEqual(timeline.snapshot(), initial);
  }
});
