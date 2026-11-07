// Flies: a green-bottle fly, built procedurally and a touch larger than life so it reads at arm's length.
// They wander, hover and dart, are drawn toward the glints of the web, stick on the capture spiral,
// struggle (shaking the web), and tear free if the spider is too slow.

import {
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  Vector3,
} from '@iwsdk/core';
import { CFG } from './config.js';
import { CAPTURE, MOOR, RADIAL, Web } from './web.js';

export type FlyState = 'fly' | 'stuck' | 'eaten' | 'gone';

const rand = (a: number, b: number) => a + Math.random() * (b - a);

let shared: ReturnType<typeof makeShared> | null = null;
function makeShared(env: Texture | null) {
  const eye = new MeshPhysicalMaterial({ color: new Color(0.42, 0.06, 0.04), roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.25, sheen: 0.6, sheenColor: new Color(0.9, 0.3, 0.2), envMap: env });
  const thorax = new MeshPhysicalMaterial({ color: new Color(0.1, 0.12, 0.1), metalness: 0.55, roughness: 0.32, iridescence: 0.5, iridescenceIOR: 1.6, envMap: env });
  const abdomen = new MeshPhysicalMaterial({ color: new Color(0.16, 0.42, 0.24), metalness: 0.8, roughness: 0.2, iridescence: 0.8, iridescenceIOR: 1.8, clearcoat: 0.6, envMap: env });
  const golden = new MeshPhysicalMaterial({ color: new Color(0.95, 0.68, 0.22), metalness: 0.9, roughness: 0.18, iridescence: 0.6, envMap: env, emissive: new Color(0.35, 0.2, 0.04) });
  const leg = new MeshPhysicalMaterial({ color: new Color(0.03, 0.03, 0.03), roughness: 0.5 });
  const wing = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: { uBlur: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vPos;
      void main(){ vUv = uv; vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.0); vPos = w.xyz;
        gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */ `
      uniform float uBlur;
      varying vec2 vUv; varying vec3 vN; varying vec3 vPos;
      void main(){
        vec2 q = vUv*2.0 - 1.0;
        float shape = 1.0 - (q.x*q.x*0.9 + q.y*q.y*1.1);
        if (shape < 0.0) discard;
        float veins = 0.0;
        for (int i = 0; i < 4; i++) veins += smoothstep(0.035, 0.0, abs(q.y + 0.55 - float(i)*0.38 - q.x*0.12));
        float ndv = abs(dot(normalize(vN), normalize(cameraPosition - vPos)));
        vec3 film = 0.5 + 0.5*cos(6.28318*(ndv*1.7 + vUv.x*0.6 + vec3(0.0,0.33,0.67)));
        vec3 col = mix(vec3(0.55), film, 0.55) + veins*0.08;
        float a = (0.18 + veins*0.35 + pow(1.0-ndv, 3.0)*0.3) * smoothstep(0.0, 0.12, shape);
        a *= mix(1.0, 0.35, uBlur);
        gl_FragColor = vec4(col, a);
      }`,
  });
  const wingGeo = new PlaneGeometry(1, 1);
  wingGeo.rotateX(-Math.PI / 2);
  wingGeo.translate(0.5, 0, -0.5);
  const parcel = new MeshPhysicalMaterial({ color: new Color(0.93, 0.9, 0.84), roughness: 0.7, sheen: 1, sheenColor: new Color(1, 1, 0.95), sheenRoughness: 0.4, envMap: env });
  return {
    eye, thorax, abdomen, golden, leg, wing, wingGeo, parcel,
    sphere: new SphereGeometry(1, 24, 16),
    legGeo: new CylinderGeometry(0.008, 0.014, 1, 5).translate(0, -0.5, 0),
  };
}

export class Fly {
  readonly g = new Group();
  state: FlyState = 'fly';
  p = new Vector3();
  v = new Vector3();
  target = new Vector3();
  retarget = 0;
  age = 0;
  stuckC = -1;
  stuckT = 0;
  escape = CFG.flyEscape;
  burst = 0;
  nextBurst = 0.5;
  eatT = 0;
  hover = 0;
  commit = false;
  leaving = false;
  golden: boolean;
  sure = false; // the first fly always sticks
  wrapped = false; // caught and wrapped in silk while you were away: food in the larder
  private wings: Mesh[] = [];
  private legs: Object3D[] = [];
  private s: ReturnType<typeof makeShared>;
  heading = new Vector3(0, 0, 1);

