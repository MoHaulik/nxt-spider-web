// Your hands: where they are, whether they pinch, and invisible depth-only copies of them so your
// real hands (seen in passthrough) pass in front of the web instead of behind it.
// Controllers work as a fallback (trigger = pinch), but nothing needs them.

import { Color, InstancedMesh, Matrix4, MeshBasicMaterial, Object3D, SphereGeometry, Vector3 } from '@iwsdk/core';

export type HandState = {
  seen: boolean;
  lastSeen: number;
  pos: Vector3; // control point: the knuckles, which do not move when you pinch
  pinch: Vector3; // the pinch point itself
  tip: Vector3; // index fingertip, for touching silk
  pinching: boolean;
  down: boolean; // pinch began this frame
  up: boolean; // pinch ended this frame
  gap: number;
  engaged: boolean; // raised in front of you: only an engaged hand steers or spins
  flip: number; // frames the raw pinch has disagreed with the debounced one
};

const mk = (): HandState => ({ seen: false, lastSeen: -1, pos: new Vector3(), pinch: new Vector3(), tip: new Vector3(), pinching: false, down: false, up: false, gap: 1, engaged: false, flip: 0 });

// WebXR joint order
const J = { wrist: 0, thumbTip: 4, indexMeta: 5, indexTip: 9, middleMeta: 10, middleProx: 11 };
// chains along which to fill extra occluder spheres
const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8], [8, 9],
  [0, 10], [10, 11], [11, 12], [12, 13], [13, 14],
  [0, 15], [15, 16], [16, 17], [17, 18], [18, 19],
  [0, 20], [20, 21], [21, 22], [22, 23], [23, 24],
  [6, 11], [11, 16], [16, 21], [1, 6], [5, 10], [10, 15], [15, 20],
];
const PER_HAND = 25 + BONES.length * 2;

export class Hands {
  left = mk();
  right = mk();
  readonly occluder: InstancedMesh;
  private poses = new Float32Array(16 * 25);
  private radii = new Float32Array(25);
  private m = new Matrix4();
  private o = new Object3D();
  private tmpA = new Vector3();
  private tmpB = new Vector3();
  // the headset's own pinch (WebXR select events): the most reliable signal there is
  private selecting = new Map<XRInputSource, boolean>();
  private session: XRSession | null = null;

  private listen(session: XRSession) {
    if (this.session === session) return;
    this.session = session;
    this.selecting.clear();
    session.addEventListener('selectstart', (e) => this.selecting.set((e as XRInputSourceEvent).inputSource, true));
    session.addEventListener('selectend', (e) => this.selecting.set((e as XRInputSourceEvent).inputSource, false));
    session.addEventListener('inputsourceschange', () => this.selecting.clear());
  }

  constructor() {
    const mat = new MeshBasicMaterial({ color: new Color(0, 0, 0) });
    mat.colorWrite = false;
    this.occluder = new InstancedMesh(new SphereGeometry(1, 10, 8), mat, PER_HAND * 2);
    this.occluder.renderOrder = -50;
    this.occluder.frustumCulled = false;
    this.occluder.count = 0;
  }

  /** Read hands from the XR frame. Poses come out in the reference space (which is our world frame). */
  readXR(frame: XRFrame, ref: XRReferenceSpace, now: number) {
    this.listen(frame.session);
    const sources = frame.session.inputSources;
    let inst = 0;
    for (const h of [this.left, this.right]) {
      h.down = h.up = false;
      h.seen = false;
    }
    for (const src of sources) {
      const h = src.handedness === 'left' ? this.left : src.handedness === 'right' ? this.right : null;
      if (!h) continue;
      if (src.hand) {
        const f = frame as XRFrame & { fillPoses?: Function; fillJointRadii?: Function };
        const joints = [...src.hand.values()];
        const ok = f.fillPoses?.(joints, ref, this.poses) && f.fillJointRadii?.(joints, this.radii);
        if (!ok) continue;
        const P = this.poses;
        const at = (j: number, out: Vector3) => out.set(P[j * 16 + 12], P[j * 16 + 13], P[j * 16 + 14]);
        at(J.middleMeta, h.pos).lerp(at(J.middleProx, this.tmpA), 0.6);
        const tt = at(J.thumbTip, this.tmpA);
        const it = at(J.indexTip, this.tmpB);
        // joint positions are the centres of the fingertips: subtract their radii to get the real gap
        h.gap = tt.distanceTo(it) - this.radii[J.thumbTip] - this.radii[J.indexTip];
        h.pinch.copy(tt).add(it).multiplyScalar(0.5);
        h.tip.copy(it);
        const was = h.pinching;
        const sel = this.selecting.get(src);
        const raw = sel === true || (was ? h.gap < 0.022 : h.gap < 0.007);
        // a pinch must hold for two frames to count: a one-frame tracking glitch never starts or ends a thread
        h.flip = raw !== was ? h.flip + 1 : 0;
        if (h.flip >= 2) {
          h.pinching = raw;
          h.flip = 0;
        }
        h.down = h.pinching && !was;
        h.up = !h.pinching && was;
        h.seen = true;
        h.lastSeen = now;
        // occluders
        for (let j = 0; j < 25; j++) {
          this.o.position.set(P[j * 16 + 12], P[j * 16 + 13], P[j * 16 + 14]);
          this.o.scale.setScalar(this.radii[j] * 1.25);
          this.o.updateMatrix();
          this.occluder.setMatrixAt(inst++, this.o.matrix);
        }
        for (const [a, b] of BONES) {
          for (const t of [0.33, 0.66]) {
            this.o.position.set(
              P[a * 16 + 12] + (P[b * 16 + 12] - P[a * 16 + 12]) * t,
              P[a * 16 + 13] + (P[b * 16 + 13] - P[a * 16 + 13]) * t,
              P[a * 16 + 14] + (P[b * 16 + 14] - P[a * 16 + 14]) * t,
            );
            this.o.scale.setScalar((this.radii[a] + (this.radii[b] - this.radii[a]) * t) * 1.3);
            this.o.updateMatrix();
            this.occluder.setMatrixAt(inst++, this.o.matrix);
          }
        }
      } else if (src.gripSpace) {
        const pose = frame.getPose(src.gripSpace, ref);
        if (!pose) continue;
        const p = pose.transform.position;
        h.pos.set(p.x, p.y, p.z);
        h.pinch.copy(h.pos);
        h.tip.set(1e3, 1e3, 1e3);
        const pressed = this.selecting.get(src) === true || !!src.gamepad?.buttons[0]?.pressed;
        const was = h.pinching;
        h.pinching = pressed;
        h.down = pressed && !was;
        h.up = !pressed && was;
        h.seen = true;
        h.lastSeen = now;
      }
    }
    for (const h of [this.left, this.right]) {
      if (!h.seen && h.pinching) {
        h.pinching = false;
        h.up = true;
      }
    }
    this.occluder.count = inst;
    this.occluder.instanceMatrix.needsUpdate = true;
  }

  /** Desktop preview: the mouse is a hand. */
  setMouse(pos: Vector3, down: boolean, now: number) {
    const h = this.right;
    const was = h.pinching;
    h.pos.copy(pos);
    h.pinch.copy(pos);
    h.tip.set(1e3, 1e3, 1e3);
    h.seen = true;
    h.lastSeen = now;
    h.pinching = down;
    h.down = down && !was;
    h.up = !down && was;
    this.left.seen = false;
  }
}
