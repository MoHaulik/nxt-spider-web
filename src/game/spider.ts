// The spider: an original, minimal design. A pearl abdomen with a soft leaf mark, a dark glossy
// carapace, two catch-light eyes, and eight hair-thin legs with pale knuckles. No hair, no fangs.
// Built at body length 1 and scaled; it hangs head-down from its dragline, back toward you.

import {
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Texture,
  Vector3,
} from '@iwsdk/core';

type Leg = { joints: Object3D[]; side: number; pair: number; yaw: number; elev: number; b1: number; b2: number; phase: number };

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function abdomenGeometry() {
  const g = new SphereGeometry(1, 56, 40);
  const pos = g.attributes.position as BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const dark = new Color(0.075, 0.042, 0.024);
  const warm = new Color(0.3, 0.16, 0.075);
  const leaf = new Color(0.2, 0.11, 0.055);
  const cream = new Color(0.92, 0.8, 0.6);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // dark glossy back, warmer toward the flanks and belly
    c.copy(dark).lerp(warm, smooth(0.5, -0.3, z) * 0.8 + smooth(0.7, 1.0, Math.abs(x)) * 0.25);
    // the folium: a scalloped leaf down the back, drawn mostly by its fine cream outline
    const w = 0.46 * Math.sqrt(Math.max(0, 1 - y * y * 1.1)) * (0.8 + 0.2 * Math.cos(y * 13));
    const inLeaf = smooth(w, w - 0.06, Math.abs(x)) * smooth(0.1, 0.4, z);
    c.lerp(leaf, inLeaf * 0.8);
    const edge = Math.exp(-Math.pow((Math.abs(x) - w) / 0.018, 2)) * smooth(0.15, 0.45, z) * smooth(0.95, 0.55, Math.abs(y));
    c.lerp(cream, edge * 0.75);
    // a small cross of cream dots down the midline (the garden spider's mark)
    for (const [dx, dy, r] of [[0, 0.5, 0.05], [0, 0.32, 0.045], [0, 0.14, 0.04], [-0.1, 0.32, 0.035], [0.1, 0.32, 0.035]]) {
      const d = Math.hypot(x - dx, y - dy);
      c.lerp(cream, smooth(r, r * 0.45, d) * smooth(0.3, 0.6, z) * 0.9);
    }
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  return g;
}

export class Spider {
  readonly root = new Group();
  private body = new Group();
  private legs: Leg[] = [];
  private palps: Object3D[] = [];
  private abdomen: Mesh;
  readonly spinneret = new Object3D();
  readonly mouth = new Object3D();
  size = 1;
  unfold = 0; // 0 folded for the descent, 1 open
  spinning = 0;
  eating = 0;
  wave = 0;
  fullness = 1; // silk in reserve, 0..1: a plump abdomen means silk to spin
  gravid = 0; // carrying eggs, 0..1: the abdomen swells before it lays
  private t = 0;
  private q = new Quaternion();
  private m = new Matrix4();
  private vLocal = new Vector3();
  private materials: MeshPhysicalMaterial[] = [];

