// All sound is synthesized: a glass-and-felt palette, tuned to D major pentatonic so plucking
// the web plays it. Spatialized with HRTF panners; the listener follows your head.

const PENTA = [0, 2, 4, 7, 9];
export const note = (step: number, base = 146.83) => {
  const o = Math.floor(step / 5), k = ((step % 5) + 5) % 5;
  return base * Math.pow(2, o + PENTA[k] / 12);
};

export type Voice = { pos(x: number, y: number, z: number): void; level(g: number): void; pitch(f: number): void; stop(): void };

export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private verb!: ConvolverNode;
  private verbIn!: GainNode;
  private noise!: AudioBuffer;
  private drone: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private hiss: GainNode | null = null;
  private swell: { g: GainNode; o: OscillatorNode[] } | null = null;

  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const ctx = (this.ctx = new AudioContext());
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp);
    // a soft room: generated impulse response
    this.verb = ctx.createConvolver();
    const len = ctx.sampleRate * 3.2;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    this.verb.buffer = ir;
    this.verbIn = ctx.createGain();
    this.verbIn.gain.value = 0.55;
    this.verbIn.connect(this.verb);
    this.verb.connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const n = this.noise.getChannelData(0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
  }

  get now() {
    return this.ctx?.currentTime ?? 0;
  }

  listener(px: number, py: number, pz: number, fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) {
    const l = this.ctx?.listener;
    if (!l) return;
    if (l.positionX) {
      const t = this.now;
      l.positionX.setTargetAtTime(px, t, 0.02);
      l.positionY.setTargetAtTime(py, t, 0.02);
      l.positionZ.setTargetAtTime(pz, t, 0.02);
      l.forwardX.setTargetAtTime(fx, t, 0.02);
      l.forwardY.setTargetAtTime(fy, t, 0.02);
      l.forwardZ.setTargetAtTime(fz, t, 0.02);
      l.upX.setTargetAtTime(ux, t, 0.02);
      l.upY.setTargetAtTime(uy, t, 0.02);
      l.upZ.setTargetAtTime(uz, t, 0.02);
    }
  }

  private panner(x: number, y: number, z: number) {
    const p = this.ctx!.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 0.4;
    p.rolloffFactor = 1.2;
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
    p.connect(this.master);
    return p;
  }

  private out(pos?: [number, number, number], verb = 0.5) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    if (pos) g.connect(this.panner(...pos));
    else g.connect(this.master);
    const s = ctx.createGain();
    s.gain.value = verb;
    g.connect(s);
    s.connect(this.verbIn);
    return g;
  }

  /** A glass pluck: the web's voice. */
  pluck(f: number, gain = 0.2, pos?: [number, number, number], decay = 1.4) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this.now;
    const g = this.out(pos, 0.6);
    for (const [m, a, d] of [[1, 1, 1], [2.756, 0.32, 0.45], [5.4, 0.12, 0.2]]) {
      if (f * m > 16000) continue;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * m;
      const e = ctx.createGain();
      e.gain.setValueAtTime(0, t);
      e.gain.linearRampToValueAtTime(gain * a, t + 0.004);
      e.gain.exponentialRampToValueAtTime(0.0001, t + decay * d);
      o.connect(e);
      e.connect(g);
      o.start(t);
      o.stop(t + decay * d + 0.05);
    }
  }

  /** A soft chime with a long tail (the ceiling glint, small rewards). */
  chime(f: number, gain = 0.12, pos?: [number, number, number]) {
    this.pluck(f, gain, pos, 4.5);
  }

  /** The thread snapping. */
  snap(pos?: [number, number, number]) {
    if (!this.ctx) return;
    this.pluck(note(14) * 1.03, 0.07, pos, 0.5);
    this.noiseBurst(0.05, 5000, 0.08, pos);
  }

  noiseBurst(dur: number, freq: number, gain: number, pos?: [number, number, number]) {
    const ctx = this.ctx!, t = this.now;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 1.4;
    const e = ctx.createGain();
    e.gain.setValueAtTime(gain, t);
    e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bp);
    bp.connect(e);
    e.connect(this.out(pos, 0.3));
    s.start(t, Math.random());
    s.stop(t + dur + 0.02);
  }

  /** A warm chord: eating. */
  chord(steps: number[], gain = 0.07, dur = 3.5, at = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this.now + at;
    const g = this.out(undefined, 0.8);
    for (const s of steps) {
      for (const det of [-3, 3]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = note(s, 73.42);
        o.detune.value = det;
        const e = ctx.createGain();
        e.gain.setValueAtTime(0, t);
        e.gain.linearRampToValueAtTime(gain / steps.length, t + 0.25);
        e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1400;
        o.connect(lp);
        lp.connect(e);
        e.connect(g);
        o.start(t);
        o.stop(t + dur + 0.1);
      }
    }
  }

  /** The room tone under everything. */
  startDrone() {
    if (!this.ctx || this.drone) return;
    const ctx = this.ctx;
    const g = (this.drone = ctx.createGain());
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.05, this.now, 4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    lp.connect(g);
    g.connect(this.master);
    for (const [f, d] of [[73.42, -4], [110, 3], [146.83, 6]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.detune.value = d;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.07;
      const lg = ctx.createGain();
      lg.gain.value = 0.35;
      const vg = ctx.createGain();
      vg.gain.value = 0.6;
      lfo.connect(lg);
      lg.connect(vg.gain);
      o.connect(vg);
      vg.connect(lp);
      o.start();
      lfo.start();
    }
  }

  /** The opening: an open fifth that slowly builds while the spider comes down, then resolves. */
  startSwell(dur: number) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this.now;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.11, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(200, t);
    lp.frequency.exponentialRampToValueAtTime(2400, t + dur);
    lp.connect(g);
    const s = ctx.createGain();
    s.gain.value = 0.7;
    g.connect(this.master);
    g.connect(s);
    s.connect(this.verbIn);
    const os: OscillatorNode[] = [];
    for (const [f, type] of [[36.71, 'sine'], [55, 'sawtooth'], [73.42, 'sawtooth'], [110, 'triangle']] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = type === 'sawtooth' ? 0.25 : 0.6;
      o.connect(og);
      og.connect(lp);
      o.start(t);
      os.push(o);
    }
    this.swell = { g, o: os };
  }

  resolveSwell() {
    if (!this.ctx || !this.swell) return;
    const t = this.now;
    this.swell.g.gain.cancelScheduledValues(t);
    this.swell.g.gain.setValueAtTime(this.swell.g.gain.value, t);
    this.swell.g.gain.linearRampToValueAtTime(0.13, t + 0.15);
    this.swell.g.gain.exponentialRampToValueAtTime(0.0001, t + 7);
    for (const o of this.swell.o) o.stop(t + 7.2);
    this.swell = null;
    this.chord([5, 7, 9, 10, 12], 0.09, 7);
  }

  /** A fly. Wingbeat-modulated buzz, filtered, doppler handled by the caller via pitch(). */
  buzz(): Voice | null {
    if (!this.ctx) return null;
    const ctx = this.ctx;
    const p = this.panner(0, 0, 0);
    const g = ctx.createGain();
    g.gain.value = 0;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 650;
    bp.Q.value = 0.9;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const base = 175 + Math.random() * 40;
    o.frequency.value = base;
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = base * 2.01;
    const g2 = ctx.createGain();
    g2.gain.value = 0.15;
    const am = ctx.createOscillator();
    am.frequency.value = 23;
    const amg = ctx.createGain();
    amg.gain.value = 0.3;
    const vca = ctx.createGain();
    vca.gain.value = 0.7;
    am.connect(amg);
    amg.connect(vca.gain);
    o.connect(vca);
    o2.connect(g2);
    g2.connect(vca);
    vca.connect(bp);
    bp.connect(g);
    g.connect(p);
    o.start();
    o2.start();
    am.start();
    return {
      pos: (x, y, z) => {
        const t = this.now;
        p.positionX.setTargetAtTime(x, t, 0.03);
        p.positionY.setTargetAtTime(y, t, 0.03);
        p.positionZ.setTargetAtTime(z, t, 0.03);
      },
      level: (v) => g.gain.setTargetAtTime(v, this.now, 0.05),
      pitch: (f) => {
        o.frequency.setTargetAtTime(base * f, this.now, 0.05);
        o2.frequency.setTargetAtTime(base * 2.01 * f, this.now, 0.05);
      },
      stop: () => {
        g.gain.setTargetAtTime(0, this.now, 0.08);
        setTimeout(() => {
          o.stop();
          o2.stop();
          am.stop();
          p.disconnect();
        }, 600);
      },
    };
  }

  /** Rain: filtered noise, and the caller adds ticks where drops hit silk. */
  rain(level: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (!this.rainGain) {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 900;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 6500;
      this.rainGain = ctx.createGain();
      this.rainGain.gain.value = 0;
      s.connect(hp);
      hp.connect(lp);
      lp.connect(this.rainGain);
      this.rainGain.connect(this.master);
      const sv = ctx.createGain();
      sv.gain.value = 0.4;
      this.rainGain.connect(sv);
      sv.connect(this.verbIn);
      s.start();
    }
    this.rainGain.gain.setTargetAtTime(level * 0.07, this.now, 0.6);
  }

  tick(pos: [number, number, number], gain = 0.03) {
    if (!this.ctx) return;
    this.pluck(2600 + Math.random() * 2400, gain, pos, 0.12);
  }

  /** Silk paying out: a faint hiss that follows how fast you spin. */
  spinHiss(level: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (!this.hiss) {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7000;
      this.hiss = ctx.createGain();
      this.hiss.gain.value = 0;
      s.connect(hp);
      hp.connect(this.hiss);
      this.hiss.connect(this.master);
      s.start();
    }
    this.hiss.gain.setTargetAtTime(Math.min(1, level) * 0.035, this.now, 0.05);
  }

  suspend() {
    this.ctx?.suspend();
  }
}
