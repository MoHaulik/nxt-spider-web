// The One Euro filter (Casiez, Roussel & Vogel, CHI 2012): adaptive smoothing for noisy pointing.
// Slow movement is smoothed hard (no jitter); fast movement is barely filtered (no lag).

import { Vector3 } from '@iwsdk/core';

const alpha = (cutoff: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuro3 {
  private x = new Vector3();
  private dx = new Vector3();
  private has = false;
  private tmp = new Vector3();
  constructor(private minCutoff = 1.0, private beta = 2.0, private dCutoff = 1.0) {}

  reset() {
    this.has = false;
  }

  filter(v: Vector3, dt: number, out: Vector3) {
    if (!this.has || dt <= 0) {
      this.x.copy(v);
      this.dx.set(0, 0, 0);
      this.has = true;
      return out.copy(v);
    }
    const d = this.tmp.copy(v).sub(this.x).divideScalar(dt);
    this.dx.lerp(d, alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * this.dx.length();
    this.x.lerp(v, alpha(cutoff, dt));
    return out.copy(this.x);
  }
}