  constructor(env: Texture | null, private baseLength: number) {
    this.root.add(this.body);
    const abMat = new MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.3,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      sheen: 0.6,
      sheenRoughness: 0.35,
      sheenColor: new Color(1.0, 0.7, 0.4),
      iridescence: 0.2,
      iridescenceIOR: 1.35,
      envMapIntensity: 1.1,
    });
    const carapace = new MeshPhysicalMaterial({ color: new Color(0.17, 0.095, 0.05), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.2 });
    const legMat = new MeshPhysicalMaterial({ color: new Color(0.15, 0.085, 0.045), roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.2 });
    const knuckle = new MeshPhysicalMaterial({ color: new Color(0.8, 0.64, 0.42), roughness: 0.35, clearcoat: 0.7 });
    const eye = new MeshPhysicalMaterial({ color: new Color(0.01, 0.01, 0.012), roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.2 });
    this.materials = [abMat, carapace, legMat, knuckle, eye];
    for (const m of this.materials) m.envMap = env;

    this.abdomen = new Mesh(abdomenGeometry(), abMat);
    this.abdomen.scale.set(0.36, 0.4, 0.33);
    this.abdomen.position.set(0, -0.4, 0.05);
    this.body.add(this.abdomen);

    const ceph = new Mesh(new SphereGeometry(1, 32, 20), carapace);
    ceph.scale.set(0.17, 0.22, 0.11);
    ceph.position.set(0, 0.22, 0.02);
    this.body.add(ceph);
    const ped = new Mesh(new CylinderGeometry(0.04, 0.045, 0.1, 10), carapace);
    ped.position.set(0, -0.01, 0.02);
    this.body.add(ped);

    for (const s of [-1, 1]) {
      const e1 = new Mesh(new SphereGeometry(0.032, 16, 10), eye);
      e1.position.set(s * 0.05, 0.39, 0.09);
      const e2 = new Mesh(new SphereGeometry(0.018, 12, 8), eye);
      e2.position.set(s * 0.095, 0.36, 0.075);
      this.body.add(e1, e2);
    }
    const spin = new Mesh(new ConeGeometry(0.035, 0.07, 10), carapace);
    spin.position.set(0, -0.81, 0.04);
    spin.rotation.x = Math.PI;
    this.body.add(spin);
    this.spinneret.position.set(0, -0.84, 0.04);
    this.body.add(this.spinneret);
    this.mouth.position.set(0, 0.46, 0.03);
    this.body.add(this.mouth);

    // legs: I and II long and forward, III short, IV long and back (an orb-weaver's proportions)
    const pairs = [
      { y: 0.33, yaw: 0.42, len: 2.7, elev: 0.42, b1: -0.8, b2: -0.28 },
      { y: 0.27, yaw: 0.95, len: 2.4, elev: 0.45, b1: -0.85, b2: -0.25 },
      { y: 0.2, yaw: 1.85, len: 1.55, elev: 0.55, b1: -1.0, b2: -0.25 },
      { y: 0.13, yaw: 2.55, len: 2.1, elev: 0.45, b1: -0.8, b2: -0.25 },
    ];
    const segs = [0.36, 0.38, 0.26];
    const radii = [0.03, 0.023, 0.015, 0.006];
    pairs.forEach((pr, pair) => {
      for (const side of [-1, 1]) {
        const joints: Object3D[] = [];
        let parent: Object3D = this.body;
        const base = new Object3D();
        base.position.set(side * 0.14, pr.y, 0.02);
        base.rotation.order = 'ZXY';
        parent.add(base);
        parent = base;
        for (let k = 0; k < 3; k++) {
          const j = k === 0 ? base : new Object3D();
          if (k > 0) {
            j.position.set(0, pr.len * segs[k - 1], 0);
            parent.add(j);
          }
          const L = pr.len * segs[k];
          const geo = new CylinderGeometry(radii[k + 1], radii[k], L, 7, 1);
          geo.translate(0, L / 2, 0);
          j.add(new Mesh(geo, legMat));
          if (k < 2) {
            // a pale band at each joint: the clearest 'spider' cue at a distance
            const kn = new Mesh(new CylinderGeometry(radii[k + 1] * 1.18, radii[k + 1] * 1.18, L * 0.16, 7), knuckle);
            kn.position.y = L * 0.93;
            j.add(kn);
          }
          joints.push(j);
          parent = j;
        }
        this.legs.push({ joints, side, pair, yaw: pr.yaw, elev: pr.elev, b1: pr.b1, b2: pr.b2, phase: Math.random() * 6.28 });
      }
    });
    // the palps: two short feelers at the front
    for (const side of [-1, 1]) {
      const base = new Object3D();
      base.position.set(side * 0.06, 0.42, 0.04);
      base.rotation.order = 'ZXY';
      base.rotation.set(0.6, 0, -side * 0.35);
      this.body.add(base);
      const g1 = new CylinderGeometry(0.016, 0.02, 0.16, 6).translate(0, 0.08, 0);
      base.add(new Mesh(g1, legMat));
      const tip = new Object3D();
      tip.position.y = 0.16;
      tip.rotation.x = -1.1;
      base.add(tip);
      const g2 = new CylinderGeometry(0.022, 0.016, 0.12, 6).translate(0, 0.06, 0);
      tip.add(new Mesh(g2, legMat));
      this.palps.push(base);
    }
    this.root.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) m.frustumCulled = false;
    });
  }

  get scaleM() {
    return this.baseLength * this.size;
  }

  /**
   * Hang the spider at `pos`, abdomen toward `up` (the dragline), back turned toward `toCam`.
   * `twist` turns it about its own dragline; `vel` drives the secondary motion of the legs.
   */
  pose(pos: Vector3, up: Vector3, toCam: Vector3, twist: number, vel: Vector3, dt: number) {
    this.t += dt;
    this.root.position.copy(pos);
    const y = up.clone().negate().normalize();
    const z = toCam.clone().sub(y.clone().multiplyScalar(toCam.dot(y))).normalize();
    const x = new Vector3().crossVectors(y, z);
    this.m.makeBasis(x, y, z);
    this.q.setFromRotationMatrix(this.m);
    if (twist) this.q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), twist));
    this.root.quaternion.slerp(this.q, 1 - Math.exp(-dt * 10));
    this.root.scale.setScalar(this.scaleM);

    this.vLocal.copy(vel).applyQuaternion(this.root.quaternion.clone().invert());
    const speed = Math.min(1.5, vel.length() * 3);
    const t = this.t;
    const breathe = 1 + Math.sin(t * 2.1) * 0.012;
    const plump = 0.86 + 0.16 * this.fullness + 0.32 * this.gravid;
    this.abdomen.scale.set(0.36 * breathe * plump, 0.4 * (0.94 + 0.06 * plump + 0.12 * this.gravid), 0.33 * breathe * plump);
    this.palps.forEach((p, i) => (p.rotation.x = 0.6 + Math.sin(t * 2.3 + i * 1.9) * 0.12 + this.eating * Math.sin(t * 13 + i) * 0.3));

    for (const L of this.legs) {
      const u = this.unfold;
      const idle = Math.sin(t * 1.3 + L.phase) * 0.05;
      const drag = Math.max(-0.35, Math.min(0.35, this.vLocal.x * 2.2)) * L.side;
      let yaw = L.yaw - drag * 0.6;
      let elev = L.elev + idle - speed * 0.2;
      let b1 = L.b1 - idle * 0.6;
      let b2 = L.b2;
      // spinning: the back legs comb silk out of the spinnerets in turns
      if (L.pair === 3 && this.spinning > 0) {
        const s = Math.sin(t * 13 + (L.side > 0 ? 0 : Math.PI));
        elev += this.spinning * (0.25 + s * 0.3);
        b1 -= this.spinning * (0.35 + s * 0.25);
        yaw += this.spinning * 0.25;
      }
      // eating: the front legs draw in and turn the parcel
      if (L.pair < 2 && this.eating > 0) {
        const s = Math.sin(t * 11 + L.pair * 1.7 + (L.side > 0 ? 0 : 1.3));
        yaw -= this.eating * 0.35;
        elev += this.eating * (0.5 + s * 0.15);
        b1 -= this.eating * (0.5 + s * 0.3);
        b2 -= this.eating * 0.4;
      }
      if (L.pair === 0 && L.side < 0 && this.wave > 0) {
        elev += this.wave * (0.9 + Math.sin(t * 5) * 0.15);
        b1 += this.wave * 0.7;
        yaw -= this.wave * 0.3;
      }
      // folded tight against the body for the descent
      yaw = yaw * u + (L.pair < 2 ? 0.18 : 2.85) * (1 - u);
      elev = elev * u + 0.35 * (1 - u);
      b1 = b1 * u + -2.6 * (1 - u);
      b2 = b2 * u + -0.6 * (1 - u);
      const [j0, j1, j2] = L.joints;
      j0.rotation.set(elev, 0, -L.side * yaw);
      j1.rotation.x = b1;
      j2.rotation.x = b2;
    }
  }

  /** A point on the body, in the frame the spider's root lives in (the web frame). */
  local(o: Object3D, out: Vector3) {
    this.root.updateMatrix();
    return out.copy(o.position).applyMatrix4(this.root.matrix);
  }
}
