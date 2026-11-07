// The web: a Verlet (position-based) particle system of silk threads.
// Every thread is a chain of particles joined by rope constraints (they pull, never push).
// Threads lose health when the spider stops visiting them: they lengthen, sag, and snap.

import { CFG } from './config.js';

export const MOOR = 0; // frame lines tied to the room
export const RADIAL = 1; // dry threads the player spins
export const CAPTURE = 2; // sticky spiral laid in automatically
export const DRAG = 3; // the dragline (rendered, not simulated)

export type Hit = { c: number; t: number; d: number };

export class Web {
  readonly MP = 2600;
  readonly MC = 4200;
  p = new Float32Array(this.MP * 3);
  o = new Float32Array(this.MP * 3);
  im = new Float32Array(this.MP); // inverse mass, 0 = pinned
  wet = new Float32Array(this.MP);
  deg = new Int16Array(this.MP);
  pAlive = new Uint8Array(this.MP);
  anchored = new Uint8Array(this.MP);
  root = new Int32Array(this.MP);

  ca = new Int32Array(this.MC);
  cb = new Int32Array(this.MC);
  rest = new Float32Array(this.MC);
  base = new Float32Array(this.MC);
  hp = new Float32Array(this.MC);
  kind = new Uint8Array(this.MC);
  thick = new Float32Array(this.MC);
  born = new Float32Array(this.MC);
  glint = new Float32Array(this.MC);
  cwet = new Float32Array(this.MC);
  seed = new Float32Array(this.MC);
  cAlive = new Uint8Array(this.MC);

  nP = 0;
  nC = 0;
  private freeP: number[] = [];
  private freeC: number[] = [];
  time = 0;
  decayOn = false;
  decayScale = 1; // gentle while the web is young
  wind = 0.6;
  floorY = -1.1; // web-local height of the real floor, set from the room
  onBreak?: (c: number, x: number, y: number, z: number) => void;
  private connT = 0;

  clear() {
    this.pAlive.fill(0);
    this.cAlive.fill(0);
    this.deg.fill(0);
    this.nP = this.nC = 0;
    this.freeP.length = this.freeC.length = 0;
  }

  /** Room left for more silk (the solver's fixed capacity, with a margin). */
  roomFor(particles: number) {
    return this.freeP.length + (this.MP - this.nP) > particles + 40 && this.freeC.length + (this.MC - this.nC) > particles * 3 + 80;
  }

  addP(x: number, y: number, z: number, im = 1): number {
    const i = this.freeP.length ? this.freeP.pop()! : this.nP < this.MP ? this.nP++ : -1;
    if (i < 0) return -1;
    const k = i * 3;
    this.p[k] = this.o[k] = x;
    this.p[k + 1] = this.o[k + 1] = y;
    this.p[k + 2] = this.o[k + 2] = z;
    this.im[i] = im;
    this.wet[i] = 0;
    this.deg[i] = 0;
    this.pAlive[i] = 1;
    this.anchored[i] = im === 0 ? 1 : 0;
    return i;
  }

  addC(a: number, b: number, kind: number, thick: number, tension = 1, bornDelay = 0): number {
    if (a < 0 || b < 0 || a === b) return -1;
    const c = this.freeC.length ? this.freeC.pop()! : this.nC < this.MC ? this.nC++ : -1;
    if (c < 0) return -1;
    const len = this.dist(a, b);
    this.ca[c] = a;
    this.cb[c] = b;
    this.base[c] = this.rest[c] = len * tension;
    this.hp[c] = 1;
    this.kind[c] = kind;
    this.thick[c] = thick;
    this.born[c] = this.time + bornDelay;
    this.glint[c] = 1;
    this.cwet[c] = 0;
    this.seed[c] = Math.random();
    this.cAlive[c] = 1;
    this.deg[a]++;
    this.deg[b]++;
    return c;
  }

