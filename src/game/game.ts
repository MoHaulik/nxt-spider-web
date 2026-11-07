// Gossamer: the whole piece. One system runs the beats, the spider, the silk, the flies and the weather.

import {
  Color,
  createSystem,
  Group,
  Matrix4,
  Mesh,
  Object3D,
  PlaneGeometry,
  Raycaster,
  Vector2,
  Vector3,
  VisibilityState,
  type World,
} from '@iwsdk/core';
import { Audio, note, type Voice } from './audio.js';
import { CFG, FLAGS } from './config.js';
import { type Fly, Swarm } from './flies.js';
import { Hands, type HandState } from './hands.js';
import { DropMesh, glowTexture, makeDimmer, pushBeads, SilkMesh, spriteMaterial, starTexture, sunDir, fillDir } from './render.js';
import { type Anchor, scanRoom } from './room.js';
import { Drips, makeEnvironment, makeLights, Rain, textCard } from './scenery.js';
import { Spider } from './spider.js';
import { CAPTURE, DRAG, MOOR, RADIAL, Web } from './web.js';

type Phase = 'idle' | 'placing' | 'intro' | 'swing' | 'frame' | 'spin' | 'firstfly' | 'eat' | 'free';
const SAVE_KEY = 'gossamer.v1';

type Save = {
  web: { P: number[]; C: number[] };
  food: number;
  eaten: number;
  ceilY: number;
  floorY: number;
  anchorId?: string;
  savedAt: number;
};

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const rand = (a: number, b: number) => a + Math.random() * (b - a);

function loadSave(): Save | null {
  if (FLAGS.fresh) return null;
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
    return s && s.web ? s : null;
  } catch {
    return null;
  }
}

export class Game {
  readonly root = new Group(); // the web frame
  private web = new Web();
  private silk: SilkMesh;
  private drops: DropMesh;
  private spider: Spider;
  private swarm: Swarm;
  hands = new Hands();
  audio = new Audio();
  private rain = new Rain();
  private drips = new Drips();
  private dimmer = makeDimmer();
  private glow: Mesh;
  private hint: Mesh;
  private halo: Mesh;
  private star: Mesh;
  private title = textCard([{ text: 'GOSSAMER', size: 120, spacing: 38 }]);
  private count = textCard([{ text: '', size: 90 }], 512, 256);

  phase: Phase = 'idle';
  private phaseT = 0;
  private clock = 0;
  private timeScale = 1;
  private slowmo = 0;
  private returning = false;
  private save: Save | null = loadSave();

  // spider motion (web frame)
  private S = new Vector3(0, 2, 0);
  private Sprev = new Vector3(0, 2, 0);
  private P = new Vector3(0, 2.3, 0);
  private T = new Vector3();
  private neutral = new Vector3();
  private needNeutral = true;
  private active: HandState | null = null;
  private travel = 0;
  private lastTx = 0;
  private controls = false;
  private twist = Math.PI;
  private food = 0;
  eaten = 0;
  private lastMeal = 0;

  // the room
  private ceilY = 1.3;
  private floorY = -1.1;
  private anchors: Anchor[] = [];
  private framed = false;
  private frameR = 0.27;

  // spinning
  private live: { start: number; last: number; head: number; c: number; ids: number[]; cs: number[]; len: number } | null = null;
  private threadsDone = 0;
  private attachTarget = -1;

  // weather
  private rainClock = CFG.firstRain;
  private raining = 0;
  private rainI = 0;

  private flyClock = 0;
  private voices = new Map<Fly, Voice>();
  private eatingList: { f: Fly; t: number; from: Vector3 }[] = [];
  private later: { t: number; fn: () => void }[] = [];
  private saveClock = 10;
  private hideClock = 0;

  // XR bookkeeping
  private frame: XRFrame | null = null;
  private ref: XRReferenceSpace | null = null;
  private anchor: XRAnchor | null = null;
  private wantAnchor = false;
  private wantScan = false;
  private restoreWait = 0;
  private paused = false;

  // desktop preview
  desktop = false;
  private mouse = new Vector2(0, 0);
  private mouseDown = false;
  private ray = new Raycaster();

  // scratch
  private head = new Vector3();
  private fwd = new Vector3();
  private up = new Vector3();
  private toLocal = new Matrix4();
  private v1 = new Vector3();
  private v2 = new Vector3();
  private v3 = new Vector3();
  private camLocal = new Vector3();

