// Gossamer: the whole piece. One system runs the beats, the spider, the silk, the flies and the weather.

import {
  Color,
  MeshPhysicalMaterial,
  SphereGeometry,
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
import { type Fly, type FlyKind, Swarm } from './flies.js';
import { OneEuro3 } from './filter.js';
import { FpsMeter } from './fps.js';
import { Hands, type HandState } from './hands.js';
import { sunCol, DropMesh, glowTexture, makeDimmer, pushBeads, SilkMesh, spriteMaterial, starTexture, sunDir, fillDir } from './render.js';
import { type Anchor, scanRoom } from './room.js';
import { Brood, type ColonySave, type SacSave } from './brood.js';
import { Bird } from './bird.js';
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
  rains?: number;
  birds?: number;
  savedAt: number;
  born?: number;
};

type FrameAnchor = { pos: Vector3; angle: number; ring: number; tied: boolean };

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
  private bird: Bird;

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
    this.bird = new Bird(env);
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
    this.nestMesh = new Mesh(new SphereGeometry(1, 20, 14), new MeshPhysicalMaterial({ color: new Color(0.95, 0.9, 0.8), roughness: 0.8, sheen: 1, sheenColor: new Color(1, 0.9, 0.7), sheenRoughness: 0.5, envMap: env }));
    this.nestMesh.visible = false;
    this.nestGlow = sprite(gt, new Color(1, 0.8, 0.5));
    this.root.add(this.nestMesh, this.nestGlow);
    const sparkMat = spriteMaterial(gt, new Color(1, 0.96, 0.88));
    for (let k = 0; k < 24; k++) {
      const m = new Mesh(new PlaneGeometry(1, 1), sparkMat);
      m.renderOrder = 21;
      m.frustumCulled = false;
      m.visible = false;
      this.root.add(m);
      this.sparks.push({ m, life: 0, max: 1, size: 0.01 });
    }
    const splashMat = spriteMaterial(gt, new Color(0.85, 0.9, 1));
    for (let k = 0; k < 40; k++) {
      const m = new Mesh(new PlaneGeometry(1, 1), splashMat);
      m.renderOrder = 21;
      m.frustumCulled = false;
      m.visible = false;
      this.root.add(m);
      this.splashes.push({ m, life: 0, max: 1, size: 0.01 });
    }
    this.rain.onFloor = (x, y, z) => {
      if (x * x + z * z < 1.1) this.splash(x, y + 0.002, z, 0.012 + Math.random() * 0.008, 0.28);
    };
    this.hint = sprite(gt, new Color(0.95, 0.9, 0.8));
    this.hint2 = sprite(gt, new Color(0.95, 0.9, 0.8));
    this.halo = sprite(gt, new Color(1, 0.85, 0.55));
    this.star = sprite(starTexture(), new Color(1, 0.95, 0.88));

    this.root.add(this.silk.mesh, this.drops.mesh, this.spider.root, this.swarm.group, this.brood.group, this.bird.group, this.rain.mesh, this.glow, this.hint, this.hint2, this.halo, this.star);
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
      if (e.key === 'b') this.callBird();
      if (e.key === 'd') this.heavy.push({ x: this.S.x, y: this.ceilY, z: 0, v: 0, r: 0.002, gather: CFG.dropGather, last: -1 });
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
      if (this.desktop) this.startFrame();
      else this.wantScan = true;
    }
    if (p === 'spin' && !this.frameClosed) this.closeFrame();
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
      if (this.phase === 'frame' && !this.framed) this.startFrame();
    }
    this.roomCheck(frame);
  }

  private anchorId?: string = this.save?.anchorId;
  private captureState: 'wait' | 'asked' | 'done' = 'wait';
  private planesSeen = 0;

  /**
   * A room the headset has never scanned has no planes, so the web could only tie to the floor and a
   * guessed ceiling. Three seconds into a fresh session (the planes take a moment to arrive), if there
   * are still none, ask the headset to run its space setup right here, then look again. The persistent
   * anchor is only created once that is settled, because space setup wipes anchors.
   */
  private roomCheck(frame: XRFrame) {
    if (this.captureState === 'done' || this.desktop) return;
    if (this.phase === 'idle' || this.phase === 'placing') return;
    if (this.captureState === 'asked') return;
    const planes = (frame as unknown as { detectedPlanes?: Set<XRPlane> }).detectedPlanes;
    if (planes && planes.size > 0) this.planesSeen = planes.size;
    if (this.save || this.planesSeen > 0) return this.settleRoom();
    if (this.phaseT < 3) return;
    const session = frame.session as XRSession & { initiateRoomCapture?: () => Promise<undefined> };
    if (!session.initiateRoomCapture) return this.settleRoom();
    this.captureState = 'asked';
    this.persistOk = false;
    session
      .initiateRoomCapture()
      .catch(() => {})
      .then(() => {
        // give the new planes a moment to arrive, then read the room again and hang the web in it
        this.later.push({ t: this.clock + 1.5, fn: () => {
          this.wantScan = true;
          this.settleRoom();
        } });
      });
  }

  private settleRoom() {
    if (this.captureState === 'done') return;
    this.captureState = 'done';
    this.persistOk = true;
    if (!this.anchor && !this.save) this.wantAnchor = true;
  }
  private persistOk = true;

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
      // the anchor waits until we know whether space setup must run first (it wipes anchors)
      if (!this.desktop && this.save) this.wantAnchor = true;
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
      this.frameClosed = true;
      this.rains = this.save.rains ?? 0;
      this.birds = this.save.birds ?? 0;
      this.spider.size = this.sizeFor(this.food);
      this.awayFor(hours);
      this.reserve = this.silkCap;
      this.chooseNest();
    } else {
      this.floorY = -this.root.position.y;
      this.web.floorY = this.floorY;
      this.ceilY = Math.max(1.15, 2.45 + this.floorY);
      this.spider.size = this.sizeFor(0); // it arrives small
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

  /**
   * The scaffold. The spider hangs at the centre of the frame-to-be, already tied to the ceiling by
   * its dragline. Swing it out toward a wall, the floor or a piece of furniture and it runs a line
   * there and comes back: a mooring the whole web will hang from, which nothing ever breaks. When every
   * side is tied, the ring between them closes and the web proper can begin.
   */
  private frameList: FrameAnchor[] = [];
  private frameClosed = false;
  private trip: { a: FrameAnchor; t: number; out: number; back: number; from: Vector3; moored: boolean } | null = null;
  private frameLook: number | null = null;

  private startFrame() {
    if (this.framed) return;
    if (!this.anchors.length) this.scan(null);
    this.framed = true;
    const list = [...this.anchors.map((a) => ({ pos: a.pos.clone(), angle: a.angle })), { pos: new Vector3(0, this.ceilY, 0), angle: Math.PI / 2 }];
    list.sort((a, b) => a.angle - b.angle);
    this.frameList = list.map((a) => ({ ...a, ring: -1, tied: false }));
    // the ceiling it came down from is tied already
    const top = this.frameList.find((a) => a.pos.x === 0 && a.pos.y === this.ceilY)!;
    this.tie(top, false);
  }

  /** The next mooring to go for: sideways first (a swing side to side), then down, then up. */
  private frameNext(): FrameAnchor | null {
    const todo = this.frameList.filter((a) => !a.tied);
    if (!todo.length) return null;
    const pref = (a: FrameAnchor) => Math.abs(Math.sin(a.angle)) + (a.pos.y > 0.4 ? 0.5 : 0);
    todo.sort((a, b) => pref(a) - pref(b));
    return todo[0];
  }

  private frameStep(dt: number, t: number) {
    if (this.trip) return;
    const next = this.frameNext();
    if (!next) {
      this.closeFrame();
      return;
    }
    const S = this.S;
    const r = Math.hypot(S.x, S.y), ang = Math.atan2(S.y, S.x);
    const adiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    // swung out toward an untied side: off it goes
    let reach: FrameAnchor | null = null;
    for (const a of this.frameList) {
      if (a.tied || r < this.frameR * 0.72 || adiff(ang, a.angle) > 0.55) continue;
      if (!reach || adiff(ang, a.angle) < adiff(ang, reach.angle)) reach = a;
    }
    if (reach) return this.tie(reach, true);
    // the glint: light catches the real surface the next line will tie to, and the spider looks that way
    this.star.visible = true;
    this.star.position.copy(next.pos);
    this.star.scale.setScalar(0.05 + Math.sin(this.clock * 3) * 0.008);
    this.frameLook = clamp(Math.cos(next.angle) * 0.9, -0.9, 0.9);
    // if your hand rests, it goes by itself
    if ((t > 14 && (this.handIdle > 2.5 || this.stillT > 4)) || t > 50) this.tie(next, true);
  }

  private tie(a: FrameAnchor, trip: boolean) {
    if (a.tied) return;
    a.tied = true;
    if (!trip) return this.moor(a);
    const from = this.S.clone();
    const dist = from.distanceTo(a.pos);
    this.trip = { a, t: 0, out: 0.5 + dist * 0.45, back: 0.45 + dist * 0.38, from, moored: false };
    this.controls = false;
    this.spider.wave = 0;
    this.audio.spinHiss(0.8);
  }

  /** Spin the mooring: from the real surface back to the ring. */
  private moor(a: FrameAnchor) {
    const w = this.web, R0 = this.frameR;
    // pinned until the ring closes: a half-strung frame must not sag while the rest is tied
    a.ring = w.addP(Math.cos(a.angle) * R0, Math.sin(a.angle) * R0, 0, 0);
    const pin = w.addP(a.pos.x, a.pos.y, a.pos.z, 0);
    w.chain(pin, a.ring, MOOR, CFG.baseThick * 1.3, 0.12, 0.96, 0, 0.03);
    w.connectivity();
    this.pulse(a.pos.x, a.pos.y, a.pos.z, 0.03, 0.6);
    this.audio.pluck(note(5 + (this.frameList.indexOf(a) % 5)), 0.12, this.wpos(a.pos.clone().multiplyScalar(0.3)), 2.2);
  }

  /** Where the spider is on its trip out to a mooring and back. */
  private tripStep(dt: number) {
    const T = this.trip!;
    T.t += dt;
    this.Sprev.copy(this.S);
    if (!T.moored) {
      const k = smooth(0, 1, T.t / T.out);
      this.S.lerpVectors(T.from, T.a.pos, k);
      if (T.t >= T.out) {
        T.moored = true;
        T.t = 0;
        this.moor(T.a);
      }
    } else {
      const w = this.web, r = T.a.ring;
      const to = this.v1.set(w.p[r * 3], w.p[r * 3 + 1], w.p[r * 3 + 2]);
      const k = smooth(0, 1, T.t / T.back);
      this.S.lerpVectors(T.a.pos, to, k);
      if (T.t >= T.back) {
        this.trip = null;
        this.controls = true;
        this.needNeutral = true;
        this.T.copy(this.S);
        this.audio.spinHiss(0);
        if (!this.frameNext()) this.closeFrame();
      }
    }
    this.P.set(this.S.x, this.S.y + CFG.pendulum, this.S.z);
  }

  /** Every side tied: the ring between the moorings closes, and the web can begin. */
  private closeFrame() {
    if (this.frameClosed) return;
    if (!this.framed) this.startFrame();
    this.frameClosed = true;
    this.trip = null;
    this.controls = true;
    for (const a of this.frameList) this.tie(a, false);
    const w = this.web;
    const ring = [...this.frameList].sort((a, b) => a.angle - b.angle).map((a) => a.ring);
    for (let k = 0; k < ring.length; k++) {
      w.chain(ring[k], ring[(k + 1) % ring.length], RADIAL, CFG.baseThick * 1.1, CFG.spacing, 0.975, 0.2 + k * 0.12, 0.02);
    }
    for (const a of this.frameList) w.im[a.ring] = 1; // now the moorings hold it
    w.connectivity();
    this.chooseNest();
    this.star.visible = false;
    this.frameLook = null;
    this.audio.chord([0, 4, 7, 9], 0.06, 5);
    if (this.phase === 'frame') this.go('spin');
  }

  // ---------------------------------------------------------------- helpers

  private wpos(p: Vector3 | { x: number; y: number; z: number }): [number, number, number] {
    const v = this.v2.set(p.x, p.y, p.z).applyMatrix4(this.root.matrixWorld);
    return [v.x, v.y, v.z];
  }

  private sizeFor(food: number) {
    return CFG.sizeMin + (CFG.sizeMax - CFG.sizeMin) * (1 - Math.exp(-food / CFG.growK));
  }

  /** 0 when it arrives, 1 fully grown. */
  private get grow01() {
    return clamp((this.spider.size - CFG.sizeMin) / (CFG.sizeMax - CFG.sizeMin), 0, 1);
  }

  private persist() {
    if (!this.framed || !this.persistOk || this.desktop && !FLAGS.debug) return;
    if (this.phase === 'idle' || this.phase === 'placing' || this.phase === 'frame' || (this.phase === 'intro' && !this.returning)) return;
    try {
      const s: Save = { web: this.web.serialize(), food: this.food, eaten: this.eaten, ceilY: this.ceilY, floorY: this.floorY, anchorId: this.anchorId, savedAt: Date.now(), born: this.save?.born ?? Date.now(),
        ...this.brood.save(), gravid: this.gravid, rains: this.rains, birds: this.birds, parcels: this.swarm.flies.filter((f) => f.wrapped).length };
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
    if ((s.sacs?.length ?? 0) > 0 || (s.gravid ?? 0) >= 1 || (s.birds ?? 0) >= 1) return 'Grow a family.';
    if ((s.rains ?? 0) >= 1) return 'Watch the sky.';
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

  /**
   * The frame-rate guard: if frames run long on the headset, spend less at the edges of your view and on
   * dew; when there is room again, give it back. (Judged at a 60 fps floor; we aim for 72.)
   */
  private guard() {
    const now = performance.now();
    const ms = now - this.lastFrameAt;
    this.lastFrameAt = now;
    if (!this.world.session || ms <= 0 || ms > 200) return;
    this.frameMs += (ms - this.frameMs) * 0.05;
    this.guardT += ms / 1000;
    const slow = this.frameMs > 15.2, easy = this.frameMs < 12.2;
    if ((slow && this.guardT > 2 && this.quality < 3) || (easy && this.guardT > 10 && this.quality > 0)) {
      this.quality += slow ? 1 : -1;
      this.guardT = 0;
      this.world.renderer.xr.setFoveation([0.35, 0.6, 0.85, 1][this.quality]);
      this.drops.limit = [Infinity, 3000, 2000, 1200][this.quality];
      if (FLAGS.debug) console.log('[gossamer] quality', this.quality, this.frameMs.toFixed(1));
    }
    if (!slow && !easy) this.guardT = 0;
  }
  private fps = FLAGS.fps ? new FpsMeter() : null;
  private lastFrameAt = 0;
  private frameMs = 13.9;
  private guardT = 0;
  private quality = 0;

  private step(dtRaw: number) {
    this.guard();
    if (this.fps) {
      this.fps.attach(this.world.session ? this.world.player.head : this.world.camera);
      this.fps.tick(this.quality, `${this.phase}  silk ${this.web.nC}  dew ${this.drops.n}  flies ${this.swarm.flies.length}  ${this.world.session ? 'XR' : 'desktop'}`);
    }
    if (this.phase === 'idle' || this.paused) return;
    const dt = Math.min(dtRaw, 1 / 30);
    this.clock += dt;
    this.lastDt = dt;
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
    this.bird.update(sdt);
    this.sky(sdt);
    this.heavyRain(sdt);
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
      if (o === this.hands.occluder || o === this.fps?.mesh) return;
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
      this.mouseT.set(m.x, m.y, 0);
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
    // A hand takes part only when it is raised and pointing at the web. Seated, a hand resting in your lap
    // is barely lower than a raised one, but it points at the floor, so it rests.
    const fh = this.v2.set(this.fwd.x, 0, this.fwd.z);
    if (fh.lengthSq() < 1e-4) fh.set(0, 0, -1);
    fh.normalize();
    const b = this.bounds;
    for (const h of [L, R]) {
      const m = h === L ? this.motionL : this.motionR;
      const lp = h === L ? this.lastPosL : this.lastPosR;
      if (!h.seen) {
        h.engaged = false;
        m.v = 0;
        continue;
      }
      const w = this.v3.copy(h.pos).applyMatrix4(this.world.player.matrixWorld);
      m.v += (Math.min(2, w.distanceTo(lp) / Math.max(1e-3, this.lastDt)) - m.v) * 0.2;
      lp.copy(w);
      w.sub(this.head);
      const f = w.dot(fh), y = w.y;
      const aim = this.aimFrom(h, h === L ? this.aimL : this.aimR);
      const r = aim ? Math.hypot(aim.x, aim.y) : Infinity;
      h.engaged = h.engaged ? f > 0.02 && y > -0.62 && r < b * 2.4 : f > 0.06 && y > -0.55 && r < b * 1.8;
    }
    // the steering hand is sticky, and the other hand's taps spin without taking the spider away;
    // but if the steering hand is still and the other one clearly moves, the moving hand takes over
    let a = this.active && this.active.engaged ? this.active : R.engaged ? R : L.engaged ? L : null;
    if (a && L.engaged && R.engaged) {
      const other = a === L ? R : L;
      const ma = a === L ? this.motionL : this.motionR, mo = other === L ? this.motionL : this.motionR;
      if (mo.v > 0.25 && ma.v < 0.08 && !this.live) a = other;
    }
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
  private motionL = { v: 0 };
  private motionR = { v: 0 };
  private lastPosL = new Vector3();
  private lastPosR = new Vector3();
  private aimL = new Vector3();
  private aimR = new Vector3();
  private lastDt = 1 / 72;
  private spinHand: HandState | null = null;
  private lastEngaged = -10;
  private handFilter = new OneEuro3(1.1, 2.4, 1.0);
  private overT = 0;

  /** Your hand to the spider's target in the web plane. */
  private handLocal(h: HandState, out: Vector3) {
    return out.copy(h.pos).applyMatrix4(this.world.player.matrixWorld).applyMatrix4(this.toLocal);
  }

  /**
   * Where your hand points on the web: a ray from your shoulder through your knuckles, the way the
   * headset's own pointer works. Absolute: the same hand position is always the same place on the web.
   */
  private aimFrom(h: HandState, out: Vector3): Vector3 | null {
    const fh = this.v2.set(this.fwd.x, 0, this.fwd.z);
    if (fh.lengthSq() < 1e-4) fh.set(0, 0, -1);
    fh.normalize();
    const right = this.v3.set(-fh.z, 0, fh.x);
    const side = h === this.hands.left ? -1 : 1;
    const shoulder = this.aimA.copy(this.head).add(this.aimB.set(0, -0.17, 0)).addScaledVector(right, 0.16 * side).applyMatrix4(this.toLocal);
    const hand = this.handLocal(h, this.aimB);
    const d = hand.sub(shoulder);
    if (d.z > -0.02) return null; // not pointing toward the web
    const t = -shoulder.z / d.z;
    return out.copy(shoulder).addScaledVector(d, t);
  }
  private aimA = new Vector3();
  private aimB = new Vector3();
  private aim = new Vector3();
  private mouseT = new Vector3();
  private handIdle = 0;

  private moveSpider(dt: number) {
    const S = this.S, P = this.P, T = this.T;
    const g01 = this.grow01;
    if (this.controls) {
      const h = this.active;
      let aim: Vector3 | null = null;
      if (this.desktop) aim = this.aim.copy(this.mouseT);
      else if (h && h.engaged) {
        const raw = this.aimFrom(h, this.aim);
        if (raw) aim = this.handFilter.filter(raw, dt, this.aim);
      }
      if (aim) {
        const sp = aim.distanceTo(this.lastHand) / Math.max(dt, 1e-3);
        this.lastHand.copy(aim);
        this.handMotion += (Math.min(sp, 3) - this.handMotion) * (1 - Math.exp(-dt * 4));
        this.handIdle = 0;
      } else {
        this.handIdle += dt;
        this.handFilter.reset();
      }
      this.stillT = !aim || this.handMotion < 0.06 ? this.stillT + dt : 0;
      // only when you lower your hand does the spider go about its own business
      const goal = this.autoTarget();
      const auto = !aim && !!goal && this.handIdle > 1.2;
      if (auto && !this.auto) this.glanceT = this.clock; // it looks at you before it goes
      this.auto = auto;
      if (this.stun > 0) {
        // knocked off: it hangs low on its dragline until it gathers itself
        this.stun -= dt;
        T.set(S.x, Math.max(this.floorY + 0.3, Math.min(S.y, -0.42)), 0);
      } else if (aim) {
        T.set(aim.x, aim.y, 0);
        // the edge of the web gives like a rubber band: more and more resistance
        const b = this.bounds;
        const r = Math.hypot(T.x, T.y);
        if (r > b) {
          const ex = r - b;
          const soft = b + ex / (1 + ex * 9);
          T.x *= soft / r;
          T.y *= soft / r;
        }
        T.y = Math.max(T.y, this.floorY + 0.25);
      } else if (this.auto && goal) T.lerp(goal, 1 - Math.exp(-dt * 1.6));

      // the dragline's top lags behind, so the spider leans and sways as it moves...
      // (while the scaffold is being strung it hangs on a longer line, and really swings)
      const framing = this.phase === 'frame';
      const L = CFG.pendulum * (framing ? 1.7 : 1);
      const kP = 1 - Math.exp(-dt * (framing ? 3.5 : 5));
      P.x += (T.x - P.x) * kP;
      P.y += (T.y + L - P.y) * kP;
      P.z += (T.z - P.z) * kP;
      // ...but it goes where you point, crisply (a critically damped spring)
      const w = this.stun > 0 ? 4.5 : framing ? 7 : 12 + g01 * 5;
      const vx = (S.x - this.Sprev.x) / dt, vy = (S.y - this.Sprev.y) / dt, vz = (S.z - this.Sprev.z) / dt;
      this.Sprev.copy(S);
      const nvx = vx + (w * w * (T.x - S.x) - 2 * w * vx) * dt;
      const nvy = vy + (w * w * (T.y - S.y) - 2 * w * vy) * dt;
      const nvz = vz + (w * w * (T.z - S.z) - 2 * w * vz) * dt;
      S.x += nvx * dt;
      S.y += nvy * dt;
      S.z += nvz * dt;
      if (this.phase !== 'frame') {
        const fixed = this.web.repair(S.x, S.y, S.z, CFG.repairRadius * this.spider.size, dt * 1.8);
        if (fixed && Math.random() < dt * 6) this.audio.pluck(note(10 + Math.floor(Math.random() * 5)), 0.012, this.wpos(S), 0.3);
      }
    }
    if (this.trip) this.tripStep(dt);
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
    const canSpin = this.framed && this.frameClosed && this.controls && this.stun <= 0 && ['spin', 'firstfly', 'eat', 'free'].includes(this.phase);
    const tap = this.tap;
    const w = this.web;
    const s = this.spider.local(this.spider.spinneret, this.v1);
    // a hungry spider still spins, but finer, fainter silk
    const thick = (CFG.baseThick + (CFG.maxThick - CFG.baseThick) * this.grow01) * (0.5 + 0.5 * Math.min(1, this.reserve / 0.4));
    const reach = CFG.attachReach * (0.85 + this.spider.size * 0.15);

    if (tap && !canSpin && this.controls) this.audio.pluck(note(5), 0.03, this.wpos(s), 0.4);
    if (canSpin && tap && !this.live) {
      // a tap always spins. (Only a completely full solver says no, after hours of building.)
      if (!w.roomFor(60)) {
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
    // the solver is nearly full: tie off here rather than lose silk
    if (d > CFG.spacing && !w.roomFor(10)) return this.release(new Set([...L.ids, L.head]));
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
      this.reserve = Math.max(0, this.reserve - d);
    }
    this.audio.spinHiss(Math.max(0.02, (this.v2.copy(this.S).sub(this.Sprev).length() / Math.max(dt, 1e-3)) * 1.5));
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

  /**
   * One turn of sticky spiral at a time, paid for from the silk reserve, and only where the spider is:
   * bring it round the web and the spiral follows it. (When your hand rests it goes round by itself.)
   */
  private laySpiral(dt: number) {
    this.rungClock -= dt;
    if (this.rungClock > 0 || !this.rungQueue.length) return;
    const w = this.web, p = w.p;
    const reach = CFG.rungReach + 0.05 * this.spider.size;
    let at = -1;
    for (let k = 0; k < this.rungQueue.length; k++) {
      const [i, j] = this.rungQueue[k];
      if (!w.pAlive[i] || !w.pAlive[j] || !w.anchored[i] || !w.anchored[j]) {
        this.rungQueue.splice(k--, 1);
        continue;
      }
      const mx = (p[i * 3] + p[j * 3]) / 2 - this.S.x, my = (p[i * 3 + 1] + p[j * 3 + 1]) / 2 - this.S.y;
      if (mx * mx + my * my < reach * reach) {
        at = k;
        break;
      }
    }
    if (at < 0) {
      this.rungClock = 0.2;
      return;
    }
    const [i, j] = this.rungQueue[at];
    const cost = w.dist(i, j) * CFG.captureCost;
    if (this.reserve < cost) {
      this.rungClock = 0.6;
      return;
    }
    this.rungQueue.splice(at, 1);
    this.reserve -= cost;
    const thick = (CFG.baseThick + (CFG.maxThick - CFG.baseThick) * this.grow01) * 0.85;
    w.addC(i, j, CAPTURE, thick, 0.985, 0);
    this.rungClock = CFG.rungEvery;
    this.rungNote = (this.rungNote + 1) % 9;
    this.audio.pluck(note(14 - this.rungNote), 0.022, this.wpos({ x: p[i * 3], y: p[i * 3 + 1], z: p[i * 3 + 2] }), 0.9);
  }

  /** The turn of spiral waiting nearest the spider, if any. */
  private nextRung(out: Vector3): Vector3 | null {
    const w = this.web, p = w.p;
    let best = -1, bd = Infinity;
    for (let k = 0; k < this.rungQueue.length; k++) {
      const [i, j] = this.rungQueue[k];
      if (!w.pAlive[i] || !w.pAlive[j] || !w.anchored[i] || !w.anchored[j]) continue;
      const mx = (p[i * 3] + p[j * 3]) / 2, my = (p[i * 3 + 1] + p[j * 3 + 1]) / 2;
      const d = (mx - this.S.x) ** 2 + (my - this.S.y) ** 2;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    if (best < 0) return null;
    const [i, j] = this.rungQueue[best];
    return out.set((p[i * 3] + p[j * 3]) / 2, (p[i * 3 + 1] + p[j * 3 + 1]) / 2, (p[i * 3 + 2] + p[j * 3 + 2]) / 2);
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
    if (this.phase === 'frame') {
      if (t > 0.6 && !this.framed) this.startFrame(); // if the room never answered
      if (this.framed) this.frameStep(dt, t);
    }
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
    // early on, a soft point where the next turn of spiral waits for the spider
    if (this.threadsDone > 0 && this.threadsDone < 4 && !this.live && this.rungQueue.length && !hintOn && this.phase !== 'frame') {
      const nr = this.nextRung(this.v2);
      if (nr && nr.distanceTo(this.S) > CFG.rungReach + 0.05 * this.spider.size) {
        hintOn = true;
        this.hint.position.set(nr.x, nr.y, nr.z + 0.004);
        this.hint.scale.setScalar(0.016 + Math.sin(this.clock * 4) * 0.005);
      }
    }
    if (this.phase === 'firstfly' && t > 28 && !this.swarm.flies.some((f) => f.state === 'stuck')) {
      this.spawnFly(true);
      this.phaseT = 0;
    }
    // the first fly tore free before it was eaten: never leave the player waiting, send another
    if (this.phase === 'eat' && t > 2 && !this.eatingList.length && !this.swarm.flies.some((f) => f.state === 'stuck')) this.go('firstfly');
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
      // flies come for the glints: few at first, more as the story goes on; none in rain, and a feast
      // in the sun after it, when the whole web is wet and bright
      this.flyClock -= dt;
      const maxFlies = this.eaten < 1 ? 1 : this.rains < 1 ? 2 : this.birds < 1 ? 3 : 4;
      if (this.flyClock <= 0 && this.rainI < 0.3 && this.birdWarn <= 0 && !this.bird.active) {
        this.flyClock = rand(...CFG.flyInterval) / (1 + Math.min(1, this.web.totalLength(CAPTURE) * 0.12) + this.afterglow * 1.2);
        if (this.swarm.alive() < maxFlies) {
          // variety grows with the web: moths (slow, worth two, hard on silk), gnat swarms, a rare golden fly
          const r = Math.random();
          if (this.eaten >= 4 && r < 0.15) {
            const side = Math.random() < 0.5 ? -1 : 1;
            for (let k = 0; k < 3; k++) this.later.push({ t: this.clock + k * 0.35, fn: () => this.spawnFly(false, false, 'gnat', side) });
          } else if (this.eaten >= 2 && r < 0.4) this.spawnFly(false, false, 'moth');
          else this.spawnFly(false, this.eaten >= 5 && r > 0.93);
        }
      }
      if (this.rainI > 0.4) for (const f of this.swarm.flies) if (f.state === 'fly') f.leaving = true;
      if (this.clock - this.lastMeal > 60) this.food = Math.max(0, this.food - dt * CFG.hunger * 2);
      // decay grows with the spider: forgiving while the web is young
      this.web.decayScale = 0.3 + 0.7 * Math.min(1, this.eaten / 10);
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

  private spawnFly(sure: boolean, golden = false, kind: FlyKind = 'fly', side?: number) {
    const f = this.swarm.spawn({ sure, golden, kind, side });
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
    const g = this.autoTargetRaw();
    // never wander off the web on its own (to silk or prey that fell with a torn thread, say)
    return g && Math.hypot(g.x, g.y) <= this.bounds * 1.25 && g.y > this.floorY + 0.25 ? g : null;
  }

  private autoTargetRaw(): Vector3 | null {
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
    // a meal for the eggs
    const sac = this.carry > 0 ? this.brood.sacPos() : null;
    if (sac) return lift(sac);
    if (this.attention && this.clock - this.attention.t < 3) return this.autoGoal.copy(this.attention.p);
    // the spiral, a turn at a time
    if (this.reserve > 0.25 && this.nextRung(this.autoGoal)) return this.autoGoal;
    return null;
  }

  /**
   * The sky. Once the web is worth raiding, a bird comes gliding through now and then. It calls first,
   * from off to one side; the spider hears it before you do and holds still. A spider that holds still,
   * or sits at the edge of its frame, is not seen. One that moves in the open is knocked down.
   * The bird tears what it passes through, except the moorings.
   */
  private birdAt = Infinity;
  private birdWarn = 0;
  private birdSide = 1;
  private birdHit = false;
  private birdTore = false;
  private shadow = 0;
  private stun = 0;
  private carry = 0;
  rains = 0;
  birds = 0;

  private callBird() {
    if (this.bird.active || this.birdWarn > 0) return;
    this.birdWarn = CFG.birdWarn;
    this.birdSide = Math.random() < 0.5 ? -1 : 1;
    this.birdAt = this.clock + rand(...CFG.birdGap);
    const far = { x: this.birdSide * 2.6, y: 0.7, z: -1.8 };
    this.audio.birdCall(this.wpos(far));
    this.later.push({ t: this.clock + 1.5, fn: () => this.audio.birdCall(this.wpos({ x: this.birdSide * 1.9, y: 0.6, z: -1.5 })) });
  }

  private sky(dt: number) {
    const free = this.phase === 'free';
    if (free && this.birdAt === Infinity && (this.eaten >= CFG.birdAfter || this.phaseT > CFG.birdLatest)) this.birdAt = this.clock + (FLAGS.bird || FLAGS.fast ? 6 : 25);
    if (free && this.rainI < 0.2 && !this.trip && this.clock >= this.birdAt && !this.bird.active && this.birdWarn <= 0) this.callBird();
    if (this.birdWarn > 0) {
      this.birdWarn -= dt;
      if (this.birdWarn <= 0) {
        this.bird.start(this.birdSide, clamp(this.S.y, -0.16, 0.2));
        this.audio.whoosh(this.wpos({ x: this.birdSide * 0.8, y: this.S.y + 0.3, z: -0.5 }));
        this.birdHit = false;
        this.birdTore = false;
        for (const f of this.swarm.flies) if (f.state === 'fly') f.leaving = true;
      }
    }
    // alarm: it draws in and freezes, facing the sound
    const alarmed = this.birdWarn > 0 || this.bird.active;
    this.spider.alarm += ((alarmed ? 1 : 0) - this.spider.alarm) * (1 - Math.exp(-dt * (alarmed ? 6 : 1.2)));
    const was = this.birdActive;
    this.birdActive = this.bird.active;
    if (was && !this.bird.active) {
      this.birds++;
      this.persist();
      this.audio.chord([2, 7, 9], 0.04, 5, 0.6); // it is gone
    }
    this.shadow += ((this.bird.active ? Math.exp(-Math.pow((this.bird.k - 0.5) / 0.22, 2)) : 0) - this.shadow) * (1 - Math.exp(-dt * 14));
    if (!this.bird.active) return;
    const b = this.bird.pos, w = this.web;
    if (Math.abs(b.z) > 0.3) return;
    // it tears what it flies through (never the moorings)
    const keep = w.onBreak;
    w.onBreak = undefined;
    let torn = 0;
    for (let c = 0; c < w.nC; c++) {
      if (!w.cAlive[c] || w.kind[c] === MOOR) continue;
      const i = w.ca[c] * 3, j = w.cb[c] * 3;
      const mx = (w.p[i] + w.p[j]) / 2 - b.x, my = (w.p[i + 1] + w.p[j + 1]) / 2 - b.y;
      if (Math.abs(mx) < 0.07 && Math.abs(my) < 0.055) {
        w.killC(c);
        torn++;
      }
    }
    w.onBreak = keep;
    if (torn) {
      w.connectivity();
      if (!this.birdTore) this.audio.noiseBurst(0.14, 2600, 0.14, this.wpos(b));
      this.birdTore = true;
    }
    // the spider: seen only if it moves in the open
    const S = this.S;
    const r = Math.hypot(S.x, S.y);
    const hidden = r > this.frameR * 0.88 || this.stillT > 0.7 || this.stun > 0 || this.handIdle > 0.8;
    if (!this.birdHit && !hidden && Math.hypot(S.x - b.x, S.y - b.y) < 0.11) {
      this.birdHit = true;
      this.knock(1);
    }
  }
  private birdActive = false;

  /** Knocked off: it drops down its dragline, loses what it was carrying, and climbs back. */
  private knock(k: number) {
    this.stun = 1.6 + k * 1.4;
    if (this.live) this.release(new Set(this.live.ids));
    this.rungClock = Math.max(this.rungClock, 2);
    this.reserve *= 1 - 0.5 * k;
    this.food = Math.max(0, this.food - 1.5 * k);
    this.carry = 0;
    this.Sprev.y = this.S.y + 0.04; // a jolt downward
    this.spider.wave = 0;
    this.audio.thud(this.wpos(this.S));
    this.audio.chord([0, 1, 5], 0.05 * k + 0.02, 3.5);
  }

  /**
   * Rain, heavy: drops gather on the ceiling above the web, swell, and let go. One that lands on a thread
   * shakes it and can tear it; one that lands on the spider knocks it down. You see them coming.
   */
  private heavy: { x: number; y: number; z: number; v: number; r: number; gather: number; last: number }[] = [];
  private dropClock = 6;

  private heavyRain(dt: number) {
    if (this.rainI > 0.55 && this.phase === 'free' && !this.trip) {
      this.dropClock -= dt;
      if (this.dropClock <= 0) {
        this.dropClock = rand(...CFG.heavyDropGap) * (this.rains <= 1 ? 1.4 : 1);
        const b = this.bounds * 0.75;
        // the roof leaks above where the spider is, more often than not
        const x = Math.random() < 0.6 ? clamp(this.S.x + rand(-0.06, 0.06), -b, b) : rand(-b, b);
        this.heavy.push({ x, y: this.ceilY, z: rand(-0.02, 0.02), v: 0, r: 0.002, gather: CFG.dropGather, last: -1 });
      }
    }
    const w = this.web, S = this.S;
    for (const d of this.heavy) {
      if (d.gather > 0) {
        d.gather -= dt;
        d.r = 0.002 + 0.0062 * smooth(CFG.dropGather, 0, d.gather);
        d.y = this.ceilY - d.r;
        if (d.gather <= 0) {
          this.audio.tick(this.wpos(d), 0.05);
          this.pulse(d.x, d.y, d.z, 0.03, 0.3);
        }
        continue;
      }
      d.v = Math.min(CFG.dropFall, d.v + 9.81 * 0.5 * dt);
      const y0 = d.y;
      d.y -= d.v * dt;
      // silk in its way: it loads the thread with water, shakes it, and may tear it
      const hit = w.nearestC(d.x, (y0 + d.y) / 2, d.z, d.r + 0.004 + (y0 - d.y) * 0.5, (1 << RADIAL) | (1 << CAPTURE));
      if (hit && hit.c !== d.last) {
        d.last = hit.c;
        w.impulse(hit.c, hit.t, 0, -0.004, 0.001);
        w.hp[hit.c] -= 0.45;
        w.cwet[hit.c] = 1;
        w.glint[hit.c] = 1;
        this.pulse(d.x, d.y, d.z, 0.02, 0.25);
        this.audio.tick(this.wpos(d), 0.035);
      }
      // the spider in its way
      if (this.stun <= 0 && !this.trip && Math.hypot(d.x - S.x, d.y - S.y, d.z - S.z) < d.r + 0.03 * this.spider.size + 0.012) {
        this.knock(0.5);
        d.y = this.floorY - 1;
      }
      if (d.y <= this.floorY) this.splash(d.x, this.floorY + 0.002, d.z, 0.035, 0.4);
    }
    this.heavy = this.heavy.filter((d) => d.y > this.floorY);
  }

  /** A fleeting glint on the floor where a drop lands. */
  private splash(x: number, y: number, z: number, size: number, life: number) {
    const sp = this.splashes[this.splashNext];
    this.splashNext = (this.splashNext + 1) % this.splashes.length;
    sp.m.position.set(x, y, z);
    sp.life = sp.max = life;
    sp.size = size;
  }
  private splashes: { m: Mesh; life: number; max: number; size: number }[] = [];
  private splashNext = 0;

  /**
   * The spider takes any caught fly the moment it touches it, and binds and eats it while you carry on:
   * no hovering, no waiting.
   */
  private feed(dt: number) {
    const prey = this.preyNear();
    if (prey) this.grab(prey);
    this.spider.eating += ((this.eatingList.length ? 1 : 0) - this.spider.eating) * (1 - Math.exp(-dt * 6));
    for (const e of this.eatingList) {
      e.t += dt;
      const m = this.spider.local(this.spider.mouth, this.v2);
      e.f.g.position.lerpVectors(e.from, m, smooth(0, 0.22, e.t));
      if (e.t > 0.2 && !e.f.wrapped) e.f.setWrap((e.t - 0.2) / 0.7);
      e.f.g.scale.setScalar(e.f.baseScale * (1 - smooth(1.0, 1.5, e.t) * 0.9));
      if (e.t > 1.5) {
        e.f.state = 'gone';
        this.swarm.group.remove(e.f.g);
        this.eat(e.f);
      }
    }
    this.eatingList = this.eatingList.filter((e) => e.t <= 1.5);
  }

  private grab(f: Fly) {
    f.state = 'eaten';
    this.swarm.flies = this.swarm.flies.filter((x) => x !== f);
    this.eatingList.push({ f, t: 0, from: f.p.clone() });
    this.voices.get(f)?.stop();
    this.voices.delete(f);
    if (this.web.cAlive[f.stuckC]) this.web.hp[f.stuckC] = 1;
    this.audio.pluck(note(7), 0.07, this.wpos(f.p), 0.8);
  }

  /** A meal, finished: growth, silk back, and the nest a little fuller. */
  private eat(f: Fly) {
    const first = this.eaten === 0;
    this.food += f.value;
    this.eaten++;
    this.lastMeal = this.clock;
    this.audio.chord(first ? [0, 4, 7, 9] : [2, 4, 7], first ? 0.1 : 0.06, first ? 5 : 3);
    if (first) {
      this.slowmo = 1.4;
      this.audio.chord([5, 9, 12, 14], 0.08, 6, 0.9);
    }
    this.web.glint.fill(0.6);
    this.reserve = Math.min(this.silkCap, this.reserve + 0.6);
    if (this.brood.pendingSacs() > 0) {
      this.carry = 1; // the next thing it does is take this to its eggs
    } else if (this.gravid < 1 && (this.birds >= 1 || FLAGS.fast || (this.phase === 'free' && this.phaseT > CFG.eggsLatest))) {
      // eggs come late in the story: once the web has weathered rain and been raided and held
      this.gravid = Math.min(1, this.gravid + Math.min(1, f.value) / CFG.mealsPerSac);
      if (this.gravid >= 1) this.chooseNest();
    }
    this.persist();
    if (this.phase === 'eat') this.go('free');
  }
  private afterglow = 0;
  private nestMesh!: Mesh;
  private nestGlow!: Mesh;
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
      if (this.phase === 'frame' && this.frameLook !== null) want = this.frameLook;
      if (this.clock - this.glanceT < 1.3) want = 0.85; // the glance: it turns its head toward you
      if (this.birdWarn > 0 || this.bird.active) want = this.birdSide * 0.85;
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
  private glanceT = -10;
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

  /**
   * The nest, drawn: a small silk retreat at the top of the frame. With every meal it grows denser and
   * warmer, so you can always see what you are working toward. When it is full, eggs.
   */
  private drawNest(dt: number) {
    const w = this.web, p = w.p, n = this.nest;
    const show = n >= 0 && !!w.pAlive[n] && this.framed;
    this.nestMesh.visible = show;
    this.nestGlow.visible = show && this.gravid > 0.05;
    if (!show) return;
    const g = this.layingSac ? 0 : this.gravid;
    this.nestFill += (g - this.nestFill) * (1 - Math.exp(-dt * 2));
    const f = this.nestFill;
    const x = p[n * 3], y = p[n * 3 + 1] - 0.012, z = p[n * 3 + 2];
    this.nestMesh.position.set(x, y, z);
    this.nestMesh.scale.set(0.011 + 0.01 * f, 0.008 + 0.008 * f, 0.007 + 0.005 * f);
    this.nestGlow.position.set(x, y, z + 0.006);
    this.nestGlow.scale.setScalar(0.03 + 0.03 * f + Math.sin(this.clock * 2) * 0.003 * f);
    (this.nestGlow.material as unknown as { uniforms: { uOpacity: { value: number } } }).uniforms.uOpacity.value = 0.25 + 0.6 * f;
    // the retreat's own threads: more of them as it fills
    const strands = 4 + Math.floor(f * 8);
    for (let k = 0; k < strands; k++) {
      const a = k * 2.4 + 0.3, r = 0.02 + 0.012 * ((k * 7) % 3);
      this.silk.push(x, y, z, x + Math.cos(a) * r, y + Math.sin(a) * r * 0.8 + 0.006, z - 0.003, 0.00018, 1, RADIAL + 0.2 * f, 0.55 + 0.45 * f, 0);
    }
  }
  private nestFill = 0;

  /** Carrying eggs: go to the nest (by itself when your hand rests) and spin the sac there, slowly. */
  private nesting(dt: number) {
    // a meal for the eggs: the sac grows with each one the spider brings
    const sac = this.carry > 0 ? this.brood.sacPos() : null;
    if (sac && sac.distanceTo(this.S) < 0.05 + 0.02 * this.spider.size) {
      this.carry = 0;
      this.brood.feed(1 / CFG.sacMeals);
      this.pulse(sac.x, sac.y, sac.z, 0.03, 0.6);
      this.audio.chord([4, 7, 11], 0.04, 4);
      this.laying = Math.max(this.laying, 1.2);
      this.persist();
    }
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
      this.brood.lay(pos, w.nearestP(pos.x, pos.y + 0.011, pos.z, 0.1), sc.age, 1, sc.fed ?? 1);
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
    if (this.phase === 'free' && this.raining <= 0 && !this.bird.active && this.birdWarn <= 0) {
      this.rainClock -= dt;
      // the first rain waits until there is a web and a few meals to care about (or long enough)
      const ready = this.rains > 0 || this.eaten >= CFG.rainAfter || this.phaseT > CFG.rainLatest;
      if (this.rainClock <= 0 && ready) {
        this.raining = CFG.rainLength;
        this.rainClock = rand(...CFG.rainGap);
        this.rains++;
        this.dropClock = 9;
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
    for (const sp of this.splashes) {
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
    this.silk.uniforms.uBright.value = (1 + glow * 0.5) * (1 - 0.55 * this.shadow);
    (this.dimmer.material as unknown as { uniforms: { uFlash: { value: number } } }).uniforms.uFlash.value = -0.22 * this.shadow;
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
    this.drawNest(dt);
    // heavy drops: a bead gathering on the ceiling, then a bead with a streak behind it
    for (const d of this.heavy) {
      this.drops.push(d.x, d.y, d.z, d.r);
      if (d.gather <= 0) this.silk.push(d.x, d.y, d.z, d.x, d.y + Math.min(0.08, d.v * 0.04), d.z, d.r * 0.45, 1, DRAG + 0.5, 0.7, 1);
    }
    pushBeads(w, this.drops, 1 + this.grow01 * 0.4);
    this.drips.update(dt, this.floorY, (x, y, z, r) => this.drops.push(x, y, z, r));
    this.colonyWet = this.rainI > 0.05 ? Math.min(1, this.colonyWet + dt * 0.03) : Math.max(0, this.colonyWet - dt * 0.005);
    const pp = this.v3;
    this.brood.update(dt, this.colonyWet, this.silk, this.drops, (i) => (i >= 0 && w.pAlive[i] ? pp.set(w.p[i * 3], w.p[i * 3 + 1], w.p[i * 3 + 2]) : null), CFG.sacMinAge, this.afterglow > 0.25);
    this.silk.end();
    this.drops.end();

    // where the silk will catch when you let go; or, when your hand rests, where the spider is off to
    const at = this.attachTarget;
    this.glow.visible = at >= 0 || (this.auto && this.controls && !this.trip);
    if (at >= 0) {
      this.glow.position.set(w.p[at * 3], w.p[at * 3 + 1], w.p[at * 3 + 2] + 0.003);
      this.glow.scale.setScalar(0.022 + Math.sin(this.clock * 9) * 0.004);
    } else if (this.glow.visible) {
      const g = this.autoGoal;
      this.glow.position.set(g.x, g.y, g.z + 0.003);
      this.glow.scale.setScalar(0.016 + Math.sin(this.clock * 2.5) * 0.004);
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