  killC(c: number) {
    if (!this.cAlive[c]) return;
    this.cAlive[c] = 0;
    this.freeC.push(c);
    for (const i of [this.ca[c], this.cb[c]]) {
      if (--this.deg[i] <= 0 && this.im[i] !== 0) this.killP(i);
    }
  }

  killP(i: number) {
    if (!this.pAlive[i]) return;
    this.pAlive[i] = 0;
    this.freeP.push(i);
  }

  dist(a: number, b: number) {
    const p = this.p, i = a * 3, j = b * 3;
    return Math.hypot(p[i] - p[j], p[i + 1] - p[j + 1], p[i + 2] - p[j + 2]);
  }

  set(i: number, x: number, y: number, z: number, keepVel = false) {
    const k = i * 3;
    if (keepVel) {
      this.o[k] += x - this.p[k];
      this.o[k + 1] += y - this.p[k + 1];
      this.o[k + 2] += z - this.p[k + 2];
    } else {
      this.o[k] = x;
      this.o[k + 1] = y;
      this.o[k + 2] = z;
    }
    this.p[k] = x;
    this.p[k + 1] = y;
    this.p[k + 2] = z;
  }

  /** Lay a straight chain of particles from particle a toward (x,y,z) and tie it to particle b if given. */
  chain(a: number, b: number, kind: number, thick: number, spacing: number, tension = CFG.tension, delay = 0, step = 0): number[] {
    const p = this.p;
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const bx = p[b * 3], by = p[b * 3 + 1], bz = p[b * 3 + 2];
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const n = Math.max(1, Math.round(len / spacing));
    const ids = [a];
    let prev = a;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const id = k === n ? b : this.addP(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, 1);
      if (id < 0) break;
      this.addC(prev, id, kind, thick, tension, delay + step * k);
      ids.push(id);
      prev = id;
    }
    return ids;
  }

  step(dt: number) {
    this.time += dt;
    const { p, o, im, wet } = this;
    const damp = Math.exp(-dt * CFG.airDrag);
    const g = -9.81 * CFG.silkGravity * dt * dt;
    const t = this.time, w = this.wind * dt * dt;
    const floor = this.floorY + 0.003;

    for (let i = 0; i < this.nP; i++) {
      if (!this.pAlive[i] || im[i] === 0) continue;
      const k = i * 3;
      const x = p[k], y = p[k + 1], z = p[k + 2];
      const vx = (x - o[k]) * damp, vy = (y - o[k + 1]) * damp, vz = (z - o[k + 2]) * damp;
      o[k] = x;
      o[k + 1] = y;
      o[k + 2] = z;
      // a slow breath of air: mostly through the web (z), a little sideways
      const gust = Math.sin(t * 0.37 + x * 2.1) * Math.sin(t * 0.91 + y * 1.7);
      p[k] = x + vx + w * 0.35 * Math.sin(t * 0.53 + y * 3.0);
      p[k + 1] = y + vy + g * (1 + wet[i] * CFG.wetMass);
      p[k + 2] = z + vz + w * gust;
      if (p[k + 1] < floor) {
        p[k + 1] = floor;
        o[k] = p[k];
        o[k + 2] = p[k + 2];
      }
    }

    const { ca, cb, rest, cAlive, born } = this;
    // big webs need fewer passes to look right, and the headset's CPU is shared with everything else
    const iters = this.nC > 1800 ? 6 : this.nC > 900 ? 8 : CFG.iterations;
    for (let it = 0; it < iters; it++) {
      for (let c = 0; c < this.nC; c++) {
        if (!cAlive[c] || born[c] > t) continue;
        const a = ca[c], b = cb[c];
        const wa = im[a], wb = im[b], ws = wa + wb;
        if (ws === 0) continue;
        const i = a * 3, j = b * 3;
        const dx = p[j] - p[i], dy = p[j + 1] - p[i + 1], dz = p[j + 2] - p[i + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const r = rest[c];
        if (d <= r || d < 1e-7) continue; // rope: slack is allowed
        const s = (d - r) / (d * ws);
        p[i] += dx * s * wa;
        p[i + 1] += dy * s * wa;
        p[i + 2] += dz * s * wa;
        p[j] -= dx * s * wb;
        p[j + 1] -= dy * s * wb;
        p[j + 2] -= dz * s * wb;
      }
    }

    // connectivity: pieces no longer tied to anything dissolve as they fall
    this.connT -= dt;
    if (this.connT <= 0) {
      this.connT = 0.35;
      this.connectivity();
    }

    // health, sag, wetness
    wet.fill(0, 0, this.nP);
    for (let c = 0; c < this.nC; c++) {
      if (!cAlive[c]) continue;
      const a = ca[c], b = cb[c];
      const free = !this.anchored[a];
      const k = this.kind[c];
      // the frame lines to the room are out of the spider's reach, so they hold; the web inside them does not
      let rate = k === MOOR ? 0 : k === CAPTURE ? CFG.decayCapture : CFG.decay;
      if (!this.decayOn) rate = 0;
      rate *= this.decayScale;
      rate *= 1 + this.cwet[c] * 1.2;
      if (free) rate = 0.55;
      this.hp[c] -= dt * rate;
      const h = Math.max(0, this.hp[c]);
      rest[c] = this.base[c] * (1 + CFG.sag * (1 - h) * (1 - h));
      this.glint[c] = Math.max(0, this.glint[c] - dt * 1.4);
      const cw = this.cwet[c];
      if (cw > wet[a]) wet[a] = cw;
      if (cw > wet[b]) wet[b] = cw;
      if (this.hp[c] <= 0) {
        const i = a * 3;
        this.onBreak?.(c, p[i], p[i + 1], p[i + 2]);
        this.killC(c);
      }
    }
  }

  private find(i: number): number {
    const r = this.root;
    while (r[i] !== i) {
      r[i] = r[r[i]];
      i = r[i];
    }
    return i;
  }

  connectivity() {
    const r = this.root;
    for (let i = 0; i < this.nP; i++) r[i] = i;
    for (let c = 0; c < this.nC; c++) {
      if (!this.cAlive[c]) continue;
      const a = this.find(this.ca[c]), b = this.find(this.cb[c]);
      if (a !== b) r[a] = b;
    }
    const pinnedRoot = new Uint8Array(this.nP);
    for (let i = 0; i < this.nP; i++) if (this.pAlive[i] && this.im[i] === 0) pinnedRoot[this.find(i)] = 1;
    for (let i = 0; i < this.nP; i++) this.anchored[i] = this.pAlive[i] && pinnedRoot[this.find(i)] ? 1 : 0;
  }

  /** Nearest live particle to a point, optionally skipping a set. */
  nearestP(x: number, y: number, z: number, maxD: number, skip?: Set<number>): number {
    let best = -1, bd = maxD * maxD;
    const p = this.p;
    for (let i = 0; i < this.nP; i++) {
      if (!this.pAlive[i] || !this.anchored[i] || this.deg[i] === 0 && this.im[i] !== 0) continue;
      if (skip?.has(i)) continue;
      const k = i * 3;
      const dx = p[k] - x, dy = p[k + 1] - y, dz = p[k + 2] - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /** Closest constraint to a point within r (plus each thread's own radius). */
  nearestC(x: number, y: number, z: number, r: number, kindMask = 0b111): Hit | null {
    const p = this.p;
    let best: Hit | null = null;
    let bd = Infinity;
    for (let c = 0; c < this.nC; c++) {
      if (!this.cAlive[c] || this.born[c] > this.time || !((1 << this.kind[c]) & kindMask)) continue;
      const i = this.ca[c] * 3, j = this.cb[c] * 3;
      const ax = p[i], ay = p[i + 1], az = p[i + 2];
      const ex = p[j] - ax, ey = p[j + 1] - ay, ez = p[j + 2] - az;
      const ll = ex * ex + ey * ey + ez * ez || 1e-9;
      let t = ((x - ax) * ex + (y - ay) * ey + (z - az) * ez) / ll;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = ax + ex * t - x, dy = ay + ey * t - y, dz = az + ez * t - z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - this.thick[c];
      if (d < r && d < bd) {
        bd = d;
        best = { c, t, d };
      }
    }
    return best;
  }

  /** The spider brushing past threads keeps them alive. */
  repair(x: number, y: number, z: number, r: number, amount: number): number {
    const p = this.p;
    let n = 0;
    for (let c = 0; c < this.nC; c++) {
      if (!this.cAlive[c]) continue;
      const i = this.ca[c] * 3, j = this.cb[c] * 3;
      const mx = (p[i] + p[j]) / 2 - x, my = (p[i + 1] + p[j + 1]) / 2 - y, mz = (p[i + 2] + p[j + 2]) / 2 - z;
      if (mx * mx + my * my + mz * mz > r * r) continue;
      if (this.hp[c] < 0.97) {
        this.glint[c] = Math.max(this.glint[c], 0.8 * (1 - this.hp[c]) + 0.2);
        n++;
      }
      this.hp[c] = Math.min(1, this.hp[c] + amount);
    }
    return n;
  }

  /** Push on the particles of a constraint (a fly struggling, a pluck). */
  impulse(c: number, t: number, x: number, y: number, z: number) {
    const a = this.ca[c], b = this.cb[c];
    for (const [i, w] of [[a, 1 - t], [b, t]] as const) {
      if (this.im[i] === 0) continue;
      const k = i * 3;
      this.p[k] += x * w;
      this.p[k + 1] += y * w;
      this.p[k + 2] += z * w;
    }
  }

  pointOn(c: number, t: number, out: { x: number; y: number; z: number }) {
    const i = this.ca[c] * 3, j = this.cb[c] * 3, p = this.p;
    out.x = p[i] + (p[j] - p[i]) * t;
    out.y = p[i + 1] + (p[j + 1] - p[i + 1]) * t;
    out.z = p[i + 2] + (p[j + 2] - p[i + 2]) * t;
    return out;
  }

  totalLength(kind: number) {
    let s = 0;
    for (let c = 0; c < this.nC; c++) if (this.cAlive[c] && this.kind[c] === kind) s += this.base[c];
    return s;
  }

  // ---- persistence ----
  serialize() {
    const map = new Map<number, number>();
    const P: number[] = [];
    for (let i = 0; i < this.nP; i++) {
      if (!this.pAlive[i] || !this.anchored[i]) continue;
      map.set(i, P.length / 4);
      P.push(+this.p[i * 3].toFixed(4), +this.p[i * 3 + 1].toFixed(4), +this.p[i * 3 + 2].toFixed(4), this.im[i] === 0 ? 0 : 1);
    }
    const C: number[] = [];
    for (let c = 0; c < this.nC; c++) {
      if (!this.cAlive[c] || this.born[c] > this.time) continue;
      const a = map.get(this.ca[c]), b = map.get(this.cb[c]);
      if (a === undefined || b === undefined) continue;
      C.push(a, b, this.kind[c], +this.thick[c].toFixed(6), +this.base[c].toFixed(4), +this.hp[c].toFixed(3));
    }
    return { P, C };
  }

  restore(d: { P: number[]; C: number[] }, healthScale = 1) {
    this.clear();
    const ids: number[] = [];
    for (let k = 0; k < d.P.length; k += 4) ids.push(this.addP(d.P[k], d.P[k + 1], d.P[k + 2], d.P[k + 3]));
    for (let k = 0; k < d.C.length; k += 6) {
      const c = this.addC(ids[d.C[k]], ids[d.C[k + 1]], d.C[k + 2], d.C[k + 3]);
      if (c < 0) continue;
      this.base[c] = d.C[k + 4];
      this.hp[c] = this.kind[c] === MOOR ? d.C[k + 5] : Math.max(0.12, d.C[k + 5] * healthScale);
      this.glint[c] = 0;
    }
    this.connectivity();
  }
}
