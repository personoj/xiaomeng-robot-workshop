/** Independent meters. Inactive / expired telemetry never impersonates live speech. */
export class AudioActivity {
  constructor(onChange = () => {}) {
    this.onChange = onChange;
    this.reset();
  }
  reset() {
    this.input = { level: 0, until: 0 };
    this.output = { level: 0, until: 0 };
    this.text = "";
    this.textUntil = 0;
    this.onChange();
  }
  update(event, now = performance.now()) {
    if (
      !["input", "output"].includes(event?.channel) ||
      typeof event.active !== "boolean" ||
      !Number.isFinite(event.level) ||
      event.level < 0 ||
      event.level > 1
    )
      return false;
    this[event.channel] = {
      level: event.active ? event.level : 0,
      until: event.active ? now + 700 : 0,
    };
    if (event.channel === "input" && typeof event.text === "string")
      this.transcript(event.text, now);
    this.onChange();
    return true;
  }
  transcript(text, now = performance.now()) {
    this.text = String(text).trim().slice(0, 180);
    this.textUntil = now + 6500;
    this.onChange();
  }
  sample(now = performance.now()) {
    return {
      input: now < this.input.until ? this.input.level : 0,
      output: now < this.output.until ? this.output.level : 0,
      text: now < this.textUntil ? this.text : "",
    };
  }
}

export class VoiceVisuals {
  constructor(canvas, bars, caption) {
    this.frame = null;
    this.expiryTimer = null;
    this.disposed = false;
    this.activity = new AudioActivity(() => this.requestFrame());
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.bars = [...bars.children];
    this.caption = caption;
    this.output = 0;
    this.input = 0;
    this.phase = 0;
    this.last = 0;
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)");
    this.resize = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect(),
        dpr = Math.min(devicePixelRatio, 2);
      canvas.width = r.width * dpr;
      canvas.height = r.height * dpr;
      this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.width = r.width;
      this.height = r.height;
      this.waveDirty=true;
      this.requestFrame();
    });
    this.resize.observe(canvas);
    this.requestFrame();
  }
  requestFrame() {
    if (this.disposed) return;
    clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    if (this.frame === null) this.frame = requestAnimationFrame((t) => this.draw(t));
  }
  draw(now) {
    this.frame = null;
    if (this.disposed) return;
    const state = this.activity.sample(now),
      dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    this.output += (state.output - this.output) * Math.min(1, dt * 13);
    this.input += (state.input - this.input) * Math.min(1, dt * 18);
    if(this.output<.0001)this.output=0;if(this.input<.0001)this.input=0;
    if (!this.reduced.matches) this.phase += dt * this.output * 2.2;
    const ctx = this.context,
      w = this.width || 1,
      h = this.height || 1;
    if(this.waveDirty||this.output>0||this.previousOutput!==this.output){
    ctx.clearRect(0, 0, w, h);
    const amp = h * (0.25 + this.output * 0.14),
      center = h * 0.54;
    // Three translucent bundles of fine ribbons reproduce the approved wave drawing.
    for (let group = 0; group < 3; group++) {
      for (let line = 0; line < 17; line++) {
        ctx.beginPath();
        for (let x = -2; x <= w + 2; x += 3) {
          const u = x / w,
            spread = (line - 8) * h * 0.006,
            envelope = Math.sin(Math.PI*Math.max(0,Math.min(1,u)))**1.2,
            carrier = group===1
              ? -Math.cos((u-.51)*Math.PI*4+this.phase)*Math.exp(-(((u-.51)/.27)**2))
              : Math.sin(u*Math.PI*4.5+group*.55+this.phase)*.47;
          const y = center + carrier*(amp + line*h*.003)*envelope + spread*Math.sin(u*Math.PI*2)*envelope;
          x === -2 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${group===1?'239,126,35':'22,57,117'},${0.29 + (line === 8 ? 0.34 : 0) + this.output * 0.1})`;
        ctx.lineWidth = 0.65;
        ctx.stroke();
      }
    }
    this.waveDirty=false;this.previousOutput=this.output;
    }
    const idle = [9, 20, 11, 25, 38, 56, 31, 20, 13, 25, 12];
    if(this.input>0||this.previousInput!==this.input){
    this.bars.forEach((bar, i) => {
      const motion = this.reduced.matches
        ? 0.65
        : 0.5 + 0.5 * Math.sin(now / 83 + i * 1.9);
      bar.style.height = `${idle[i] * 0.68 + this.input * 28 * motion}px`;
    });
    this.previousInput=this.input;
    }
    this.canvas.dataset.active = String(state.output > 0.015);
    this.caption.parentElement.dataset.active = String(state.input > 0.025);
    const text =
      state.text || (state.input > 0.025 ? "正在听你说…" : "");
    if (this.caption.textContent !== text) this.caption.textContent = text;
    // Telemetry wakes the meter. Keep every animation frame while levels are
    // active/decaying, then sleep; a transcript needs only its actual expiry.
    if (this.output > 0 || this.input > 0 || state.output > 0 || state.input > 0) this.requestFrame();
    else if (state.text) this.expiryTimer = setTimeout(() => this.requestFrame(), Math.max(0, this.activity.textUntil - now));
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.expiryTimer);
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
  }
}
