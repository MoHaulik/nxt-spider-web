// The brood: the reason to come back. Every few meals the spider spins an egg sac into the web.
// It hatches into a ball of spiderlings that balloon out on silk to real surfaces in your room,
// and each little family builds its own small web there. Over days, your room fills with them.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Texture,
  Vector3,
} from '@iwsdk/core';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Site } from './room.js';
import type { DropMesh, SilkMesh } from './render.js';
import { CAPTURE, RADIAL } from './web.js';

export type ColonySave = { p: number[]; n: number[]; pop: number; seed: number };
export type SacSave = { p: number[]; age: number };

type Colony = { pos: Vector3; normal: Vector3; pop: number; seed: number; segs: Float32Array; kinds: Uint8Array; r: number; built: number; spots: Vector3[] };
type Baby = { p: Vector3; from: Vector3; to: Vector3; t: number; dur: number; state: 'ball' | 'fly' | 'home'; colony: Colony | null; jitter: number; ball: Vector3 };
type Sac = { pos: Vector3; age: number; mesh: Mesh; hatched: boolean; particle: number; grow: number; quiver: number };

const rnd = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
};

/** A spiderling: pale yellow with a dark mark, as real garden-spider young are. One merged mesh. */
function babyGeometry() {
  const parts: BufferGeometry[] = [];
  const col = (g: BufferGeometry, c: Color) => {
    const n = g.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new BufferAttribute(a, 3));
    return g;
  };
  const ab = new SphereGeometry(1, 12, 8).scale(0.34, 0.4, 0.3).translate(0, -0.32, 0.04);
  {
    const pos = ab.attributes.position as BufferAttribute;
    const a = new Float32Array(pos.count * 3);
    const yel = new Color(0.95, 0.78, 0.3), blk = new Color(0.08, 0.05, 0.03);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) + 0.32, z = pos.getZ(i);
      const c = yel.clone().lerp(blk, z > 0.08 && y < 0.05 && y > -0.3 ? 0.85 : 0);
      a.set([c.r, c.g, c.b], i * 3);
    }
    ab.setAttribute('color', new BufferAttribute(a, 3));
  }
  parts.push(ab);
  parts.push(col(new SphereGeometry(1, 10, 6).scale(0.2, 0.24, 0.13).translate(0, 0.16, 0.02), new Color(0.5, 0.35, 0.12)));
  const legC = new Color(0.55, 0.42, 0.2);
  const yaws = [0.45, 0.95, 1.85, 2.5];
  for (const side of [-1, 1]) {
    yaws.forEach((yaw, k) => {
      const L = k === 2 ? 0.75 : 1.05;
      const g = new CylinderGeometry(0.015, 0.03, L, 4).translate(0, L / 2, 0);
      const o = new Object3D();
      o.position.set(side * 0.1, 0.2 - k * 0.05, 0.02);
      o.rotation.order = 'ZXY';
      o.rotation.set(0.35, 0, -side * yaw);
      o.updateMatrix();
      g.applyMatrix4(o.matrix);
      parts.push(col(g, legC));
    });
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()));
}

export class Brood {
  readonly group = new Group();
  colonies: Colony[] = [];
  private sacs: Sac[] = [];
  private babies: Baby[] = [];
  private inst: InstancedMesh;
  private sacMat: MeshPhysicalMaterial;
  private sacGeo = new SphereGeometry(1, 20, 14);
  private o = new Object3D();
  private q = new Quaternion();
  sites: Site[] = [];
  onHatch?: (pos: Vector3) => void;
  onArrive?: (pos: Vector3) => void;

