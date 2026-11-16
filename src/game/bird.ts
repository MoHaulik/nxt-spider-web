// The bird: a large dark shape that comes gliding through, fast, once the web is worth raiding.
// It is a silhouette more than a creature: a body, a head, a fanned tail and two long gliding wings,
// held in a slow flap. It tears what it passes through. A spider that holds still, or sits at the
// edge of its frame, is not seen.

import { Color, Group, Mesh, MeshPhysicalMaterial, PlaneGeometry, SphereGeometry, Texture, Vector3 } from '@iwsdk/core';

export class Bird {
  readonly group = new Group();
  active = false;
  /** Where it is now, in the web frame. */
  readonly pos = new Vector3();
  /** 0..1 along its pass; it crosses the web plane at about 0.5. */
  k = 0;
  side = 1;
  private t = 0;
  private dur = 1.25;
  private a = new Vector3();
  private b = new Vector3();
  private c = new Vector3();
  private prev = new Vector3();
  private wings: Mesh[] = [];
  private tail: Mesh;
  private flap = 0;

  constructor(env: Texture | null) {
    const dark = new MeshPhysicalMaterial({ color: new Color(0.13, 0.1, 0.085), roughness: 0.85, sheen: 0.6, sheenColor: new Color(0.6, 0.5, 0.4), sheenRoughness: 0.7, envMap: env });
    const body = new Mesh(new SphereGeometry(1, 20, 12), dark);
    body.scale.set(0.045, 0.04, 0.12);
    const head = new Mesh(new SphereGeometry(1, 16, 10), dark);
    head.scale.set(0.03, 0.03, 0.04);
    head.position.set(0, 0.015, 0.12);
    const beak = new Mesh(new SphereGeometry(1, 8, 6), dark);
    beak.scale.set(0.008, 0.007, 0.03);
    beak.position.set(0, 0.012, 0.16);
    this.group.add(body, head, beak);
    // wings: long and slightly drooped, as a gliding bird holds them
    const wingGeo = new PlaneGeometry(1, 1, 8, 2);
    {
      const p = wingGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i) + 0.5; // 0 at the root, 1 at the tip
        const y = p.getY(i);
        // a tapering, swept shape; the trailing edge is scalloped by primaries
        const chord = 1 - 0.55 * x * x;
        p.setY(i, y * chord - 0.1 * x);
        p.setZ(i, -0.12 * x * x); // droop
      }
      p.needsUpdate = true;
      wingGeo.computeVertexNormals();
    }
    wingGeo.rotateX(-Math.PI / 2); // lie flat: spread along x, chord along z
    wingGeo.translate(0.5, 0, 0);
    for (const s of [-1, 1]) {
      const w = new Mesh(wingGeo, dark);
      w.scale.set(s * 0.27, 1, 0.11);
      w.position.set(s * 0.02, 0.012, 0.01);
      this.group.add(w);
      this.wings.push(w);
    }
    this.tail = new Mesh(new PlaneGeometry(0.075, 0.07), dark);
    this.tail.rotation.x = -Math.PI / 2;
    this.tail.position.set(0, 0.005, -0.14);
    this.group.add(this.tail);
    this.group.traverse((o) => ((o as Mesh).frustumCulled = false));
    this.group.visible = false;
  }

  /** Start a pass from `side` (+1 from the right), sweeping through the web at height `y`. */
  start(side: number, y: number) {
    this.side = side;
    // a quadratic curve only reaches halfway to its control point: this one puts the midpoint of
    // the pass right at the web plane (z = 0), coming from behind and leaving behind
    this.a.set(side * 2.6, y + 0.55, -1.7);
    this.b.set(0, y - 0.1, 1.7);
    this.c.set(-side * 2.6, y + 0.4, -1.5);
    this.t = 0;
    this.k = 0;
    this.active = true;
    this.group.visible = true;
    this.at(0, this.pos);
    this.prev.copy(this.pos);
    this.flap = Math.random() * 6;
  }

  private at(k: number, out: Vector3) {
    // a quadratic curve: in from the side, through the web, out the other side
    const u = 1 - k;
    out.set(
      u * u * this.a.x + 2 * u * k * this.b.x + k * k * this.c.x,
      u * u * this.a.y + 2 * u * k * this.b.y + k * k * this.c.y,
      u * u * this.a.z + 2 * u * k * this.b.z + k * k * this.c.z,
    );
    return out;
  }

  update(dt: number) {
    if (!this.active) return;
    this.t += dt;
    this.k = Math.min(1, this.t / this.dur);
    this.prev.copy(this.pos);
    this.at(this.k, this.pos);
    this.group.position.copy(this.pos);
    // heading along the path, banked into the turn
    const ahead = this.at(Math.min(1, this.k + 0.02), this.a.clone());
    this.group.lookAt(ahead);
    this.group.rotateZ(-this.side * 0.35 * Math.sin(this.k * Math.PI));
    // a slow, deep flap on the way in, a glide through the web, a flap on the way out
    this.flap += dt * 9;
    const glide = Math.exp(-Math.pow((this.k - 0.5) / 0.18, 2));
    const f = Math.sin(this.flap) * 0.55 * (1 - glide * 0.8);
    for (const w of this.wings) w.rotation.z = Math.sign(w.scale.x) * (f + 0.1);
    this.tail.rotation.y = Math.sin(this.flap * 0.5) * 0.15;
    if (this.k >= 1) {
      this.active = false;
      this.group.visible = false;
    }
  }
}
