// A frame-rate readout for testing on the headset, shown only with ?fps. It hangs just below your
// line of sight and follows your head: frames per second, the worst frame of the last second, the share
// of frames slower than 60 fps since entering, the quality guard's level, and how much silk and dew is drawn.

import { CanvasTexture, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry } from '@iwsdk/core';

export class FpsMeter {
  readonly mesh: Mesh;
  private ctx: CanvasRenderingContext2D;
  private tex: CanvasTexture;
  private frames = 0;
  private acc = 0;
  private worst = 0;
  private total = 0;
  private slow = 0;
  private minFps = Infinity;
  private last = performance.now();

  constructor() {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 160;
    this.ctx = c.getContext('2d')!;
    this.tex = new CanvasTexture(c);
    const mat = new MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false });
    this.mesh = new Mesh(new PlaneGeometry(0.22, 0.034375), mat);
    this.mesh.position.set(0, -0.1, -0.42);
    this.mesh.renderOrder = 999;
    this.mesh.frustumCulled = false;
  }

  attach(parent: Object3D) {
    if (this.mesh.parent !== parent) parent.add(this.mesh);
  }

  /** Call once per frame. `extra` is appended to the readout. */
  tick(quality: number, extra: string) {
    const now = performance.now();
    const ms = now - this.last;
    this.last = now;
    if (ms <= 0 || ms > 500) return;
    this.frames++;
    this.acc += ms;
    this.worst = Math.max(this.worst, ms);
    this.total++;
    if (ms > 1000 / 58) this.slow++; // a frame that missed 60 fps (with a little tolerance)
    if (this.acc < 500) return;
    const fps = (this.frames * 1000) / this.acc;
    if (this.total > 120) this.minFps = Math.min(this.minFps, fps);
    const g = this.ctx;
    g.clearRect(0, 0, 1024, 160);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(0, 0, 1024, 160);
    g.font = '600 64px ui-monospace, Menlo, monospace';
    g.fillStyle = fps >= 70 ? '#9be89b' : fps >= 60 ? '#f2d16b' : '#ff7b6b';
    g.fillText(`${fps.toFixed(0)} fps`, 24, 70);
    g.font = '32px ui-monospace, Menlo, monospace';
    g.fillStyle = '#e8e2d6';
    g.fillText(`worst ${this.worst.toFixed(0)}ms  <60 ${((this.slow / this.total) * 100).toFixed(0)}%  min ${isFinite(this.minFps) ? this.minFps.toFixed(0) : '-'}  q${quality}`, 270, 62);
    g.fillText(extra, 24, 128);
    this.tex.needsUpdate = true;
    (window as unknown as { __fps: object }).__fps = { fps, worstMs: this.worst, slowShare: this.slow / this.total, minFps: this.minFps, quality };
    this.frames = 0;
    this.acc = 0;
    this.worst = 0;
  }
}
