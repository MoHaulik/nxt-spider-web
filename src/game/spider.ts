// The spider: an original, minimal design, drawn the way a good animation studio would draw a real
// house spider. Soft, warm and rounded rather than black and glossy: a velvety honey-brown abdomen with
// a cream leaf mark, a chestnut carapace, two small catch-light eyes, and eight long banded legs with
// rounded tips. Nothing cartoon (no big eyes, no smile), nothing that reads as a tick (long legs, a
// clear two-part body) and nothing that reads as a threat (no fangs, no hair, no spike).
// Built at body length 1 and scaled; it hangs head-down from its dragline, back toward you.

import {
  BufferAttribute,
  Color,
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

type Leg = { joints: Object3D[]; side: number; pair: number; yaw: number; elev: number; b1: number; b2: number; phase: number; len: number; gw: number; gy: number; gr: number };

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function abdomenGeometry() {
  const g = new SphereGeometry(1, 56, 40);
  const pos = g.attributes.position as BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const back = new Color(0.4, 0.22, 0.1); // warm umber on the back
  const belly = new Color(0.66, 0.46, 0.26); // honey underneath
  const leaf = new Color(0.3, 0.16, 0.07); // the folium, a shade darker
  const cream = new Color(0.95, 0.86, 0.68);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // darker on the back, warmer and lighter toward the flanks and belly
    c.copy(back).lerp(belly, smooth(0.5, -0.4, z) * 0.85 + smooth(0.7, 1.0, Math.abs(x)) * 0.2);
    // the folium: a scalloped leaf down the back, drawn mostly by its fine cream outline
    const w = 0.46 * Math.sqrt(Math.max(0, 1 - y * y * 1.1)) * (0.8 + 0.2 * Math.cos(y * 13));
    const inLeaf = smooth(w, w - 0.06, Math.abs(x)) * smooth(0.1, 0.4, z);
    c.lerp(leaf, inLeaf * 0.7);
    const edge = Math.exp(-Math.pow((Math.abs(x) - w) / 0.02, 2)) * smooth(0.15, 0.45, z) * smooth(0.95, 0.55, Math.abs(y));
    c.lerp(cream, edge * 0.8);
    // a small cross of cream dots down the midline (the garden spider's mark)
    for (const [dx, dy, r] of [[0, 0.5, 0.055], [0, 0.32, 0.05], [0, 0.14, 0.045], [-0.11, 0.32, 0.038], [0.11, 0.32, 0.038]]) {
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
  groom = 0; // idle: the front legs drawn through the jaws
  alarm = 0; // 0..1: something large is coming; it draws its legs in and holds very still
  holds: Vector3[] = []; // silk within reach, in the web frame: the legs take hold of it
  private hl = Array.from({ length: 32 }, () => new Vector3());
  fullness = 1; // silk in reserve, 0..1: a plump abdomen means silk to spin
  gravid = 0; // carrying eggs, 0..1: the abdomen swells before it lays
  private t = 0;
  private q = new Quaternion();
  private m = new Matrix4();
  private vLocal = new Vector3();
  private materials: MeshPhysicalMaterial[] = [];

  constructor(env: Texture | null, private baseLength: number) {
    this.root.add(this.body);
    // velvet, not gloss: a soft sheen catches the rim light the way fine hair does, without drawing hair
    const abMat = new MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.58,
      clearcoat: 0.22,
      clearcoatRoughness: 0.4,
      sheen: 1,
      sheenRoughness: 0.5,
      sheenColor: new Color(1.0, 0.82, 0.6),
      envMapIntensity: 0.9,
    });
    const carapace = new MeshPhysicalMaterial({ color: new Color(0.33, 0.18, 0.085), roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.3, sheen: 0.8, sheenColor: new Color(1, 0.85, 0.65), envMapIntensity: 1.0 });
    const legMat = new MeshPhysicalMaterial({ color: new Color(0.36, 0.21, 0.1), roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.35, sheen: 0.7, sheenColor: new Color(1, 0.88, 0.7) });
    const band = new MeshPhysicalMaterial({ color: new Color(0.9, 0.76, 0.55), roughness: 0.5, clearcoat: 0.3, sheen: 0.6, sheenColor: new Color(1, 0.95, 0.85) });
    const eye = new MeshPhysicalMaterial({ color: new Color(0.02, 0.014, 0.012), roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.4 });
    this.materials = [abMat, carapace, legMat, band, eye];
    for (const m of this.materials) m.envMap = env;

    // a round, slightly tall abdomen: the softest shape there is
    this.abdomen = new Mesh(abdomenGeometry(), abMat);
    this.abdomen.scale.set(0.38, 0.42, 0.36);
    this.abdomen.position.set(0, -0.4, 0.05);
    this.body.add(this.abdomen);

    const ceph = new Mesh(new SphereGeometry(1, 32, 20), carapace);
    ceph.scale.set(0.19, 0.22, 0.13);
    ceph.position.set(0, 0.22, 0.02);
    this.body.add(ceph);
    const ped = new Mesh(new CylinderGeometry(0.05, 0.055, 0.1, 10), carapace);
    ped.position.set(0, -0.01, 0.02);
    this.body.add(ped);

    // eyes: two small main eyes with a catch-light, two tiny ones beside them. Small on purpose.
    for (const s of [-1, 1]) {
      const e1 = new Mesh(new SphereGeometry(0.034, 16, 10), eye);
      e1.position.set(s * 0.055, 0.39, 0.1);
      const e2 = new Mesh(new SphereGeometry(0.014, 10, 6), eye);
      e2.position.set(s * 0.1, 0.36, 0.085);
      this.body.add(e1, e2);
    }
    // spinnerets: two soft rounded nubs at the tip of the abdomen (no spike)
    for (const s of [-1, 1]) {
      const n = new Mesh(new SphereGeometry(0.03, 10, 7), carapace);
      n.position.set(s * 0.025, -0.8, 0.04);
      this.body.add(n);
    }
    this.spinneret.position.set(0, -0.84, 0.04);
    this.body.add(this.spinneret);
    this.mouth.position.set(0, 0.46, 0.03);
    this.body.add(this.mouth);

    // legs: I and II long and forward, III short, IV long and back (an orb-weaver's proportions),
    // a touch sturdier than life so they read as limbs and not as wire
    const pairs = [
      { y: 0.33, yaw: 0.42, len: 2.5, elev: 0.42, b1: -0.8, b2: -0.28 },
      { y: 0.27, yaw: 0.95, len: 2.25, elev: 0.45, b1: -0.85, b2: -0.25 },
      { y: 0.2, yaw: 1.85, len: 1.5, elev: 0.55, b1: -1.0, b2: -0.25 },
      { y: 0.13, yaw: 2.55, len: 2.0, elev: 0.45, b1: -0.8, b2: -0.25 },
    ];
    const segs = [0.36, 0.38, 0.26];
    const radii = [0.036, 0.028, 0.02, 0.009];
    pairs.forEach((pr, pair) => {
      for (const side of [-1, 1]) {
        const joints: Object3D[] = [];
        let parent: Object3D = this.body;
        const base = new Object3D();
        base.position.set(side * 0.15, pr.y, 0.02);
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
          const geo = new CylinderGeometry(radii[k + 1], radii[k], L, 8, 1);
          geo.translate(0, L / 2, 0);
          j.add(new Mesh(geo, legMat));
          // a rounded knee at each joint, and a cream band just below it: the banded legs of a garden spider
          const knee = new Mesh(new SphereGeometry(radii[k] * 1.05, 8, 6), legMat);
          j.add(knee);
          if (k < 2) {
            const kn = new Mesh(new CylinderGeometry(radii[k + 1] * 1.12, radii[k + 1] * 1.14, L * 0.2, 8), band);
            kn.position.y = L * 0.86;
            j.add(kn);
          } else {
            const tip = new Mesh(new SphereGeometry(radii[3] * 1.3, 8, 6), legMat);
            tip.position.y = L;
            j.add(tip);
          }
          joints.push(j);
          parent = j;
        }
        this.legs.push({ joints, side, pair, yaw: pr.yaw, elev: pr.elev, b1: pr.b1, b2: pr.b2, phase: Math.random() * 6.28, len: pr.len, gw: 0, gy: pr.yaw, gr: 0.75 });
      }
    });
    // the palps: two short, soft feelers at the front
    for (const side of [-1, 1]) {
      const base = new Object3D();
      base.position.set(side * 0.065, 0.42, 0.04);
      base.rotation.order = 'ZXY';
      base.rotation.set(0.6, 0, -side * 0.35);
      this.body.add(base);
      const g1 = new CylinderGeometry(0.02, 0.024, 0.13, 6).translate(0, 0.065, 0);
      base.add(new Mesh(g1, legMat));
      const tip = new Object3D();
      tip.position.y = 0.13;
      tip.rotation.x = -1.0;
      base.add(tip);
      const g2 = new CylinderGeometry(0.024, 0.02, 0.09, 6).translate(0, 0.045, 0);
      tip.add(new Mesh(g2, legMat));
      const end = new Mesh(new SphereGeometry(0.026, 8, 6), legMat);
      end.position.y = 0.09;
      tip.add(end);
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
    const breathe = 1 + Math.sin(t * 1.7) * 0.012;
    const plump = 0.86 + 0.16 * this.fullness + 0.32 * this.gravid;
    this.abdomen.scale.set(0.38 * breathe * plump, 0.42 * (0.94 + 0.06 * plump + 0.12 * this.gravid), 0.36 * breathe * plump);
    this.palps.forEach((p, i) => (p.rotation.x = 0.6 + Math.sin(t * 1.9 + i * 1.9) * 0.1 + this.eating * Math.sin(t * 9 + i) * 0.3 - this.alarm * 0.3));

    // silk within reach, in body space (body length 1)
    const inv = this.q.copy(this.root.quaternion).invert();
    const nh = Math.min(this.holds.length, this.hl.length);
    for (let i = 0; i < nh; i++) this.hl[i].copy(this.holds[i]).sub(pos).applyQuaternion(inv).divideScalar(this.scaleM);
    const calm = speed < 0.45 && this.unfold > 0.99;
    const al = this.alarm;

    for (const L of this.legs) {
      const u = this.unfold;
      // slow, unhurried idling: quick twitches are what make a spider frightening
      const idle = Math.sin(t * 0.9 + L.phase) * 0.045 * (1 - al);
      const drag = Math.max(-0.3, Math.min(0.3, this.vLocal.x * 1.8)) * L.side;
      let yaw = L.yaw - drag * 0.6;
      let elev = L.elev + idle - speed * 0.18;
      let b1 = L.b1 - idle * 0.6;
      let b2 = L.b2;
      // taking hold: each leg reaches for the nearest thread in its own direction
      const busy = (L.pair === 3 && this.spinning > 0.3) || (L.pair < 2 && (this.eating > 0.3 || this.groom > 0.3)) || al > 0.5;
      let want = 0;
      if (calm && !busy) {
        const b = L.joints[0].position;
        let best = 0.75;
        for (let i = 0; i < nh; i++) {
          const h = this.hl[i];
          const dx = h.x - b.x, dy = h.y - b.y;
          if (Math.abs(h.z) > 0.5) continue;
          const d = Math.hypot(dx, dy);
          if (d < L.len * 0.45 || d > L.len * 0.98) continue;
          const yt = Math.atan2(L.side * dx, dy);
          const score = Math.abs(yt - L.yaw) + Math.abs(d / L.len - 0.75) * 0.6;
          if (score < best) {
            best = score;
            L.gy += (yt - L.gy) * Math.min(1, dt * 10);
            L.gr += (d / L.len - L.gr) * Math.min(1, dt * 10);
            want = 1;
          }
        }
      }
      L.gw += (want - L.gw) * Math.min(1, dt * (want ? 5 : 3));
      if (L.gw > 0.01) {
        yaw += (L.gy - yaw) * L.gw * 0.85;
        b1 += L.gw * (0.78 - L.gr) * -1.7;
        elev -= L.gw * 0.12;
      }
      // grooming: the front legs drawn through the jaws in turn
      if (L.pair === 0 && this.groom > 0) {
        const s = Math.sin(t * 6 + (L.side > 0 ? 0 : Math.PI));
        yaw -= this.groom * 0.4;
        elev += this.groom * (0.85 + s * 0.2);
        b1 -= this.groom * (0.95 + s * 0.3);
        b2 -= this.groom * 0.5;
      }
      // spinning: the back legs comb silk out of the spinnerets in turns
      if (L.pair === 3 && this.spinning > 0) {
        const s = Math.sin(t * 10 + (L.side > 0 ? 0 : Math.PI));
        elev += this.spinning * (0.25 + s * 0.3);
        b1 -= this.spinning * (0.35 + s * 0.25);
        yaw += this.spinning * 0.25;
      }
      // eating: the front legs draw in and turn the parcel
      if (L.pair < 2 && this.eating > 0) {
        const s = Math.sin(t * 8 + L.pair * 1.7 + (L.side > 0 ? 0 : 1.3));
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
      // alarm: legs drawn in close, the body held low and still
      if (al > 0) {
        elev += al * 0.3;
        b1 -= al * 0.7;
        b2 -= al * 0.3;
        yaw += al * (L.pair < 2 ? -0.15 : 0.15);
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
