const copyPose = pose => ({position: [...pose.position], target: [...pose.target]});
const samePose = (a, b) => ['position', 'target'].every(key =>
  a[key].every((value, index) => Math.abs(value - b[key][index]) < 1e-10));

// Presentation only. The scene owns rendering; an idle coordinator schedules nothing.
export class CameraTransition {
  constructor(duration = 360) {
    this.duration = duration;
    this.motion = null;
  }

  get active() { return this.motion !== null; }

  start(from, to, now, {immediate = false} = {}) {
    this.cancel();
    if (immediate || this.duration <= 0 || samePose(from, to)) return copyPose(to);
    this.motion = {from: copyPose(from), to: copyPose(to), started: now};
    return copyPose(from);
  }

  sample(now) {
    if (!this.motion) return null;
    const {from, to, started} = this.motion;
    const t = Math.max(0, Math.min(1, (now - started) / this.duration));
    if (t === 1) return this.finish();
    const eased = t * t * (3 - 2 * t);
    const interpolate = key => from[key].map((value, index) =>
      value + (to[key][index] - value) * eased);
    return {position: interpolate('position'), target: interpolate('target')};
  }

  finish() {
    const pose = this.motion ? copyPose(this.motion.to) : null;
    this.cancel();
    return pose;
  }

  cancel() { this.motion = null; }
}