  constructor(env: Texture | null) {
    const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.45, envMap: env });
    this.inst = new InstancedMesh(babyGeometry(), mat, 600);
    this.inst.count = 0;
    this.inst.frustumCulled = false;
    this.group.add(this.inst);
    this.sacMat = new MeshPhysicalMaterial({ color: new Color(0.95, 0.86, 0.66), roughness: 0.75, sheen: 1, sheenColor: new Color(1, 0.92, 0.75), sheenRoughness: 0.5, envMap: env });
  }

  // ---------------- egg sacs ----------------

  /** `grow` < 1: the sac is still being spun, and swells to full size over the next seconds. */
  lay(pos: Vector3, particle: number, age = 0, grow = 1) {
    const mesh = new Mesh(this.sacGeo, this.sacMat);
    mesh.scale.set(0.0085, 0.011, 0.0085).multiplyScalar(Math.max(0.05, grow));
    mesh.position.copy(pos);
    this.group.add(mesh);
    const sac = { pos: pos.clone(), age, mesh, hatched: false, particle, grow, quiver: 0 };
    this.sacs.push(sac);
    return sac;
  }

  /** Hatch: a tight ball of spiderlings, which after a breath disperse on the air to the room. */
  hatch(sac: Sac, count = 16) {
    if (sac.hatched) return;
    sac.hatched = true;
    this.newFamilies = 0;
    this.group.remove(sac.mesh);
    for (let k = 0; k < count; k++) {
      const ball = new Vector3((Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.02);
      this.babies.push({ p: sac.pos.clone().add(ball), from: sac.pos.clone(), to: new Vector3(), t: -2.5 - Math.random() * 6, dur: 0, state: 'ball', colony: null, jitter: Math.random() * 10, ball });
    }
    this.onHatch?.(sac.pos);
  }

  private newFamilies = 0;

  private pickColony(): Colony {
    // each hatching founds at most two new families on free real surfaces; the rest join a family
    const cap = this.colonies.length ? 2 : 3;
    if (this.newFamilies >= cap && this.colonies.length) {
      const young = this.colonies.filter((c) => c.pop < 12);
      const pool = young.length ? young : this.colonies;
      return pool[Math.floor(Math.random() * pool.length)];
    }
    const free = this.sites.find((s) => this.colonies.every((c) => c.pos.distanceTo(s.pos) > 0.45));
    if (free) this.newFamilies++;
    if (!free) return this.colonies.length ? this.colonies[Math.floor(Math.random() * this.colonies.length)] : this.found(this.sites[0]);
    return this.found(free);
  }

  found(site: Site, pop = 0, seed = Math.floor(Math.random() * 1e9)): Colony {
    const c: Colony = { pos: site.pos.clone(), normal: site.normal.clone().normalize(), pop, seed, segs: new Float32Array(0), kinds: new Uint8Array(0), r: 0, built: 0, spots: [] };
    this.colonies.push(c);
    this.build(c);
    return c;
  }

  /** A small orb web at a colony, sized by its family. Deterministic from its seed. */
  private build(c: Colony) {
    const R = rnd(c.seed);
    const r = Math.min(0.15, 0.045 + c.pop * 0.009);
    c.r = r;
    const n = c.normal;
    const wall = Math.abs(n.y) < 0.5;
    // the web's own plane: flat to a wall, standing up (facing you) on floors, tables and ceilings
    const face = wall ? n.clone() : new Vector3(-c.pos.x, 0, -c.pos.z + 0.6).normalize();
    const u = new Vector3().crossVectors(new Vector3(0, 1, 0), face).normalize();
    if (u.lengthSq() < 1e-4) u.set(1, 0, 0);
    const v = new Vector3().crossVectors(face, u).normalize();
    const center = wall ? c.pos.clone().addScaledVector(n, 0.035) : c.pos.clone().addScaledVector(n, r + 0.05);
    const segs: number[] = [];
    const kinds: number[] = [];
    const P = (a: number, rr: number) => center.clone().addScaledVector(u, Math.cos(a) * rr).addScaledVector(v, Math.sin(a) * rr);
    const seg = (a: Vector3, b: Vector3, k: number) => {
      segs.push(a.x, a.y, a.z, b.x, b.y, b.z);
      kinds.push(k);
    };
    const spokes = 9 + Math.floor(R() * 4);
    const rot = R() * 6.28;
    const ang = Array.from({ length: spokes }, (_, i) => rot + (i / spokes) * 6.28 + (R() - 0.5) * 0.25);
    const rim = ang.map((a) => r * (0.85 + R() * 0.3));
    // moorings to the surface
    for (let i = 0; i < 4; i++) {
      const a = ang[Math.floor((i / 4) * spokes)];
      const p = P(a, rim[Math.floor((i / 4) * spokes)]);
      const toSurf = wall
        ? p.clone().addScaledVector(n, -0.035).addScaledVector(u, Math.cos(a) * r * 0.6).addScaledVector(v, Math.sin(a) * r * 0.6)
        : p.clone().addScaledVector(n, -(p.clone().sub(c.pos).dot(n))).addScaledVector(u, Math.cos(a) * r * 0.5);
      seg(p, toSurf, RADIAL);
    }
    for (let i = 0; i < spokes; i++) {
      seg(center, P(ang[i], rim[i]), RADIAL);
      seg(P(ang[i], rim[i]), P(ang[(i + 1) % spokes], rim[(i + 1) % spokes]), RADIAL);
    }
    // the capture spiral: rings from the outside in, stopping short of the hub
    const rings = Math.max(2, Math.floor((r - 0.012) / 0.0085));
    for (let k = 0; k < rings; k++) {
      const f = 0.9 - (k / rings) * 0.72;
      for (let i = 0; i < spokes; i++) seg(P(ang[i], rim[i] * f), P(ang[(i + 1) % spokes], rim[(i + 1) % spokes] * (f - 0.6 / rings / spokes)), CAPTURE);
    }
    c.segs = new Float32Array(segs);
    c.kinds = new Uint8Array(kinds);
    c.spots = [center.clone(), ...ang.slice(0, 6).map((a, i) => P(a, rim[i] * (0.35 + R() * 0.45)))];
  }

  grow(c: Colony, by = 1) {
    c.pop = Math.min(30, c.pop + by);
    this.build(c);
  }

  // ---------------- per frame ----------------

  /**
   * Sacs ride the web. Once mature (`minAge`), a sac waits for warmth: when the sun comes back after rain
   * (`warm`), it trembles for a few seconds and opens, as spiderlings disperse on warm, still air.
   */
  update(dt: number, wetness: number, silk: SilkMesh, drops: DropMesh, sacParticle: (i: number) => Vector3 | null, minAge: number, warm: boolean) {
    for (const s of this.sacs) {
      if (s.hatched) continue;
      s.age += dt;
      if (s.grow < 1) {
        s.grow = Math.min(1, s.grow + dt / 6);
        const g = s.grow * s.grow * (3 - 2 * s.grow);
        s.mesh.scale.set(0.0085, 0.011, 0.0085).multiplyScalar(Math.max(0.05, g));
      }
      const at = sacParticle(s.particle);
      if (at) {
        s.pos.copy(at).y -= 0.011;
        s.mesh.position.copy(s.pos);
      }
      if (s.grow >= 1 && s.age >= minAge && (warm || s.quiver > 0)) s.quiver += dt;
      s.mesh.position.x += s.quiver > 0 ? Math.sin(s.age * 40) * 0.0004 * Math.min(1, s.quiver) : 0;
      if (s.quiver > 4) this.hatch(s);
    }
    this.sacs = this.sacs.filter((s) => !s.hatched);

    let n = 0;
    const M = this.inst;
    const put = (p: Vector3, dir: Vector3, scale: number) => {
      if (n >= 600) return;
      this.o.position.copy(p);
      this.q.setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize());
      this.o.quaternion.copy(this.q);
      this.o.scale.setScalar(scale);
      this.o.updateMatrix();
      M.setMatrixAt(n++, this.o.matrix);
    };

    for (const b of this.babies) {
      b.t += dt;
      b.jitter += dt;
      if (b.state === 'ball') {
        // the ball: they cling together and seethe a little
        b.p.copy(b.from).add(b.ball).addScaledVector(new Vector3(Math.sin(b.jitter * 7), Math.cos(b.jitter * 5), 0), 0.0015);
        put(b.p, new Vector3(Math.sin(b.jitter), 1, 0), 0.0042);
        if (b.t >= 0) {
          b.state = 'fly';
          b.colony = this.pickColony();
          b.to.copy(b.colony.spots[Math.floor(Math.random() * b.colony.spots.length)]);
          b.from.copy(b.p);
          b.dur = 4 + b.from.distanceTo(b.to) * 2.5;
          b.t = 0;
        }
      } else if (b.state === 'fly') {
        // ballooning: carried on a thread, rising in the middle of the journey, swaying
        const k = Math.min(1, b.t / b.dur);
        const e = k * k * (3 - 2 * k);
        b.p.lerpVectors(b.from, b.to, e);
        b.p.y += Math.sin(k * Math.PI) * 0.25;
        b.p.x += Math.sin(b.jitter * 1.7) * 0.03 * Math.sin(k * Math.PI);
        silk.push(b.from.x, b.from.y, b.from.z, b.p.x, b.p.y, b.p.z, 0.00012, 1, RADIAL + 0.5, 1 - k * 0.6, 0);
        put(b.p, b.to.clone().sub(b.from), 0.0042);
        if (k >= 1) {
          b.state = 'home';
          this.grow(b.colony!);
          this.onArrive?.(b.to);
        }
      }
    }
    this.babies = this.babies.filter((b) => b.state !== 'home');

    // the families and their webs
    for (const c of this.colonies) {
      const s = c.segs;
      for (let i = 0; i < c.kinds.length; i++) {
        const k = i * 6;
        silk.push(s[k], s[k + 1], s[k + 2], s[k + 3], s[k + 4], s[k + 5], c.kinds[i] === CAPTURE ? 0.0001 : 0.00015, 1, c.kinds[i], 1, wetness);
        if (wetness > 0.08 && i % 2 === 0) {
          const t = ((i * 0.618) % 1) * 0.8 + 0.1;
          drops.push(s[k] + (s[k + 3] - s[k]) * t, s[k + 1] + (s[k + 4] - s[k + 1]) * t - 0.0008, s[k + 2] + (s[k + 5] - s[k + 2]) * t, 0.0011 * wetness);
        }
      }
      const show = Math.min(c.spots.length, Math.max(1, Math.ceil(c.pop / 4)));
      for (let i = 0; i < show && c.pop > 0; i++) {
        const sp = c.spots[i];
        const wob = Math.sin(this.time * 0.7 + i * 2 + c.seed) * 0.0015;
        put(new Vector3(sp.x + wob, sp.y, sp.z), new Vector3(0, -1, 0), i === 0 ? 0.0042 + c.pop * 0.00012 : 0.0042);
      }
    }
    this.time += dt;
    M.count = n;
    M.instanceMatrix.needsUpdate = true;
  }
  private time = 0;

  pendingSacs() {
    return this.sacs.length;
  }

  /** A fly that wandered into a family's web: they eat, and the family grows. */
  feedColony(c: Colony) {
    this.grow(c, 1);
  }

  hatchAll() {
    for (const s of this.sacs) this.hatch(s);
  }

  /** While you were away: families grow, and the biggest ones send out new ones. */
  passTime(hours: number) {
    const add = Math.floor(Math.min(24, hours) * 1.5);
    for (let k = 0; k < add && this.colonies.length; k++) {
      const c = this.colonies[Math.floor(Math.random() * this.colonies.length)];
      if (c.pop >= 14 && Math.random() < 0.5) {
        const free = this.sites.find((s) => this.colonies.every((o) => o.pos.distanceTo(s.pos) > 0.45));
        if (free) {
          this.found(free, 2);
          continue;
        }
      }
      this.grow(c);
    }
  }

  save(): { colonies: ColonySave[]; sacs: SacSave[] } {
    return {
      colonies: this.colonies.map((c) => ({ p: c.pos.toArray().map((x) => +x.toFixed(3)), n: c.normal.toArray().map((x) => +x.toFixed(3)), pop: c.pop, seed: c.seed })),
      sacs: this.sacs.map((s) => ({ p: s.pos.toArray().map((x) => +x.toFixed(4)), age: s.age })),
    };
  }

  restoreColonies(cs: ColonySave[]) {
    for (const c of cs) this.found({ pos: new Vector3().fromArray(c.p), normal: new Vector3().fromArray(c.n), label: '' }, c.pop, c.seed);
  }
}