  constructor(env: Texture | null, golden = false) {
    this.s = shared ??= makeShared(env);
    this.golden = golden;
    const s = this.s;
    const add = (mat: MeshPhysicalMaterial, sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
      const m = new Mesh(s.sphere, mat);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      this.g.add(m);
      return m;
    };
    add(golden ? s.golden : s.thorax, 0.2, 0.19, 0.25, 0, 0, 0.08);
    add(golden ? s.golden : s.abdomen, 0.2, 0.16, 0.3, 0, -0.02, -0.3);
    add(s.thorax, 0.15, 0.14, 0.12, 0, 0.0, 0.36);
    for (const x of [-1, 1]) add(s.eye, 0.1, 0.12, 0.09, x * 0.09, 0.03, 0.39);
    for (const side of [-1, 1]) {
      const w = new Mesh(s.wingGeo, s.wing);
      w.position.set(side * 0.06, 0.14, 0.14);
      w.scale.set(side * 0.24, 1, 0.62);
      this.g.add(w);
      this.wings.push(w);
      for (let k = 0; k < 3; k++) {
        const l = new Mesh(s.legGeo, s.leg);
        l.position.set(side * 0.08, -0.12, 0.18 - k * 0.12);
        l.scale.set(1, 0.36, 1);
        l.rotation.set(-0.3 + k * 0.3, 0, side * 0.7);
        this.g.add(l);
        this.legs.push(l);
      }
    }
    this.g.scale.setScalar(CFG.flyLength * (golden ? 1.15 : 1));
    this.g.traverse((o) => ((o as Mesh).frustumCulled = false));
  }

  /** Wrap it: a pale silk parcel, the way an orb-weaver stores a meal. */
  wrap() {
    this.wrapped = true;
    for (const c of this.g.children) c.visible = false;
    const m = new Mesh(this.s.sphere, this.s.parcel);
    m.scale.set(0.3, 0.3, 0.55);
    this.g.add(m);
    this.heading.set(0, -1, 0.2).normalize();
  }

  /** Visual update: orientation, wing blur, kicking legs. */
  animate(dt: number, t: number) {
    if (this.wrapped) {
      this.g.position.copy(this.p);
      this.g.position.y -= 0.004;
      this.g.lookAt(this.p.clone().add(this.heading));
      return;
    }
    const flying = this.state === 'fly';
    const kicking = this.state === 'stuck' && this.burst > 0;
    this.wings.forEach((w, i) => {
      const side = i === 0 ? -1 : 1;
      if (flying || kicking) {
        w.rotation.z = side * rand(-0.9, 0.7);
        w.rotation.y = side * rand(-0.2, 0.4);
      } else {
        w.rotation.z = side * -0.05;
        w.rotation.y = side * -0.35;
      }
    });
    this.legs.forEach((l, i) => {
      const k = i % 3;
      l.rotation.x = -0.3 + k * 0.3 + (kicking ? Math.sin(t * 30 + i * 2) * 0.5 : flying ? 0.5 : 0);
    });
    if (flying && this.v.lengthSq() > 1e-6) this.heading.lerp(this.v.clone().normalize(), 1 - Math.exp(-dt * 8));
    const look = this.p.clone().add(this.heading);
    this.g.position.copy(this.p);
    this.g.lookAt(look);
    if (kicking) this.g.rotateZ(Math.sin(t * 23) * 0.25);
  }
}

export type SwarmEvents = {
  onStick(f: Fly): void;
  onEscape(f: Fly): void;
  onBounce(f: Fly, c: number): void;
};

export class Swarm {
  flies: Fly[] = [];
  readonly group = new Group();
  private tmp = { x: 0, y: 0, z: 0 };
  constructor(private env: Texture | null, private ev: SwarmEvents) {}

  spawn(opts: { sure?: boolean; golden?: boolean; side?: number } = {}) {
    const f = new Fly(this.env, !!opts.golden);
    const side = opts.side ?? (Math.random() < 0.5 ? -1 : 1);
    f.p.set(side * rand(1.0, 1.6), rand(-0.2, 0.6), rand(-1.4, -0.3));
    f.v.set(-side * 0.3, 0, 0.1);
    f.sure = !!opts.sure;
    f.retarget = 0;
    this.flies.push(f);
    this.group.add(f.g);
    return f;
  }

  private pickTarget(f: Fly, web: Web, bounds: number) {
    f.retarget = rand(1.2, 3.2);
    f.hover = Math.random() < 0.35 ? rand(0.4, 1.4) : 0;
    if (f.leaving) {
      f.target.set(Math.sign(f.p.x || 1) * 3, rand(0, 1), -2.5);
      return;
    }
    // drawn toward the glints: aim through the capture spiral more often the older it gets
    const toWeb = f.sure ? f.age > 4 : Math.random() < 0.45 + Math.min(0.35, f.age * 0.02);
    if (toWeb) {
      let best = -1;
      for (let tries = 0; tries < 12 && best < 0; tries++) {
        const c = Math.floor(Math.random() * web.nC);
        if (web.cAlive[c] && web.kind[c] === CAPTURE && web.born[c] <= web.time) best = c;
      }
      if (best >= 0) {
        web.pointOn(best, Math.random(), this.tmp);
        f.target.set(this.tmp.x, this.tmp.y, this.tmp.z - Math.sign(f.p.z || -1) * 0.4);
        f.commit = true;
        f.hover = 0;
        return;
      }
    }
    f.commit = false;
    f.target.set(rand(-bounds, bounds) * 1.3, rand(-0.35, 0.45), rand(-0.6, 0.35));
  }