  constructor(private world: World) {
    const env = makeEnvironment(world.renderer);
    this.silk = new SilkMesh(this.web.MC + 32);
    this.drops = new DropMesh(7000);
    this.spider = new Spider(env, CFG.spiderLength);
    this.swarm = new Swarm(env, {
      onStick: (f) => this.onStick(f),
      onEscape: (f) => this.audio.pluck(note(3), 0.05, this.wpos(f.p)),
      onBounce: (f, c) => this.audio.pluck(note(8 + Math.floor(this.web.seed[c] * 5)), 0.05, this.wpos(f.p), 0.6),
    });
    this.web.onBreak = (_c, x, y, z) => this.audio.snap(this.wpos(this.v3.set(x, y, z)));

    const gt = glowTexture();
    const sprite = (tex = gt, color = new Color(1, 1, 1), order = 20) => {
      const m = new Mesh(new PlaneGeometry(1, 1), spriteMaterial(tex, color));
      m.renderOrder = order;
      m.frustumCulled = false;
      m.visible = false;
      return m;
    };
    this.glow = sprite(gt, new Color(1, 0.92, 0.75));
    this.hint = sprite(gt, new Color(0.95, 0.9, 0.8));
    this.halo = sprite(gt, new Color(1, 0.85, 0.55));
    this.star = sprite(starTexture(), new Color(1, 0.95, 0.88));

    this.root.add(this.silk.mesh, this.drops.mesh, this.spider.root, this.swarm.group, this.rain.mesh, this.glow, this.hint, this.halo, this.star, this.title.mesh, this.count.mesh);
    makeLights(this.root);
    this.root.visible = false;
    world.scene.add(this.root, this.dimmer);
    world.player.add(this.hands.occluder);
    this.dimmer.visible = false;

    world.onXRFrame((frame) => this.onXRFrame(frame));
    world.visibilityState.subscribe((v) => this.onVisibility(v));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.persist();
    });
  }

  // ---------------------------------------------------------------- lifecycle

  /** Enter the piece (after the click on the landing page, so audio may start). */
  begin(desktop: boolean) {
    this.desktop = desktop;
    this.audio.start();
    this.audio.startDrone();
    if (this.phase === 'idle') {
      this.phase = 'placing';
      this.phaseT = 0;
    }
    if (desktop) this.setupDesktop();
  }

  private onVisibility(v: VisibilityState) {
    if (v === VisibilityState.NonImmersive) {
      if (!this.desktop && this.phase !== 'idle') {
        this.persist();
        this.paused = true;
        this.audio.suspend();
      }
      return;
    }
    this.paused = v === VisibilityState.VisibleBlurred;
    if (this.paused) {
      this.persist();
      this.audio.suspend();
    } else {
      this.audio.start();
    }
    if (this.phase === 'idle' || this.desktop) {
      this.desktop = false;
      this.begin(false);
    }
  }

  private setupDesktop() {
    const canvas = this.world.renderer.domElement;
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    });
    canvas.addEventListener('pointerdown', () => (this.mouseDown = true));
    window.addEventListener('pointerup', () => (this.mouseDown = false));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'f') this.spawnFly(false);
      if (e.key === 'r') this.toggleRain();
      if (e.key === 'n') this.skip();
    });
  }

  toggleRain() {
    this.raining = this.raining > 0 ? 0 : CFG.rainLength;
  }

  skip() {
    const order: Phase[] = ['intro', 'swing', 'frame', 'spin', 'firstfly', 'eat', 'free'];
    const i = order.indexOf(this.phase);
    if (i >= 0 && i < order.length - 1) {
      if (this.phase === 'intro') this.arrive();
      this.go(order[i + 1]);
    }
  }

  private go(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
    if (p === 'swing') {
      this.controls = true;
      this.needNeutral = true;
      this.spider.wave = 1;
    }
    if (p === 'frame') {
      this.wantScan = true;
      if (this.desktop) this.buildFrame();
    }
    if (p === 'firstfly') this.spawnFly(true);
    if (p === 'free') {
      this.web.decayOn = true;
      this.flyClock = 3;
      if (FLAGS.rain) this.raining = CFG.rainLength;
    }
  }

  // ---------------------------------------------------------------- XR frame

  private onXRFrame(frame: XRFrame) {
    this.frame = frame;
    this.ref = this.world.renderer.xr.getReferenceSpace();
    if (!this.ref) return;
    this.hands.readXR(frame, this.ref, this.clock);
    const session = frame.session as XRSession & { restorePersistentAnchor?: (id: string) => Promise<XRAnchor>; deletePersistentAnchor?: (id: string) => Promise<void> };

    if (this.phase === 'placing') {
      if (this.restoreWait === 0) {
        this.restoreWait = 0.0001;
        if (this.save?.anchorId && session.restorePersistentAnchor) {
          session
            .restorePersistentAnchor(this.save.anchorId)
            .then((a) => (this.anchor = a))
            .catch(() => (this.restoreWait = 99));
        } else this.restoreWait = 99;
      }
    }
    if (this.anchor) {
      const pose = frame.getPose(this.anchor.anchorSpace, this.ref);
      if (pose) {
        const m = new Matrix4().fromArray(pose.transform.matrix).premultiply(this.world.player.matrixWorld);
        m.decompose(this.root.position, this.root.quaternion, this.v1);
        if (this.phase === 'placing') this.placed(true);
      }
    }
    if (this.wantAnchor && frame.createAnchor) {
      this.wantAnchor = false;
      const p = this.root.position, q = this.root.quaternion;
      frame
        .createAnchor(new XRRigidTransform({ x: p.x, y: p.y, z: p.z }, { x: q.x, y: q.y, z: q.z, w: q.w }), this.ref)
        ?.then(async (a) => {
          this.anchor = a;
          const old = this.save?.anchorId;
          const ah = a as XRAnchor & { requestPersistentHandle?: () => Promise<string> };
          if (ah.requestPersistentHandle) {
            const id = await ah.requestPersistentHandle();
            if (old && old !== id) session.deletePersistentAnchor?.(old).catch(() => {});
            this.anchorId = id;
            this.persist();
          }
        })
        .catch(() => {});
    }
    if (this.wantScan) {
      this.wantScan = false;
      this.scan(frame);
      if (this.phase === 'frame' && !this.framed) this.buildFrame();
    }
  }

  private anchorId?: string = this.save?.anchorId;

  // ---------------------------------------------------------------- placement & room

  private headPose() {
    const src = this.world.session ? this.world.player.head : this.world.camera;
    src.updateMatrixWorld();
    this.head.setFromMatrixPosition(src.matrixWorld);
    this.fwd.set(0, 0, -1).transformDirection(src.matrixWorld);
    this.up.set(0, 1, 0).transformDirection(src.matrixWorld);
  }

  private placeFresh() {
    this.headPose();
    const f = this.v1.set(this.fwd.x, 0, this.fwd.z);
    if (f.lengthSq() < 1e-4) f.set(0, 0, -1);
    f.normalize();
    this.root.position.copy(this.head).addScaledVector(f, CFG.webDistance);
    this.root.position.y -= CFG.webDrop;
    this.root.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(-f.x, -f.z));
  }

  private placed(fromAnchor: boolean) {
    this.headPose();
    if (fromAnchor && this.root.position.distanceTo(this.head) > 2.5) {
      // a different room: hang the web in front of you instead
      this.anchor = null;
      fromAnchor = false;
    }
    if (!fromAnchor) {
      this.placeFresh();
      if (!this.desktop) this.wantAnchor = true;
    }
    this.root.updateMatrixWorld(true);
    this.root.visible = true;
    this.dimmer.visible = true;
    this.returning = !!this.save;
    if (this.save) {
      const hours = (Date.now() - this.save.savedAt) / 3.6e6;
      this.web.restore(this.save.web, Math.max(0.4, 1 - hours * 0.08));
      this.food = this.save.food;
      this.eaten = this.save.eaten;
      this.ceilY = this.save.ceilY;
      this.floorY = this.save.floorY;
      this.web.floorY = this.floorY;
      this.framed = true;
      this.spider.size = this.sizeFor(this.food);
    } else {
      this.floorY = -this.root.position.y;
      this.web.floorY = this.floorY;
      this.ceilY = Math.max(1.15, 2.45 + this.floorY);
    }
    this.S.set(0, this.ceilY, 0);
    this.Sprev.copy(this.S);
    this.wantScan = !this.desktop && !this.returning;
    this.go('intro');
    if (this.desktop) {
      this.toggleDesktopBg(true);
      if (FLAGS.closeup) this.world.camera.position.lerp(this.root.position, 0.62);
    }
  }

  private toggleDesktopBg(on: boolean) {
    this.world.scene.background = on ? new Color(0.09, 0.075, 0.062) : null;
  }

  private scan(frame: XRFrame | null) {
    this.root.updateMatrixWorld(true);
    this.toLocal.copy(this.root.matrixWorld).invert();
    const floorLocal = -this.root.position.y;
    const room = scanRoom(frame, this.ref, this.toLocal.clone().multiply(this.world.player.matrixWorld), floorLocal);
    if (!this.framed) {
      this.ceilY = room.ceilY;
      this.floorY = room.floorY;
      this.web.floorY = this.floorY;
    }
    this.anchors = room.anchors;
    if (FLAGS.debug) console.log('[gossamer] room', room);
  }

  /** The frame: lines tied to your room, and a ring the player spins across. */
  private buildFrame() {
    if (this.framed) return;
    if (!this.anchors.length) this.scan(this.frame);
    this.framed = true;
    const w = this.web;
    const R0 = this.frameR;
    const list = [...this.anchors.map((a) => ({ pos: a.pos.clone(), angle: a.angle })), { pos: new Vector3(0, this.ceilY, 0), angle: Math.PI / 2 }];
    list.sort((a, b) => a.angle - b.angle);
    const ring: number[] = [];
    list.forEach((a, k) => {
      const delay = 0.2 + k * 0.42;
      const r = w.addP(Math.cos(a.angle) * R0, Math.sin(a.angle) * R0, 0, 1);
      const pin = w.addP(a.pos.x, a.pos.y, a.pos.z, 0);
      w.chain(r, pin, MOOR, CFG.baseThick * 1.3, 0.12, 0.96, delay, 0.035);
      ring.push(r);
      this.later.push({ t: this.clock + delay, fn: () => this.audio.pluck(note(5 + (k % 5)), 0.12, this.wpos(a.pos.clone().multiplyScalar(0.3)), 2.2) });
    });
    const d0 = 0.2 + list.length * 0.42;
    for (let k = 0; k < ring.length; k++) {
      w.chain(ring[k], ring[(k + 1) % ring.length], RADIAL, CFG.baseThick * 1.1, CFG.spacing, 0.975, d0 + k * 0.12, 0.02);
    }
    w.connectivity();
  }

  // ---------------------------------------------------------------- helpers

  private wpos(p: Vector3 | { x: number; y: number; z: number }): [number, number, number] {
    const v = this.v2.set(p.x, p.y, p.z).applyMatrix4(this.root.matrixWorld);
    return [v.x, v.y, v.z];
  }

  private sizeFor(food: number) {
    return 1 + CFG.growMax * (1 - Math.exp(-food / CFG.growK));
  }

  private get grow01() {
    return clamp((this.spider.size - 1) / CFG.growMax, 0, 1);
  }

  private persist() {
    if (!this.framed || this.desktop && !FLAGS.debug) return;
    if (this.phase === 'idle' || this.phase === 'placing' || this.phase === 'intro' && !this.returning) return;
    try {
      const s: Save = { web: this.web.serialize(), food: this.food, eaten: this.eaten, ceilY: this.ceilY, floorY: this.floorY, anchorId: this.anchorId, savedAt: Date.now() };
      localStorage.setItem(SAVE_KEY, JSON.stringify(s));
      this.save = s;
    } catch {}
  }

  static clearSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {}
  }

  static hasSave() {
    return !!loadSave();
  }

  // ---------------------------------------------------------------- per frame

  update(dtRaw: number) {
    if (this.phase === 'idle' || this.paused) return;
    const dt = Math.min(dtRaw, 1 / 30);
    this.clock += dt;
    this.phaseT += dt;
    if (this.slowmo > 0) this.slowmo -= dt;
    this.timeScale += ((this.slowmo > 0 ? 0.3 : 1) - this.timeScale) * (1 - Math.exp(-dt * 6));
    const sdt = dt * this.timeScale;

    for (const l of this.later.filter((l) => l.t <= this.clock)) l.fn();
    this.later = this.later.filter((l) => l.t > this.clock);

    if (this.phase === 'placing') {
      if (this.desktop) this.placed(false);
      else {
        if (this.restoreWait > 0) this.restoreWait += dt;
        if (this.restoreWait > 2.5 && !this.anchor) this.placed(false);
        if (this.restoreWait > 4) this.placed(false);
      }
      return;
    }

    this.hideInputVisuals(dt);
    this.headPose();
    this.root.updateMatrixWorld(true);
    this.toLocal.copy(this.root.matrixWorld).invert();
    this.camLocal.copy(this.head).applyMatrix4(this.toLocal);
    this.dimmer.position.copy(this.head);

    this.readHands();
    this.director(dt);
    this.moveSpider(sdt);
    this.spin(sdt);
    const n = sdt > 1 / 70 ? 2 : 1;
    for (let k = 0; k < n; k++) this.web.step(sdt / n);
    this.swarm.update(sdt, this.clock, this.web, this.bounds);
    this.feed(dt);
    this.weather(dt);
    this.draw(dt);
    this.sound();

    this.saveClock -= dt;
    if (this.saveClock <= 0) {
      this.saveClock = 15;
      this.persist();
    }
  }

  private hideInputVisuals(dt: number) {
    this.hideClock -= dt;
    if (this.hideClock > 0) return;
    this.hideClock = 0.5;
    this.world.player.traverse((o: Object3D) => {
      if (o === this.hands.occluder) return;
      if ((o as Mesh).isMesh || (o as unknown as { isLine?: boolean }).isLine) o.visible = false;
    });
  }

  private get bounds() {
    return CFG.boundsBase + (CFG.boundsMax - CFG.boundsBase) * this.grow01;
  }

  private readHands() {
    if (this.desktop) {
      this.ray.setFromCamera(this.mouse, this.world.camera);
      const o = this.v1.copy(this.ray.ray.origin).applyMatrix4(this.toLocal);
      const d = this.v2.copy(this.ray.ray.direction).transformDirection(this.toLocal);
      const t = -o.z / (d.z || -1e-6);
      const m = o.addScaledVector(d, t);
      const hp = this.v3.set(m.x / CFG.gainX, m.y / CFG.gainY, 0).applyMatrix4(this.root.matrixWorld);
      this.hands.setMouse(hp, this.mouseDown, this.clock);
      this.active = this.hands.right;
      this.neutral.set(0, 0, 0);
      this.needNeutral = false;
      return;
    }
    const L = this.hands.left, R = this.hands.right;
    let a = this.active;
    if (!a || !a.seen) a = R.seen ? R : L.seen ? L : null;
    if (a && L.seen && R.seen) {
      const other = a === L ? R : L;
      if (other.down && !this.live) a = other;
    }
    if (a !== this.active) this.needNeutral = true;
    this.active = a;
  }

  /** Your hand to the spider's target in the web plane. */
  private handLocal(h: HandState, out: Vector3) {
    return out.copy(h.pos).applyMatrix4(this.world.player.matrixWorld).applyMatrix4(this.toLocal);
  }

  private moveSpider(dt: number) {
    const S = this.S, P = this.P, T = this.T;
    const g01 = this.grow01;
    if (this.controls) {
      const h = this.active;
      if (h && h.seen) {
        const hl = this.handLocal(h, this.v1);
        if (this.needNeutral || this.clock - h.lastSeen > 0.5) {
          this.neutral.set(hl.x - T.x / CFG.gainX, hl.y - T.y / CFG.gainY, hl.z);
          this.needNeutral = false;
        }
        T.set((hl.x - this.neutral.x) * CFG.gainX, (hl.y - this.neutral.y) * CFG.gainY, clamp((hl.z - this.neutral.z) * CFG.gainZ, -0.07, 0.07));
        // keep the comfortable zone under the hand: if the target leaves the web, slide the neutral after it
        const b = this.bounds;
        const r = Math.hypot(T.x, T.y);
        if (r > b) {
          const k = (r - b) / r;
          this.neutral.x += (T.x * k) / CFG.gainX;
          this.neutral.y += (T.y * k) / CFG.gainY;
          T.x *= b / r;
          T.y *= b / r;
        }
        T.y = Math.max(T.y, this.floorY + 0.25);
        this.travel += Math.abs(T.x - this.lastTx);
        this.lastTx = T.x;
      } else this.needNeutral = true;

      const L = CFG.pendulum;
      const kP = 1 - Math.exp(-dt * (14 + g01 * 8));
      P.x += (T.x - P.x) * kP;
      P.y += (T.y + L - P.y) * kP;
      P.z += (T.z - P.z) * kP;
      const damp = Math.exp(-dt * (CFG.swingDamp + g01 * 1.2));
      const assist = CFG.assistBase + (CFG.assistMax - CFG.assistBase) * g01;
      const vx = (S.x - this.Sprev.x) * damp, vy = (S.y - this.Sprev.y) * damp, vz = (S.z - this.Sprev.z) * damp;
      this.Sprev.copy(S);
      const dd = dt * dt;
      S.x += vx + (T.x - S.x) * assist * dd;
      S.y += vy + ((T.y - S.y) * assist - 9.81 * CFG.spiderGravity) * dd;
      S.z += vz + (T.z - S.z) * assist * dd;
      const d = S.distanceTo(P);
      if (d > L) S.sub(P).multiplyScalar(L / d).add(P);
      if (this.phase !== 'swing' && this.phase !== 'frame') {
        const fixed = this.web.repair(S.x, S.y, S.z, CFG.repairRadius * this.spider.size, dt * 1.8);
        if (fixed && Math.random() < dt * 6) this.audio.pluck(note(10 + Math.floor(Math.random() * 5)), 0.012, this.wpos(S), 0.3);
      }
    }
    this.spider.size += (this.sizeFor(this.food) - this.spider.size) * (1 - Math.exp(-dt * 1.2));
    const up = this.v2.copy(P).sub(S);
    if (up.lengthSq() < 1e-6) up.set(0, 1, 0);
    const vel = this.v3.copy(S).sub(this.Sprev).divideScalar(Math.max(dt, 1e-4));
    this.spider.pose(S, up, this.camLocal.clone().sub(S), this.twist, vel, dt);
  }

  private spin(dt: number) {
    const canSpin = this.framed && ['spin', 'firstfly', 'eat', 'free'].includes(this.phase);
    const h = this.active;
    const w = this.web;
    const s = this.spider.local(this.spider.spinneret, this.v1);
    const thick = CFG.baseThick + (CFG.maxThick - CFG.baseThick) * this.grow01;
    const snapR = CFG.snapRadius * (0.8 + this.spider.size * 0.2);

    if (canSpin && h?.down && !this.live) {
      let start = w.nearestP(s.x, s.y, s.z, snapR);
      if (start < 0) start = w.addP(s.x, s.y, s.z, 1);
      const head = w.addP(s.x, s.y, s.z, 0);
      const c = w.addC(start, head, RADIAL, thick, 1);
      this.live = { start, last: start, head, c, ids: [start], cs: [c], len: 0 };
      this.audio.pluck(note(7), 0.05, this.wpos(s), 0.5);
    }
    const L = this.live;
    this.spider.spinning += ((L ? 1 : 0) - this.spider.spinning) * (1 - Math.exp(-dt * 8));
    if (!L) {
      this.attachTarget = -1;
      this.audio.spinHiss(0);
      return;
    }
    w.set(L.head, s.x, s.y, s.z);
    const d = w.dist(L.last, L.head);
    w.base[L.c] = w.rest[L.c] = d;
    if (d > CFG.spacing) {
      w.im[L.head] = 1;
      const k = L.head * 3;
      const v = this.v2.copy(this.S).sub(this.Sprev);
      w.o[k] = w.p[k] - v.x * 0.5;
      w.o[k + 1] = w.p[k + 1] - v.y * 0.5;
      w.o[k + 2] = w.p[k + 2] - v.z * 0.5;
      L.len += d;
      L.ids.push(L.head);
      L.last = L.head;
      L.head = w.addP(s.x, s.y, s.z, 0);
      L.c = w.addC(L.last, L.head, RADIAL, thick, 1);
      L.cs.push(L.c);
    }
    this.audio.spinHiss(this.v2.copy(this.S).sub(this.Sprev).length() / Math.max(dt, 1e-3) * 1.5);
    const skip = new Set([...L.ids, L.head]);
    this.attachTarget = w.nearestP(s.x, s.y, s.z, snapR, skip);
    const tooLong = L.len + d > CFG.maxThread * (0.8 + this.spider.size * 0.3);
    if (h?.up || !h?.seen || tooLong) this.release(skip);
  }

  private release(skip: Set<number>) {
    const L = this.live!;
    const w = this.web;
    this.live = null;
    const target = this.attachTarget;
    if (target >= 0 && target !== L.start && !skip.has(target)) {
      w.cb[L.c] = target;
      w.deg[L.head]--;
      w.deg[target]++;
      w.killP(L.head);
      for (const c of L.cs) {
        if (!w.cAlive[c]) continue;
        w.base[c] = w.dist(w.ca[c], w.cb[c]) * CFG.tension;
        w.glint[c] = 1;
      }
      L.ids.push(target);
      w.connectivity();
      this.threadsDone++;
      const len = L.len;
      this.audio.pluck(note(Math.round(12 - len * 8)), 0.16, this.wpos(w.pointOn(L.cs[0], 0.5, { x: 0, y: 0, z: 0 })), 2.4);
      this.layCapture(L.ids);
    } else {
      w.im[L.head] = 1; // a loose end: it dangles, and dissolves if nothing holds it
      w.connectivity();
      this.audio.pluck(note(2), 0.04, this.wpos(this.S), 0.4);
    }
  }

  /**
   * The sticky spiral breathes in. Like a real orb-weaver's capture spiral, each new rung joins a point
   * on the new thread to the point on its angular neighbour at the same distance from the hub, so the
   * rungs line up into rings.
   */
  private layCapture(ids: number[]) {
    const w = this.web, p = w.p;
    if (ids.length < 3) return;
    const self = new Set(ids);
    const hubR = 0.035, outerR = this.frameR + 0.02;
    const used = new Set<number>();
    const rungs: [number, number][] = [];
    const ang = (i: number) => Math.atan2(p[i * 3 + 1], p[i * 3]);
    const rad = (i: number) => Math.hypot(p[i * 3], p[i * 3 + 1]);
    for (let k = 1; k < ids.length - 1; k++) {
      const i = ids[k];
      const ri = rad(i);
      if (ri < hubR || ri > outerR) continue;
      const ai = ang(i);
      const best: [number, number] = [-1, -1];
      const bd = [Infinity, Infinity];
      for (let j = 0; j < w.nP; j++) {
        if (!w.pAlive[j] || !w.anchored[j] || w.im[j] === 0 || self.has(j) || used.has(j)) continue;
        const rj = rad(j);
        if (Math.abs(rj - ri) > CFG.spacing * 0.7 || rj < hubR) continue;
        const da = Math.atan2(Math.sin(ang(j) - ai), Math.cos(ang(j) - ai));
        const ad = Math.abs(da);
        if (ad < 0.12 || ad > 1.35) continue;
        const d = Math.hypot(p[j * 3] - p[i * 3], p[j * 3 + 1] - p[i * 3 + 1]);
        if (d < CFG.rungMin || d > CFG.rungMax) continue;
        const side = da > 0 ? 0 : 1;
        const score = ad + Math.abs(rj - ri) * 4;
        if (score < bd[side]) {
          bd[side] = score;
          best[side] = j;
        }
      }
      for (const j of best) if (j >= 0) {
        used.add(j);
        rungs.push([i, j]);
      }
    }
    // lay them from the outside in, as a spider does
    rungs.sort((a, b) => rad(b[0]) - rad(a[0]));
    const thick = (CFG.baseThick + (CFG.maxThick - CFG.baseThick) * this.grow01) * 0.85;
    rungs.forEach(([i, j], k) => {
      const delay = 0.35 + k * 0.07;
      w.addC(i, j, CAPTURE, thick, 0.985, delay);
      if (k % 2 === 0) this.later.push({ t: this.clock + delay, fn: () => this.audio.pluck(note(14 - (k % 9)), 0.025, this.wpos({ x: p[i * 3], y: p[i * 3 + 1], z: p[i * 3 + 2] }), 0.9) });
    });
  }

  // ---------------------------------------------------------------- the beats

  private director(dt: number) {
    const t = this.phaseT;
    const fast = FLAGS.fast ? 0.35 : 1;
    const dim = this.dimmer.material as unknown as { uniforms: Record<string, { value: unknown }> };
    const fwdW = this.v1.copy(this.root.position).sub(this.head).normalize();
    (dim.uniforms.uFwd.value as Vector3).copy(fwdW);
    const amt = dim.uniforms.uAmount as { value: number };
    const target = (this.phase === 'intro' ? smooth(0, 3 * fast, t) : 1) * (0.62 + this.rainI * 0.12);
    amt.value += (target - amt.value) * (1 - Math.exp(-dt * 2));

    this.spider.wave = Math.max(0, this.spider.wave - dt * 0.45);

    if (this.phase === 'intro') {
      const ret = this.returning;
      const T0 = ret ? 0 : 1.5 * fast, T1 = ret ? 0 : 7.5 * fast; // title
      const G0 = ret ? 1 : 8 * fast; // glint
      const D0 = ret ? 2 : 9.5 * fast, D1 = D0 + (ret ? 5 : 10 * fast); // descent
      if (!ret) {
        this.title.mesh.position.set(0, 0.16, -0.25);
        this.title.mesh.scale.setScalar(0.085);
        this.title.mesh.quaternion.identity();
        this.title.set(smooth(T0, T0 + 2, t) * (1 - smooth(T1, T1 + 2, t)));
      }
      // the glint: something catches the light up at the ceiling
      this.star.visible = t > G0 && t < D0 + 3;
      this.star.position.set(0, this.ceilY - 0.02, 0);
      this.star.scale.setScalar(0.12 * smooth(G0, G0 + 0.5, t) * (1 - smooth(D0 + 1, D0 + 3, t)) + 0.0001);
      if (t - dt < G0 && t >= G0) this.audio.chime(note(12), 0.08, this.wpos(this.star.position));
      if (t - dt < D0 && t >= D0) this.audio.startSwell(D1 - D0);
      // the descent: perfectly straight, easing down with the small pauses a real spider makes
      const k = clamp((t - D0) / (D1 - D0), 0, 1);
      const stepped = k + Math.sin(k * Math.PI * 6) * 0.018 * (1 - k);
      const e = 1 - Math.pow(1 - smooth(0, 1, stepped), 1.6);
      this.S.set(0, this.ceilY + (0 - this.ceilY) * e, 0);
      this.Sprev.copy(this.S);
      this.P.set(0, this.S.y + CFG.pendulum, 0);
      this.T.set(0, 0, 0);
      this.twist = Math.PI * (1 - smooth(0.55, 1.0, k));
      this.spider.unfold = smooth(D1 - 1.2, D1 + 0.8, t);
      if (t >= D1 + 0.8) {
        this.arrive();
        this.go(this.returning ? 'free' : 'swing');
      }
      return;
    }
    this.title.set(0);
    this.star.visible = false;

    // the hint light: a small soft point that shows where your hand goes
    let hintOn = false;
    if (this.phase === 'swing') {
      const h = this.active;
      const idle = !h || !h.seen || t > 6;
      if (idle && !this.desktop) {
        hintOn = true;
        const s = Math.sin(this.clock * 1.6);
        this.hint.position.set(s * 0.2, -0.1, 0.42);
        this.hint.scale.setScalar(0.035);
      }
      if (this.travel > 1.6 && t > 4) this.go('frame');
    }
    if (this.phase === 'frame' && t > 4.2) this.go('spin');
    if (this.phase === 'spin') {
      if (this.threadsDone === 0 && t > 3 && !this.live) {
        // breathe the nearest ring point so you see where silk can start
        const s = this.spider.local(this.spider.spinneret, this.v2);
        const n = this.web.nearestP(s.x, s.y, s.z, 0.3);
        if (n >= 0) {
          hintOn = true;
          this.hint.position.set(this.web.p[n * 3], this.web.p[n * 3 + 1], this.web.p[n * 3 + 2] + 0.004);
          this.hint.scale.setScalar(0.02 + Math.sin(this.clock * 4) * 0.008);
        }
      }
      if ((this.threadsDone >= 3 || this.web.totalLength(CAPTURE) > 0.6) && t > 2 && !this.live) this.go('firstfly');
    }
    if (this.phase === 'firstfly' && t > 28 && !this.swarm.flies.some((f) => f.state === 'stuck')) {
      this.spawnFly(true);
      this.phaseT = 0;
    }
    this.hint.visible = hintOn;
    (this.hint.material as unknown as { uniforms: { uOpacity: { value: number } } }).uniforms.uOpacity.value = 0.6 + Math.sin(this.clock * 3) * 0.25;

    if (this.phase === 'free') {
      this.flyClock -= dt;
      const maxFlies = Math.min(6, 2 + Math.floor(this.eaten / 4));
      if (this.flyClock <= 0) {
        this.flyClock = rand(...CFG.flyInterval) / (1 + Math.min(1.5, this.web.totalLength(CAPTURE) * 0.25));
        if (this.swarm.alive() < maxFlies) this.spawnFly(false, this.eaten >= 5 && Math.random() < 0.08);
      }
      if (this.clock - this.lastMeal > 60) this.food = Math.max(0, this.food - dt * CFG.hunger * 10);
    }
  }

  private arrive() {
    this.S.set(0, 0, 0);
    this.Sprev.set(0, 0.012, 0); // a small bounce on the dragline
    this.P.set(0, CFG.pendulum, 0);
    this.twist = 0;
    this.spider.unfold = 1;
    this.controls = true;
    this.audio.resolveSwell();
  }

  private spawnFly(sure: boolean, golden = false) {
    const f = this.swarm.spawn({ sure, golden });
    const v = this.audio.buzz();
    if (v) this.voices.set(f, v);
  }

  private onStick(f: Fly) {
    this.audio.pluck(note(4), 0.14, this.wpos(f.p), 1.8);
    if (this.phase === 'firstfly') this.go('eat');
  }

  private feed(dt: number) {
    const mouth = this.spider.local(this.spider.mouth, this.v1);
    let near = false;
    const r = CFG.eatRadius * (0.7 + this.spider.size * 0.3);
    for (const f of this.swarm.flies) {
      if (f.state !== 'stuck') continue;
      const d = Math.min(f.p.distanceTo(this.S), f.p.distanceTo(mouth));
      if (d < r) {
        near = true;
        f.eatT += dt;
        f.escape += dt; // held, it cannot tear free
        if (f.eatT > CFG.eatHold) this.eat(f);
      } else f.eatT = Math.max(0, f.eatT - dt);
    }
    this.spider.eating += ((near || this.eatingList.length ? 1 : 0) - this.spider.eating) * (1 - Math.exp(-dt * 6));
    for (const e of this.eatingList) {
      e.t += dt;
      const k = smooth(0, 0.9, e.t);
      const m = this.spider.local(this.spider.mouth, this.v2);
      e.f.g.position.lerpVectors(e.from, m, k);
      e.f.g.scale.setScalar(CFG.flyLength * (1 - k * 0.9));
      if (e.t > 1) {
        e.f.state = 'gone';
        this.swarm.group.remove(e.f.g);
      }
    }
    this.eatingList = this.eatingList.filter((e) => e.t <= 1);
  }

  private eat(f: Fly) {
    f.state = 'eaten';
    this.swarm.flies = this.swarm.flies.filter((x) => x !== f);
    this.eatingList.push({ f, t: 0, from: f.p.clone() });
    this.voices.get(f)?.stop();
    this.voices.delete(f);
    const first = this.eaten === 0;
    this.food += f.golden ? 3 : 1;
    this.eaten++;
    this.lastMeal = this.clock;
    if (this.web.cAlive[f.stuckC]) this.web.hp[f.stuckC] = 1;
    this.audio.chord(first ? [0, 4, 7, 9] : [2, 4, 7], first ? 0.1 : 0.06, first ? 5 : 3);
    if (first) {
      this.slowmo = 1.4;
      this.audio.chord([5, 9, 12, 14], 0.08, 6, 0.9);
    }
    // the tally: a small number that fades
    const c = this.count;
    c.mesh.removeFromParent();
    this.count = textCard([{ text: String(this.eaten), size: 110 }], 512, 256);
    this.count.mesh.position.set(0, -this.bounds - 0.06, 0.02);
    this.count.mesh.scale.setScalar(0.07);
    this.root.add(this.count.mesh);
    this.countT = 0;
    this.web.glint.fill(0.6);
    this.persist();
    if (this.phase === 'eat') this.go('free');
  }
  private countT = 9;

  private weather(dt: number) {
    if (this.phase === 'free' && this.raining <= 0) {
      this.rainClock -= dt;
      if (this.rainClock <= 0) {
        this.raining = CFG.rainLength;
        this.rainClock = rand(...CFG.rainGap);
      }
    }
    if (this.raining > 0) this.raining -= dt;
    const want = this.raining > 0 ? smooth(0, 6, CFG.rainLength - this.raining) * smooth(0, 6, this.raining) : 0;
    this.rainI += (want - this.rainI) * (1 - Math.exp(-dt * 1.5));
    this.rain.intensity = this.rainI;
    this.rain.update(dt, this.floorY);
    this.audio.rain(this.rainI);
    const w = this.web;
    for (let c = 0; c < w.nC; c++) {
      if (!w.cAlive[c]) continue;
      if (this.rainI > 0.02) w.cwet[c] = Math.min(1, w.cwet[c] + dt * 0.035 * this.rainI * (0.4 + w.seed[c] * 1.2));
      else w.cwet[c] = Math.max(0, w.cwet[c] - dt * 0.005);
    }
    // soaked threads let drops go
    for (let k = 0; k < 12; k++) {
      const c = Math.floor(Math.random() * w.nC);
      if (!w.cAlive[c] || w.cwet[c] < 0.6 || Math.random() > 0.3) continue;
      const i = w.p[w.ca[c] * 3 + 1] < w.p[w.cb[c] * 3 + 1] ? w.ca[c] : w.cb[c];
      this.drips.spawn(w.p[i * 3], w.p[i * 3 + 1] - 0.003, w.p[i * 3 + 2], 0.0016 + Math.random() * 0.0012);
      w.cwet[c] -= 0.08;
    }
    if (this.rainI > 0.1 && Math.random() < dt * 9 * this.rainI) {
      const c = Math.floor(Math.random() * w.nC);
      if (w.cAlive[c]) this.audio.tick(this.wpos(w.pointOn(c, Math.random(), { x: 0, y: 0, z: 0 })), 0.012 + Math.random() * 0.02);
    }
  }

  // ---------------------------------------------------------------- drawing & sound

  private draw(dt: number) {
    const w = this.web;
    const thickScale = 1;
    const sunW = this.v1.copy(sunDir).applyQuaternion(this.root.quaternion);
    this.silk.uniforms.uSun.value.copy(sunW);
    this.drops.uniforms.uSun.value.copy(sunW);
    this.drops.uniforms.uFill.value.copy(fillDir).applyQuaternion(this.root.quaternion);

    this.silk.begin();
    this.silk.pushWeb(w, thickScale);
    // the dragline: from the spinnerets up to the ceiling
    const s = this.spider.local(this.spider.spinneret, this.v2);
    const dir = this.v3.copy(this.P).sub(this.S).normalize();
    if (dir.y < 0.25) dir.y = 0.25;
    dir.normalize();
    const reach = (this.ceilY - s.y) / dir.y;
    const dthick = CFG.baseThick * (0.9 + this.grow01 * 0.8);
    if (this.phase !== 'placing') this.silk.push(s.x, s.y, s.z, s.x + dir.x * reach, s.y + dir.y * reach, s.z + dir.z * reach, dthick, 1, DRAG + 0.3, 1, 0);
    this.silk.end();

    this.drops.begin();
    pushBeads(w, this.drops, 1 + this.grow01 * 0.4);
    this.drips.update(dt, this.floorY, (x, y, z, r) => this.drops.push(x, y, z, r));
    this.drops.end();

    // where the silk will catch when you let go
    const at = this.attachTarget;
    this.glow.visible = at >= 0;
    if (at >= 0) {
      this.glow.position.set(w.p[at * 3], w.p[at * 3 + 1], w.p[at * 3 + 2] + 0.003);
      this.glow.scale.setScalar(0.022 + Math.sin(this.clock * 9) * 0.004);
    }
    // a fly in the web, waiting
    const stuck = this.swarm.flies.find((f) => f.state === 'stuck');
    this.halo.visible = !!stuck && (this.phase === 'eat' || this.eaten < 3);
    if (stuck) {
      this.halo.position.copy(stuck.p);
      this.halo.position.z += 0.004;
      this.halo.scale.setScalar(0.05 + Math.sin(this.clock * 3) * 0.01);
    }
    this.countT += dt;
    this.count.set(smooth(0, 0.5, this.countT) * (1 - smooth(2.5, 4, this.countT)));
  }

  private sound() {
    this.audio.listener(this.head.x, this.head.y, this.head.z, this.fwd.x, this.fwd.y, this.fwd.z, this.up.x, this.up.y, this.up.z);
    for (const [f, v] of this.voices) {
      if (f.state === 'gone') {
        v.stop();
        this.voices.delete(f);
        continue;
      }
      const pw = this.wpos(f.p);
      v.pos(...pw);
      const lvl = f.state === 'fly' ? 0.32 : f.state === 'stuck' ? (f.burst > 0 ? 0.42 : 0.03) : 0;
      v.level(lvl);
      const vw = this.v2.copy(f.v).applyQuaternion(this.root.quaternion);
      const toMe = this.v3.set(pw[0], pw[1], pw[2]).sub(this.head).normalize();
      v.pitch(1 - vw.dot(toMe) * 0.14 + (f.state === 'stuck' ? 0.12 : 0));
    }
  }
}

export class GossamerSystem extends createSystem({}) {
  static game: Game | null = null;
  private game!: Game;
  init() {
    this.game = new Game(this.world);
    GossamerSystem.game = this.game;
    (window as unknown as { __G: Game }).__G = this.game;
  }
  update(delta: number) {
    this.game.update(delta);
  }
}

