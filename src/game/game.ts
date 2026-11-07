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
import { OneEuro3 } from './filter.js';
import { Hands, type HandState } from './hands.js';
import { sunCol, DropMesh, glowTexture, makeDimmer, pushBeads, SilkMesh, spriteMaterial, starTexture, sunDir, fillDir } from './render.js';
import { type Anchor, scanRoom } from './room.js';
import { Brood, type ColonySave, type SacSave } from './brood.js';
import { Drips, makeEnvironment, makeLights, Rain } from './scenery.js';
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
  colonies?: ColonySave[];
  sacs?: SacSave[];
  parcels?: number;
  gravid?: number;
  savedAt: number;
  born?: number;
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
  private brood: Brood;
  private colonyWet = 0;
  private laying = 0;
  private dimmer = makeDimmer();
  private glow: Mesh;
  private hint: Mesh;
  private hint2: Mesh;
  private halo: Mesh;
  private star: Mesh;

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
  private live: { start: number; last: number; head: number; c: number; ids: number[]; cs: number[]; len: number; at: number; tap: boolean; lost: number } | null = null;
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
  private tuned = false;

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
    this.silk = new SilkMesh(this.web.MC + 9000);
    this.drops = new DropMesh(4500);
    this.spider = new Spider(env, CFG.spiderLength);
    this.swarm = new Swarm(env, {
      onStick: (f) => this.onStick(f),
      onEscape: (f) => this.audio.pluck(note(3), 0.05, this.wpos(f.p)),
      onBounce: (f, c) => this.audio.pluck(note(8 + Math.floor(this.web.seed[c] * 5)), 0.05, this.wpos(f.p), 0.6),
    });
    this.brood = new Brood(env);
    this.brood.onHatch = (p) => {
      this.audio.chord([10, 12, 14, 17], 0.05, 5);
      for (let k = 0; k < 6; k++) this.later.push({ t: this.clock + k * 0.18, fn: () => this.audio.pluck(note(15 + k), 0.03, this.wpos(p), 1.2) });
    };
    this.brood.onArrive = (p) => this.audio.pluck(note(16 + Math.floor(Math.random() * 4)), 0.02, this.wpos(p), 0.8);
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
    const sparkMat = spriteMaterial(gt, new Color(1, 0.96, 0.88));
    for (let k = 0; k < 24; k++) {
      const m = new Mesh(new PlaneGeometry(1, 1), sparkMat);
      m.renderOrder = 21;
      m.frustumCulled = false;
      m.visible = false;
      this.root.add(m);
      this.sparks.push({ m, life: 0, max: 1, size: 0.01 });
    }
    this.hint = sprite(gt, new Color(0.95, 0.9, 0.8));
    this.hint2 = sprite(gt, new Color(0.95, 0.9, 0.8));
    this.halo = sprite(gt, new Color(1, 0.85, 0.55));
    this.star = sprite(starTexture(), new Color(1, 0.95, 0.88));

    this.root.add(this.silk.mesh, this.drops.mesh, this.spider.root, this.swarm.group, this.brood.group, this.rain.mesh, this.glow, this.hint, this.hint2, this.halo, this.star);
    this.lights = makeLights(this.root);
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
    const session = this.world.session as (XRSession & { updateTargetFrameRate?: (r: number) => Promise<void>; supportedFrameRates?: Float32Array }) | undefined;
    if (session && !this.tuned) {
      this.tuned = true;
      // fine silk needs full resolution where you look; the periphery can be cheaper
      this.world.renderer.xr.setFoveation(0.35);
      const rates = session.supportedFrameRates ? [...session.supportedFrameRates] : [];
      if (rates.includes(72)) session.updateTargetFrameRate?.(72).catch(() => {});
    }
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
      if (e.key === 'e') this.laySac();
      if (e.key === 'h') this.brood.hatchAll();
    });
  }

  toggleRain() {
    this.raining = this.raining > 0 ? 0.01 : CFG.rainLength; // ending it lets the sun come back
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
      this.spider.wave = 1;
      if (this.desktop) this.buildFrame();
      else this.wantScan = true;
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
      this.gravid = this.save.gravid ?? 0;
      this.eaten = this.save.eaten;
      this.ceilY = this.save.ceilY;
      this.floorY = this.save.floorY;
      this.web.floorY = this.floorY;
      this.framed = true;
      this.spider.size = this.sizeFor(this.food);
      this.awayFor(hours);
      this.reserve = this.silkCap;
      if (this.gravid >= 1) this.chooseNest();
    } else {
      this.floorY = -this.root.position.y;
      this.web.floorY = this.floorY;
      this.ceilY = Math.max(1.15, 2.45 + this.floorY);
    }
    this.S.set(0, this.ceilY, 0);
    this.Sprev.copy(this.S);
    this.timeOfDay();
    this.wantScan = !this.desktop;
    if (this.desktop) this.scan(null);
    this.go('intro');
    if (!this.desktop) this.world.scene.background = null; // passthrough: nothing behind the room
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
    let room;
    try {
      room = scanRoom(frame, this.ref, this.toLocal.clone().multiply(this.world.player.matrixWorld), floorLocal);
    } catch (e) {
      console.warn('[gossamer] room scan failed, using the floor', e);
      room = scanRoom(null, null, this.toLocal, floorLocal);
    }
    if (!this.framed) {
      this.ceilY = room.ceilY;
      this.floorY = room.floorY;
      this.web.floorY = this.floorY;
    }
    this.anchors = room.anchors;
    this.brood.sites = room.sites;
    if (FLAGS.debug) console.log('[gossamer] room', room);
  }

  /** The frame: lines tied to your room, and a ring the player spins across. */
  private buildFrame() {
    if (this.framed) return;
    if (!this.anchors.length) this.scan(null);
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
      const s: Save = { web: this.web.serialize(), food: this.food, eaten: this.eaten, ceilY: this.ceilY, floorY: this.floorY, anchorId: this.anchorId, savedAt: Date.now(), born: this.save?.born ?? Date.now(),
        ...this.brood.save(), gravid: this.gravid, parcels: this.swarm.flies.filter((f) => f.wrapped).length };
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

  /** The one line on the landing page: the chapter of the story you are in. */
  static chapter() {
    const s = loadSave();
    if (!s) return 'Build a home.';
    const families = s.colonies?.length ?? 0;
    if (families >= 4) return 'Fill the room.';
    if (families >= 1) return 'Let them go.';
    if ((s.sacs?.length ?? 0) > 0 || (s.gravid ?? 0) >= 1) return 'Grow a family.';
    return 'Maintain a web.';
  }

  // ---------------------------------------------------------------- per frame

  update(dtRaw: number) {
    try {
      this.step(dtRaw);
    } catch (e) {
      if (!this.errored) console.error('[gossamer]', e);
      this.errored = true;
    }
  }
  private errored = false;

  private step(dtRaw: number) {
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
    this.economy(dt);
    this.laySpiral(sdt);
    this.nesting(sdt);
    this.touch(dt);
    this.colonyFlies();
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
    this.hideClock = 0.1;
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
      this.hands.right.engaged = true;
      this.active = this.hands.right;
      this.tap = this.hands.right.down ? this.hands.right : null;
      this.neutral.set(0, 0, 0);
      this.needNeutral = false;
      return;
    }
    const L = this.hands.left, R = this.hands.right;
    // only a hand raised in front of you takes part; a hand resting in your lap is resting
    const fh = this.v2.set(this.fwd.x, 0, this.fwd.z);
    if (fh.lengthSq() < 1e-4) fh.set(0, 0, -1);
    fh.normalize();
    for (const h of [L, R]) {
      if (!h.seen) {
        h.engaged = false;
        continue;
      }
      const w = this.v3.copy(h.pos).applyMatrix4(this.world.player.matrixWorld).sub(this.head);
      const f = w.dot(fh), y = w.y;
      h.engaged = h.engaged ? f > 0.07 && y > -0.68 : f > 0.12 && y > -0.6;
    }
    // the steering hand is sticky; the other hand's taps spin without taking the spider away
    let a = this.active && this.active.engaged ? this.active : R.engaged ? R : L.engaged ? L : null;
    if (a !== this.active) {
      this.needNeutral = true;
      this.handFilter.reset();
      if (a && this.clock - this.lastEngaged > 3 && this.phase !== 'intro') this.spider.wave = Math.max(this.spider.wave, 0.45); // it greets your hand
    }
    if (a) this.lastEngaged = this.clock;
    this.active = a;
    this.tap = L.engaged && L.down ? L : R.engaged && R.down ? R : null;
  }
  private tap: HandState | null = null;
  private spinHand: HandState | null = null;
  private lastEngaged = -10;
  private handFilter = new OneEuro3(1.1, 2.4, 1.0);
  private overT = 0;

  /** Your hand to the spider's target in the web plane. */
  private handLocal(h: HandState, out: Vector3) {
    return out.copy(h.pos).applyMatrix4(this.world.player.matrixWorld).applyMatrix4(this.toLocal);
  }

  private moveSpider(dt: number) {
    const S = this.S, P = this.P, T = this.T;
    const g01 = this.grow01;
    if (this.controls) {
      const h = this.active;
      let hl: Vector3 | null = null;
      if (h && h.engaged) {
        hl = this.handFilter.filter(this.handLocal(h, this.v1), dt, this.v1);
        const sp = hl.distanceTo(this.lastHand) / Math.max(dt, 1e-3);
        this.lastHand.copy(hl);
        this.handMotion += (Math.min(sp, 2) - this.handMotion) * (1 - Math.exp(-dt * 4));
      }
      this.stillT = !hl || this.handMotion < 0.035 ? this.stillT + dt : 0;
      const goal = this.autoTarget();
      this.auto = !!goal && this.stillT > CFG.idleTakeover;
      if (this.auto && goal) {
        // your hand rests: the spider goes about its own business, calmly
        T.lerp(goal, 1 - Math.exp(-dt * 1.4));
        this.needNeutral = true;
      } else if (hl) {
        if (this.needNeutral) {
          this.neutral.set(hl.x - T.x / CFG.gainX, hl.y - T.y / CFG.gainY, hl.z);
          this.needNeutral = false;
        }
        T.set((hl.x - this.neutral.x) * CFG.gainX, (hl.y - this.neutral.y) * CFG.gainY, clamp((hl.z - this.neutral.z) * CFG.gainZ, -0.07, 0.07));
        // the edge of the web gives like a rubber band: more and more resistance, and back it glides.
        // Held out there, the comfortable zone slowly follows your hand.
        const b = this.bounds;
        const r = Math.hypot(T.x, T.y);
        if (r > b) {
          const ex = r - b;
          const soft = b + ex / (1 + ex * 9);
          const rx = T.x, ry = T.y;
          T.x *= soft / r;
          T.y *= soft / r;
          this.overT += dt;
          if (this.overT > 1.2) {
            const k = Math.min(1, dt * 1.5);
            this.neutral.x += ((rx - T.x) / CFG.gainX) * k;
            this.neutral.y += ((ry - T.y) / CFG.gainY) * k;
          }
        } else this.overT = 0;
        T.y = Math.max(T.y, this.floorY + 0.25);
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

  /**
   * Spinning. A tap starts a thread at the spider; swing, and the next tap ties it off. Holding the pinch
   * works too: letting go ties it off. Every pinch does something you can see and hear.
   */
  private spin(dt: number) {
    const canSpin = this.framed && this.controls && ['frame', 'spin', 'firstfly', 'eat', 'free'].includes(this.phase);
    const tap = this.tap;
    const w = this.web;
    const s = this.spider.local(this.spider.spinneret, this.v1);
    const thick = CFG.baseThick + (CFG.maxThick - CFG.baseThick) * this.grow01;
    const reach = CFG.attachReach * (0.85 + this.spider.size * 0.15);

    if (tap && !canSpin && this.controls) this.audio.pluck(note(5), 0.03, this.wpos(s), 0.4);
    if (canSpin && tap && !this.live) {
      // at a caught fly, a tap is a turn of silk around it
      const prey = this.preyNear();
      if (prey && !prey.wrapped) {
        prey.setWrap(prey.wrapT + 0.3);
        this.reserve = Math.max(0, this.reserve - 0.03);
        this.audio.pluck(note(9 + Math.floor(prey.wrapT * 5)), 0.05, this.wpos(prey.p), 0.6);
        return;
      }
      if (this.reserve < 0.06) {
        // nothing left to spin: a dry little sound, and the abdomen shows why
        this.audio.pluck(note(0), 0.025, this.wpos(s), 0.25);
        return;
      }
      let start = w.nearestP(s.x, s.y, s.z, reach);
      if (start < 0) start = w.addP(s.x, s.y, s.z, 1);
      const head = w.addP(s.x, s.y, s.z, 0);
      const c = w.addC(start, head, RADIAL, thick, 1);
      this.live = { start, last: start, head, c, ids: [start], cs: [c], len: 0, at: this.clock, tap: false, lost: 0 };
      this.spinHand = tap;
      this.pulse(w.p[start * 3], w.p[start * 3 + 1], w.p[start * 3 + 2], 0.018, 0.35); // where the thread begins
      this.audio.pluck(note(7), 0.09, this.wpos(s), 0.8);
      w.glint[c] = 1;
      return;
    }
    const L = this.live;
    this.laying = Math.max(0, this.laying - dt);
    this.spider.spinning += ((L || this.laying > 0 ? 1 : 0) - this.spider.spinning) * (1 - Math.exp(-dt * 8));
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
      this.reserve -= d;
      if (this.reserve <= 0) {
        this.reserve = 0;
        return this.release(new Set([...L.ids, L.head]));
      }
    }
    this.audio.spinHiss(this.v2.copy(this.S).sub(this.Sprev).length() / Math.max(dt, 1e-3) * 1.5);
    const skip = new Set([...L.ids, L.head]);
    this.attachTarget = w.nearestP(s.x, s.y, s.z, reach, skip);
    if (this.attachTarget === L.start) this.attachTarget = -1;

    // a quick pinch-and-release is a tap: keep spinning until the next tap
    for (const c of L.cs) if (w.cAlive[c]) w.glint[c] = Math.max(w.glint[c], 0.4); // the thread being made glows faintly
    const sh = this.spinHand;
    if (sh?.up && !L.tap) {
      if (this.clock - L.at < 0.4) L.tap = true;
      else return this.release(skip);
    } else if (tap && L.tap) return this.release(skip);
    L.lost = sh?.seen ? 0 : L.lost + dt;
    const tooLong = L.len + d > CFG.maxThread * (0.8 + this.spider.size * 0.3);
    if (tooLong || L.lost > 1.5) this.release(skip);
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
      L.ids.push(target);
      const done = this.tauten(L.ids, L.cs);
      w.connectivity();
      this.lightAlong(done);
      this.pulse(w.p[target * 3], w.p[target * 3 + 1], w.p[target * 3 + 2], 0.02, 0.4);
      this.threadsDone++;
      const len = L.len;
      this.audio.pluck(note(Math.round(12 - len * 8)), 0.16, this.wpos(this.S), 2.4);
      this.layCapture(done);
    } else {
      w.im[L.head] = 1; // a loose end: it dangles, and dissolves if nothing holds it
      w.connectivity();
      this.audio.pluck(note(2), 0.04, this.wpos(this.S), 0.4);
    }
  }

  /** Light runs along a new thread from where it began to where it was tied: the silk drawn taut. */
  private lightAlong(ids: number[]) {
    const w = this.web;
    const order = new Map<number, number>();
    ids.forEach((id, k) => order.set(id, k));
    for (let c = 0; c < w.nC; c++) {
      if (!w.cAlive[c]) continue;
      const a = order.get(w.ca[c]), b = order.get(w.cb[c]);
      if (a === undefined || b === undefined || Math.abs(a - b) !== 1) continue;
      w.glint[c] = 0;
      const at = Math.min(a, b) * 0.022;
      this.later.push({ t: this.clock + at, fn: () => w.cAlive[c] && (w.glint[c] = 1) });
    }
  }

  /** A soft point of light that swells and fades: confirmation, where it happened. */
  private pulse(x: number, y: number, z: number, size: number, life: number) {
    const sp = this.sparks[this.sparkNext];
    this.sparkNext = (this.sparkNext + 1) % this.sparks.length;
    sp.m.position.set(x, y, z + 0.003);
    sp.life = sp.max = life;
    sp.size = size;
  }

  /**
   * Silk is pulled taut when it is tied off. A thread you swing across the middle becomes two true radii
   * meeting at the hub: you choose where they go, the spider does the craft, and the web reads as an orb.
   * Returns the particles of the finished thread(s).
   */
  private tauten(ids: number[], cs: number[]): number[] {
    const w = this.web, p = w.p;
    let minR = Infinity;
    for (let i = 1; i < ids.length - 1; i++) minR = Math.min(minR, Math.hypot(p[ids[i] * 3], p[ids[i] * 3 + 1]));
    const a = ids[0], b = ids[ids.length - 1];
    const ra = Math.hypot(p[a * 3], p[a * 3 + 1]), rb = Math.hypot(p[b * 3], p[b * 3 + 1]);
    // both ends must be tied to something else, or removing this thread would free them
    if (minR < 0.13 && ra > 0.1 && rb > 0.1 && (w.deg[a] > 1 || w.im[a] === 0) && (w.deg[b] > 1 || w.im[b] === 0)) {
      for (const c of cs) w.killC(c);
      if (this.hub < 0 || !w.pAlive[this.hub]) this.hub = w.addP(0, 0, 0, 1);
      const thick = w.thick[cs[0]] || CFG.baseThick;
      const one = w.chain(a, this.hub, RADIAL, thick, CFG.spacing, CFG.tension);
      const two = w.chain(this.hub, b, RADIAL, thick, CFG.spacing, CFG.tension);
      for (let c = 0; c < w.nC; c++) if (w.cAlive[c] && w.born[c] === w.time) w.glint[c] = 1;
      return [...one, ...two.slice(1)];
    }
    const n = ids.length - 1;
    const len = (w.dist(a, b) / n) * CFG.tension;
    for (const c of cs) {
      if (!w.cAlive[c]) continue;
      w.base[c] = len;
      w.glint[c] = 1;
    }
    return ids;
  }
  private hub = -1;

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
    this.rungQueue.push(...rungs);
  }

  /** One turn of sticky spiral at a time, paid for from the silk reserve; it waits when the spider is spent. */
  private laySpiral(dt: number) {
    this.rungClock -= dt;
    if (this.rungClock > 0 || !this.rungQueue.length) return;
    const w = this.web, p = w.p;
    const [i, j] = this.rungQueue[0];
    if (!w.pAlive[i] || !w.pAlive[j] || !w.anchored[i] || !w.anchored[j]) {
      this.rungQueue.shift();
      return;
    }
    const cost = w.dist(i, j) * CFG.captureCost;
    if (this.reserve < cost) {
      this.rungClock = 0.6;
      return;
    }
    this.rungQueue.shift();
    this.reserve -= cost;
    const thick = (CFG.baseThick + (CFG.maxThick - CFG.baseThick) * this.grow01) * 0.85;
    w.addC(i, j, CAPTURE, thick, 0.985, 0);
    this.rungClock = CFG.rungEvery;
    this.rungNote = (this.rungNote + 1) % 9;
    this.audio.pluck(note(14 - this.rungNote), 0.022, this.wpos({ x: p[i * 3], y: p[i * 3 + 1], z: p[i * 3 + 2] }), 0.9);
  }

  // ---------------------------------------------------------------- the beats

  private director(dt: number) {
    const t = this.phaseT;
    const fast = FLAGS.fast ? 0.35 : 1;
    const dim = this.dimmer.material as unknown as { uniforms: Record<string, { value: unknown }> };
    const fwdW = this.v1.copy(this.root.position).sub(this.head).normalize();
    (dim.uniforms.uFwd.value as Vector3).copy(fwdW);
    const amt = dim.uniforms.uAmount as { value: number };
    const target = (this.phase === 'intro' ? smooth(0, 2 * fast, t) : 1) * (0.62 + this.rainI * 0.12 + this.nightDim);
    amt.value += (target - amt.value) * (1 - Math.exp(-dt * 2));

    this.spider.wave = Math.max(0, this.spider.wave - dt * 0.45);

    if (this.phase === 'intro') {
      const ret = this.returning;
      // no words: the room darkens, something glints at the ceiling, and it comes down
      const G0 = ret ? 1 : 1.6 * fast; // glint
      const D0 = ret ? 2 : 2.6 * fast, D1 = D0 + (ret ? 4.5 : 7 * fast); // descent
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
        this.go(this.returning ? 'free' : 'frame');
        if (this.returning && this.brood.pendingSacs()) this.later.push({ t: this.clock + 2.5, fn: () => this.brood.hatchAll() });
      }
      return;
    }
    this.star.visible = false;

    // the hint light: a small soft point that shows where your hand goes
    let hintOn = false;
    if (this.phase === 'spin' || this.phase === 'frame') {
      const h = this.active;
      const idle = !h || !h.seen;
      if (idle && !this.desktop && t > 3) {
        hintOn = true;
        const s = Math.sin(this.clock * 1.6);
        this.hint.position.set(s * 0.2, -0.1, 0.42);
        this.hint.scale.setScalar(0.035);
      }
    }
    if (this.phase === 'frame' && t > 0.6 && !this.framed) this.buildFrame(); // if the room never answered
    if (this.phase === 'frame' && t > 2.5) this.go('spin');
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
      if (((this.threadsDone >= 2 || this.web.totalLength(CAPTURE) > 0.4) && t > 2 && !this.live) || t > 25) this.go('firstfly');
    }
    if (this.phase === 'firstfly' && t > 28 && !this.swarm.flies.some((f) => f.state === 'stuck')) {
      this.spawnFly(true);
      this.phaseT = 0;
    }
    // the pinch cue: two soft points at your fingertips that close together, once, before your first thread
    const h2 = this.active;
    const pinchCue = this.phase === 'spin' && this.threadsDone === 0 && !this.live && t > 2 && !!h2?.seen && !this.desktop;
    this.hint2.visible = pinchCue;
    if (pinchCue && h2) {
      const c = this.handLocal({ ...h2, pos: h2.pinch }, this.v2);
      const k = 0.5 + 0.5 * Math.cos(this.clock * 4.2);
      this.hint.visible = hintOn = true;
      this.hint.position.set(c.x - 0.022 * k, c.y + 0.012 * k, c.z);
      this.hint2.position.set(c.x + 0.022 * k, c.y - 0.012 * k, c.z);
      this.hint.scale.setScalar(0.014);
      this.hint2.scale.setScalar(0.014);
    }
    this.hint.visible = hintOn;
    (this.hint.material as unknown as { uniforms: { uOpacity: { value: number } } }).uniforms.uOpacity.value = 0.6 + Math.sin(this.clock * 3) * 0.25;

    if (this.phase === 'free') {
      // the headset can deliver room data late: look again now and then, for nesting sites
      this.scanClock -= dt;
      if (this.scanClock <= 0) {
        this.scanClock = 30;
        if (this.desktop) this.scan(null);
        else this.wantScan = true;
      }
      // flies come for the glints: few at first, more as the web and the spider mature; none in rain
      this.flyClock -= dt;
      const maxFlies = this.eaten < 3 ? 1 : this.eaten < 8 ? 2 : 3;
      if (this.flyClock <= 0 && this.rainI < 0.3) {
        this.flyClock = rand(...CFG.flyInterval) / (1 + Math.min(1, this.web.totalLength(CAPTURE) * 0.12));
        if (this.swarm.alive() < maxFlies) this.spawnFly(false, this.eaten >= 5 && Math.random() < 0.08);
      }
      if (this.rainI > 0.4) for (const f of this.swarm.flies) if (f.state === 'fly') f.leaving = true;
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
    this.audio.thrum(this.wpos(f.p));
    if (this.phase === 'firstfly') this.go('eat');
  }

  /** A caught fly within the spider's reach, if any. */
  private preyNear(): Fly | null {
    const mouth = this.spider.local(this.spider.mouth, this.v3);
    const r = CFG.eatRadius * (0.7 + this.spider.size * 0.3);
    let best: Fly | null = null, bd = r;
    for (const f of this.swarm.flies) {
      if (f.state !== 'stuck') continue;
      const d = Math.min(f.p.distanceTo(this.S), f.p.distanceTo(mouth));
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  /** What the spider does by itself when your hand rests: lay eggs, take prey, eat its store, look into a pluck. */
  private autoTarget(): Vector3 | null {
    const lift = (v: Vector3) => this.autoGoal.copy(v).add(this.v2.set(0, 0.46 * this.spider.scaleM, 0));
    if (this.gravid >= 1 && this.nest >= 0 && this.web.pAlive[this.nest]) {
      const p = this.web.p;
      return this.autoGoal.set(p[this.nest * 3], p[this.nest * 3 + 1] - 0.03, p[this.nest * 3 + 2]);
    }
    let prey: Fly | null = null, bd = Infinity;
    for (const f of this.swarm.flies) {
      if (f.state !== 'stuck') continue;
      const d = f.p.distanceTo(this.S) + (f.wrapped ? 0.3 : 0); // fresh prey first; the larder can wait
      if (d < bd) {
        bd = d;
        prey = f;
      }
    }
    if (prey) return lift(prey.p);
    if (this.attention && this.clock - this.attention.t < 3) return this.autoGoal.copy(this.attention.p);
    return null;
  }

  private feed(dt: number) {
    let near = false;
    const f = this.preyNear();
    if (f) {
      near = true;
      f.escape += dt; // held, it cannot tear free
      if (!f.wrapped) {
        // binding it: turn after turn of silk
        const before = f.wrapT;
        f.setWrap(f.wrapT + dt / CFG.wrapTime);
        this.reserve = Math.max(0, this.reserve - dt * 0.04);
        if (Math.floor(before * 6) !== Math.floor(f.wrapT * 6)) this.audio.pluck(note(9 + Math.floor(f.wrapT * 5)), 0.03, this.wpos(f.p), 0.5);
      } else {
        f.eatT += dt;
        if (f.eatT > 1.2) this.eat(f);
      }
    }
    for (const g of this.swarm.flies) if (g !== f) g.eatT = Math.max(0, g.eatT - dt);
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
    this.web.glint.fill(0.6);
    this.reserve = Math.min(this.silkCap, this.reserve + 0.6);
    if (this.brood.pendingSacs() === 0 && this.gravid < 1) {
      this.gravid = Math.min(1, this.gravid + 1 / CFG.mealsPerSac);
      if (this.gravid >= 1) this.chooseNest();
    }
    this.persist();
    if (this.phase === 'eat') this.go('free');
  }
  private afterglow = 0;
  private lights!: ReturnType<typeof makeLights>;
  private nightDim = 0;

  /**
   * Your real time of day: mornings the web is beaded with dew and lit gold, evenings amber,
   * nights cool moonlight. (?hour=7 overrides it for testing and filming.)
   */
  private timeOfDay() {
    const q = new URLSearchParams(location.search).get('hour');
    const h = q !== null ? +q : new Date().getHours();
    if (h >= 5 && h < 10) {
      sunCol.setRGB(1.0, 0.8, 0.62);
      for (let c = 0; c < this.web.nC; c++) if (this.web.cAlive[c]) this.web.cwet[c] = Math.max(this.web.cwet[c], 0.45 + this.web.seed[c] * 0.25);
      this.colonyWet = 0.5;
      this.afterglow = 1;
    } else if (h >= 17 && h < 21) {
      sunCol.setRGB(1.0, 0.68, 0.42);
    } else if (h >= 21 || h < 5) {
      sunCol.setRGB(0.6, 0.7, 1.0);
      this.nightDim = 0.1;
    } else sunCol.setRGB(1.0, 0.86, 0.66);
    this.lights.key.color.copy(sunCol);
  }
  private sparks: { m: Mesh; life: number; max: number; size: number }[] = [];
  private sparkNext = 0;

  private get silkCap() {
    return Math.min(CFG.silkMax, CFG.silkBase + CFG.silkPerFood * this.food);
  }

  /** Silk comes back slowly, faster when the spider has eaten recently; the abdomen shows the reserve. */
  private economy(dt: number) {
    const fed = this.clock - this.lastMeal < 90 && this.eaten > 0 ? 1.6 : 0.7;
    this.reserve = Math.min(this.silkCap, this.reserve + dt * CFG.silkRegen * fed);
    const k = 1 - Math.exp(-dt * 2);
    this.spider.fullness += (this.reserve / this.silkCap - this.spider.fullness) * k;
    this.spider.gravid += (this.gravid - this.spider.gravid) * k;
    // the spider's weight bends the silk it hangs against
    const w = this.web;
    const i = w.nearestP(this.S.x, this.S.y, this.S.z, 0.035);
    if (i >= 0 && w.im[i] !== 0) w.p[i * 3 + 1] -= 0.00004 * this.spider.size;

    // silk within the legs' reach: they take hold of it
    const reach = 1.9 * this.spider.scaleM;
    const holds = this.spider.holds;
    holds.length = 0;
    const p = w.p;
    for (let c = 0; c < w.nC && holds.length < 32; c++) {
      if (!w.cAlive[c] || w.born[c] > w.time) continue;
      for (const t of [0.25, 0.5, 0.75]) {
        const a = w.ca[c] * 3, b = w.cb[c] * 3;
        const x = p[a] + (p[b] - p[a]) * t, y = p[a + 1] + (p[b + 1] - p[a + 1]) * t, z = p[a + 2] + (p[b + 2] - p[a + 2]) * t;
        const dx = x - this.S.x, dy = y - this.S.y, dz = z - this.S.z;
        if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
        const v = this.holdPool[holds.length];
        holds.push(v.set(x, y, z));
        if (holds.length >= 32) break;
      }
    }

    // behaviour: face a struggling fly; when nothing is happening, groom and look about
    if (this.phase !== 'intro') {
      let want = Math.sin(this.clock * 0.13) * 0.22;
      const prey = this.swarm.flies.find((f) => f.state === 'stuck' && !f.wrapped);
      if (prey) want = clamp((prey.p.x - this.S.x) * 3, -0.9, 0.9);
      this.twist += (want - this.twist) * (1 - Math.exp(-dt * 2.2));
      this.groomT -= dt;
      const quiet = !this.live && !prey && this.spider.eating < 0.1 && this.stillT > 2.5 && !this.layingSac;
      if (this.groomT <= 0 && quiet) {
        this.groomT = rand(10, 18);
        this.grooming = 1.8;
      }
      this.grooming = Math.max(0, this.grooming - dt);
      this.spider.groom += ((this.grooming > 0 && quiet ? 1 : 0) - this.spider.groom) * (1 - Math.exp(-dt * 5));
    }
  }
  private holdPool = Array.from({ length: 32 }, () => new Vector3());
  private groomT = 8;
  private grooming = 0;

  /** Your fingertip on a thread plucks it: it rings, sways, and the spider turns to look. */
  private touch(dt: number) {
    this.pluckCool -= dt;
    if (this.desktop) return;
    for (const h of [this.hands.left, this.hands.right]) {
      if (!h.seen) continue;
      const tip = this.v1.copy(h.tip).applyMatrix4(this.world.player.matrixWorld).applyMatrix4(this.toLocal);
      const last = h === this.hands.left ? this.tipL : this.tipR;
      const vel = this.v2.copy(tip).sub(last).divideScalar(Math.max(dt, 1e-3));
      // a finger passing through the web's surface counts, not only a centimetre-perfect touch
      const crossed = Math.sign(last.z) !== Math.sign(tip.z) && Math.abs(last.z - tip.z) < 0.15;
      const zAt = crossed ? 0 : tip.z;
      last.copy(tip);
      if (this.pluckCool > 0 || vel.length() < 0.05 || (!crossed && Math.abs(tip.z) > 0.03)) continue;
      const hit = this.web.nearestC(tip.x, tip.y, zAt, crossed ? 0.022 : 0.015);
      if (!hit) continue;
      const k = Math.min(0.012, vel.length() * 0.01);
      vel.normalize();
      this.web.impulse(hit.c, hit.t, vel.x * k, vel.y * k, vel.z * k * 1.5);
      this.web.glint[hit.c] = 1;
      const pitch = 3 + Math.floor(clamp(this.web.base[hit.c] * 40, 0, 9));
      this.audio.pluck(note(pitch), 0.08, this.wpos(tip), 2);
      this.attention = { p: tip.clone(), t: this.clock };
      // the spider startles toward it
      this.Sprev.addScaledVector(this.v3.copy(tip).sub(this.S).normalize(), -0.003);
      this.pluckCool = 0.15;
    }
  }

  /** Flies that slip past the big web may blunder into a spiderling family's web instead. */
  private colonyFlies() {
    const cs = this.brood.colonies;
    for (const f of this.swarm.flies) {
      if (f.state !== 'fly') continue;
      if (f.leaving && !this.colonyBound.has(f) && cs.length) {
        this.colonyBound.set(f, Math.random() < 0.55 ? cs[Math.floor(Math.random() * cs.length)] : null);
      }
      const c = this.colonyBound.get(f);
      if (!c) continue;
      f.target.copy(c.spots[0]);
      f.retarget = 99;
      f.commit = true;
      if (f.p.distanceTo(c.spots[0]) < 0.04) {
        f.state = 'gone';
        this.brood.feedColony(c);
        this.audio.pluck(note(17), 0.02, this.wpos(f.p), 0.6);
      }
    }
  }
  private colonyBound = new Map<Fly, ReturnType<Brood['found']> | null>();
  private reserve = CFG.silkBase;
  private rungQueue: [number, number][] = [];
  private rungClock = 0;
  private rungNote = 0;
  private gravid = 0;
  private gravidT = 0;
  private nest = -1;
  private layingSac = 0;
  private handMotion = 0;
  private stillT = 0;
  private auto = false;
  private lastHand = new Vector3();
  private autoGoal = new Vector3();
  private attention: { p: Vector3; t: number } | null = null;
  private pluckCool = 0;
  private tipL = new Vector3();
  private tipR = new Vector3();
  private scanClock = 3;

  /** Heavy with eggs, the spider picks a sheltered place: the highest strong junction of the frame. */
  private chooseNest() {
    const w = this.web, p = w.p;
    let best = -1, by = -Infinity;
    for (let i = 0; i < w.nP; i++) {
      if (!w.pAlive[i] || !w.anchored[i] || w.im[i] === 0 || w.deg[i] < 3) continue;
      const r = Math.hypot(p[i * 3], p[i * 3 + 1]);
      if (r < this.frameR * 0.6 || r > this.frameR * 1.3) continue;
      if (p[i * 3 + 1] > by) {
        by = p[i * 3 + 1];
        best = i;
      }
    }
    this.nest = best;
    this.gravidT = 0;
  }

  /** Carrying eggs: go to the nest (by itself when your hand rests) and spin the sac there, slowly. */
  private nesting(dt: number) {
    if (this.gravid < 1 || this.layingSac) {
      if (this.layingSac) {
        this.layingSac -= dt;
        this.laying = Math.max(this.laying, 0.2);
        this.gravid = Math.max(0, this.gravid - dt / 6);
        if (this.layingSac <= 0) {
          this.layingSac = 0;
          this.gravid = 0;
          this.audio.chord([0, 4, 7, 12], 0.05, 5);
          this.persist();
        }
      }
      return;
    }
    this.gravidT += dt;
    const w = this.web, p = w.p;
    if (this.nest < 0 || !w.pAlive[this.nest]) this.chooseNest();
    let at = -1;
    if (this.nest >= 0) {
      const d = Math.hypot(p[this.nest * 3] - this.S.x, p[this.nest * 3 + 1] - this.S.y);
      if (d < 0.07) at = this.nest;
    }
    // if you keep it busy for a long time, it lays where it is
    if (at < 0 && this.gravidT > 45) at = w.nearestP(this.S.x, this.S.y, this.S.z, 0.2);
    if (at < 0) return;
    this.layingSac = 6;
    this.brood.lay(new Vector3(p[at * 3], p[at * 3 + 1] - 0.011, p[at * 3 + 2]), at, 0, 0.02);
    this.audio.chord([0, 2, 7], 0.04, 6);
    this.audio.pluck(note(9), 0.05, this.wpos(this.S), 2.5);
    // weather follows its own course, but a waiting sac draws the next rain a little nearer
    this.rainClock = Math.min(this.rainClock, FLAGS.fast ? 12 : 90);
  }

  private laySac() {
    this.gravid = 1;
    this.chooseNest();
  }

  /** What happened while you were gone: meals wrapped and stored, some silk fallen, the families grown. */
  private awayFor(hours: number) {
    const sv = this.save!;
    const w = this.web;
    if (sv.colonies) this.brood.restoreColonies(sv.colonies);
    for (const sc of sv.sacs ?? []) {
      const pos = new Vector3().fromArray(sc.p);
      this.brood.lay(pos, w.nearestP(pos.x, pos.y + 0.011, pos.z, 0.1), sc.age);
    }
    if (hours > 0.2) this.brood.passTime(hours);
    // the spider stayed by its hub and kept that part whole
    for (let c = 0; c < w.nC; c++) {
      if (!w.cAlive[c]) continue;
      const i = w.ca[c] * 3;
      if (Math.hypot(w.p[i], w.p[i + 1]) < 0.12) w.hp[c] = 1;
      else if (hours > 2 && w.kind[c] === CAPTURE && Math.random() < 0.12) w.killC(c);
    }
    w.connectivity();
    const meals = Math.min(6, (sv.parcels ?? 0) + (hours > 0.25 ? Math.max(1, Math.floor(hours * 1.2)) : 0));
    for (let k = 0; k < meals; k++) this.swarm.parcel(w);
  }

  private weather(dt: number) {
    if (this.phase === 'free' && this.raining <= 0) {
      this.rainClock -= dt;
      if (this.rainClock <= 0) {
        this.raining = CFG.rainLength;
        this.rainClock = rand(...CFG.rainGap);
      }
    }
    if (this.raining > 0) {
      this.raining -= dt;
      if (this.raining <= 0) {
        this.afterglow = 1; // the sun comes back onto a soaked web
        this.flyClock = 5; // and the insects come out again
      }
    }
    this.afterglow = Math.max(0, this.afterglow - dt / 30);
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
    // drops striking silk: a brief sparkle where they hit, and now and then a glassy note
    if (this.rainI > 0.1 && Math.random() < dt * 14 * this.rainI) {
      const c = Math.floor(Math.random() * w.nC);
      if (w.cAlive[c]) {
        const hit = w.pointOn(c, Math.random(), { x: 0, y: 0, z: 0 });
        this.pulse(hit.x, hit.y, hit.z - 0.001, 0.011, 0.22);
        w.impulse(c, 0.5, 0, -0.0004, 0);
        if (Math.random() < 0.35) this.audio.tick(this.wpos(hit), 0.008 + Math.random() * 0.014);
      }
    }
    for (const sp of this.sparks) {
      sp.life -= dt;
      sp.m.visible = sp.life > 0;
      if (sp.life > 0) sp.m.scale.setScalar(sp.size * Math.sin((sp.life / sp.max) * Math.PI));
    }
  }

  // ---------------------------------------------------------------- drawing & sound

  private draw(dt: number) {
    const w = this.web;
    const thickScale = 1;
    // the light drifts very slowly, so glints crawl along the threads even when nothing moves
    const drift = Math.sin(this.clock * 0.045) * 0.3;
    const sunW = this.v1.set(sunDir.x + drift, sunDir.y - this.afterglow * 0.12, sunDir.z).normalize().applyQuaternion(this.root.quaternion);
    const glow = smooth(0, 0.25, this.afterglow) * this.afterglow;
    this.silk.uniforms.uBright.value = 1 + glow * 0.5;
    this.drops.uniforms.uGlow.value = glow;
    this.silk.uniforms.uSun.value.copy(sunW);
    this.rain.setSun(sunW);
    this.drops.uniforms.uSun.value.copy(sunW);
    this.drops.uniforms.uFill.value.copy(fillDir).applyQuaternion(this.root.quaternion);

    this.silk.begin();
    this.drops.begin();
    this.silk.pushWeb(w, thickScale);
    // the dragline: from the spinnerets up to the ceiling
    const s = this.spider.local(this.spider.spinneret, this.v2);
    const dir = this.v3.copy(this.P).sub(this.S).normalize();
    if (dir.y < 0.25) dir.y = 0.25;
    dir.normalize();
    const reach = (this.ceilY - s.y) / dir.y;
    const dthick = CFG.baseThick * (0.9 + this.grow01 * 0.8);
    if (this.phase !== 'placing') this.silk.push(s.x, s.y, s.z, s.x + dir.x * reach, s.y + dir.y * reach, s.z + dir.z * reach, dthick, 1, DRAG + 0.3, 1, 0);
    pushBeads(w, this.drops, 1 + this.grow01 * 0.4);
    this.drips.update(dt, this.floorY, (x, y, z, r) => this.drops.push(x, y, z, r));
    this.colonyWet = this.rainI > 0.05 ? Math.min(1, this.colonyWet + dt * 0.03) : Math.max(0, this.colonyWet - dt * 0.005);
    const pp = this.v3;
    this.brood.update(dt, this.colonyWet, this.silk, this.drops, (i) => (i >= 0 && w.pAlive[i] ? pp.set(w.p[i * 3], w.p[i * 3 + 1], w.p[i * 3 + 2]) : null), CFG.sacMinAge, this.afterglow > 0.25);
    this.silk.end();
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
  }

  private sound() {
    if (this.phase !== 'intro') {
      const density = Math.min(1, this.web.totalLength(CAPTURE) * 0.15 + this.brood.colonies.length * 0.06 + this.eaten * 0.02);
      this.audio.score(density, this.rainI > 0.3 ? 1 : this.afterglow > 0.2 ? 2 : 0);
    }
    this.audio.listener(this.head.x, this.head.y, this.head.z, this.fwd.x, this.fwd.y, this.fwd.z, this.up.x, this.up.y, this.up.z);
    for (const [f, v] of this.voices) {
      if (f.state === 'gone') {
        v.stop();
        this.voices.delete(f);
        continue;
      }
      const pw = this.wpos(f.p);
      v.pos(...pw);
      const lvl = f.wrapped ? 0 : f.state === 'fly' ? 0.2 : f.state === 'stuck' ? (f.burst > 0 ? 0.09 * (1 - f.wrapT) : 0) : 0;
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