  update(dt: number, t: number, web: Web, bounds: number) {
    for (const f of this.flies) {
      f.age += dt;
      if (f.state === 'fly') {
        f.retarget -= dt;
        if (f.retarget <= 0) this.pickTarget(f, web, bounds);
        if (f.age > 28 && !f.sure) f.leaving = true;
        const to = f.target.clone().sub(f.p);
        const d = to.length();
        let speed = f.hover > 0 ? 0.05 : f.commit ? 0.55 : 0.42;
        if (d < 0.08 && !f.commit) f.retarget = Math.min(f.retarget, 0.2);
        f.hover -= dt;
        const desired = to.multiplyScalar(speed / Math.max(d, 1e-3));
        // hover jitter, and a constant small erratic wobble
        desired.x += Math.sin(t * 7.1 + f.age * 3) * 0.08 + (Math.random() - 0.5) * 0.25;
        desired.y += Math.sin(t * 5.3 + f.age) * 0.06 + (Math.random() - 0.5) * 0.2;
        desired.z += (Math.random() - 0.5) * 0.2;
        f.v.lerp(desired, 1 - Math.exp(-dt * (f.hover > 0 ? 6 : 3.2)));
        const prevZ = f.p.z;
        f.p.addScaledVector(f.v, dt);
        if (f.p.y < web.floorY + 0.05) f.v.y = Math.abs(f.v.y);
        // crossing the web plane: test the silk
        if (Math.abs(f.p.z) < 0.08 || Math.sign(prevZ) !== Math.sign(f.p.z)) {
          const hit = web.nearestC(f.p.x, f.p.y, f.p.z, 0.007, (1 << CAPTURE) | (1 << RADIAL) | (1 << MOOR));
          if (hit) {
            const k = web.kind[hit.c];
            const p = f.sure && k === CAPTURE ? 1 : k === CAPTURE ? 0.9 : k === RADIAL ? 0.22 : 0.08;
            if (Math.random() < p) {
              f.state = 'stuck';
              f.stuckC = hit.c;
              f.stuckT = hit.t;
              f.escape = CFG.flyEscape * (f.golden ? 0.7 : 1);
              web.impulse(hit.c, hit.t, f.v.x * 0.02, f.v.y * 0.02, f.v.z * 0.03);
              f.v.set(0, 0, 0);
              this.ev.onStick(f);
            } else {
              web.impulse(hit.c, hit.t, f.v.x * 0.01, f.v.y * 0.01, f.v.z * 0.02);
              web.hp[hit.c] -= 0.06;
              f.v.z *= -0.5;
              f.retarget = 0;
              this.ev.onBounce(f, hit.c);
            }
          }
        }
        if (f.leaving && f.p.length() > 3.2) f.state = 'gone';
      } else if (f.state === 'stuck') {
        if (!web.cAlive[f.stuckC]) {
          if (f.wrapped) {
            f.state = 'gone';
            continue;
          }
          f.state = 'fly';
          f.leaving = true;
          f.retarget = 0;
          this.ev.onEscape(f);
          continue;
        }
        web.pointOn(f.stuckC, f.stuckT, this.tmp);
        f.p.set(this.tmp.x, this.tmp.y, this.tmp.z + 0.003);
        if (f.wrapped) {
          f.animate(dt, t);
          continue;
        }
        f.nextBurst -= dt;
        if (f.nextBurst <= 0) {
          f.burst = rand(0.3, 0.7);
          f.nextBurst = rand(0.8, 2.2);
        }
        if (f.burst > 0) {
          f.burst -= dt;
          const s = 0.0012;
          web.impulse(f.stuckC, f.stuckT, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s * 1.5);
        }
        f.escape -= dt;
        if (f.escape <= 0) {
          web.hp[f.stuckC] = 0; // tears its way out
          f.state = 'fly';
          f.leaving = true;
          f.retarget = 0;
          f.v.set(0, 0.2, -0.4);
          this.ev.onEscape(f);
        }
      }
      f.animate(dt, t);
    }
    for (const f of this.flies) if (f.state === 'gone') this.group.remove(f.g);
    this.flies = this.flies.filter((f) => f.state !== 'gone');
  }

  /** A meal caught while you were away, hanging wrapped on the capture spiral. */
  parcel(web: Web) {
    for (let tries = 0; tries < 40; tries++) {
      const c = Math.floor(Math.random() * web.nC);
      if (!web.cAlive[c] || web.kind[c] !== CAPTURE) continue;
      const f = new Fly(this.env);
      f.wrap();
      f.state = 'stuck';
      f.stuckC = c;
      f.stuckT = 0.3 + Math.random() * 0.4;
      f.escape = Infinity;
      web.pointOn(c, f.stuckT, this.tmp);
      f.p.set(this.tmp.x, this.tmp.y, this.tmp.z);
      this.flies.push(f);
      this.group.add(f.g);
      return f;
    }
    return null;
  }

  alive() {
    return this.flies.filter((f) => (f.state === 'fly' || f.state === 'stuck') && !f.wrapped).length;
  }
}
