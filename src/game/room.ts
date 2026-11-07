// Your room holds the web up. We read the planes the headset has found (floor, ceiling, walls,
// tables, sofas) and cast rays out across the web plane: where a ray meets a real surface, a frame
// line is tied there. The floor is always real (local-floor), so a web can always be strung.

import { Matrix4, Vector3 } from '@iwsdk/core';

export type Anchor = { pos: Vector3; label: string; angle: number };
export type Room = { ceilY: number; floorY: number; anchors: Anchor[]; planes: number };

type P = { m: Matrix4; inv: Matrix4; n: Vector3; o: Vector3; poly: { x: number; z: number }[]; label: string; horizontal: boolean };

function inPoly(x: number, z: number, poly: { x: number; z: number }[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** `toLocal` maps world (reference space) into the web frame. `floorLocalY` is where y=0 lands. */
export function scanRoom(frame: XRFrame | null, ref: XRReferenceSpace | null, toLocal: Matrix4, floorLocalY: number): Room {
  const planes: P[] = [];
  const set = (frame as unknown as { detectedPlanes?: Set<XRPlane> })?.detectedPlanes;
  if (frame && ref && set) {
    for (const pl of set) {
      const pose = frame.getPose(pl.planeSpace, ref);
      if (!pose) continue;
      const m = new Matrix4().fromArray(pose.transform.matrix).premultiply(toLocal);
      const n = new Vector3().setFromMatrixColumn(m, 1).normalize();
      const o = new Vector3().setFromMatrixPosition(m);
      planes.push({
        m,
        inv: m.clone().invert(),
        n,
        o,
        poly: pl.polygon.map((p) => ({ x: p.x, z: p.z })),
        label: (pl as XRPlane & { semanticLabel?: string }).semanticLabel ?? pl.orientation ?? 'surface',
        horizontal: Math.abs(n.y) > 0.8,
      });
    }
  }

  const cast = (d: Vector3, maxT: number) => {
    let best: { t: number; label: string } | null = null;
    const h = new Vector3();
    for (const pl of planes) {
      const den = d.dot(pl.n);
      if (Math.abs(den) < 1e-3) continue;
      const t = pl.o.dot(pl.n) / den;
      if (t < 0.25 || t > maxT || (best && t > best.t)) continue;
      h.copy(d).multiplyScalar(t).applyMatrix4(pl.inv);
      // a little grace at the edges of a detected plane
      if (!inPoly(h.x, h.z, pl.poly) && !inPoly(h.x * 0.92, h.z * 0.92, pl.poly)) continue;
      best = { t, label: pl.label };
    }
    return best;
  };

  const up = cast(new Vector3(0, 1, 0), 3.5);
  const ceilY = up ? up.t : Math.max(1.15, 2.45 + floorLocalY);
  const down = cast(new Vector3(0, -1, 0), 3);
  const floorY = down && down.label !== 'table' ? -down.t : floorLocalY;

  const cands: Anchor[] = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2 - Math.PI;
    const deg = (a * 180) / Math.PI;
    if (deg > 62 && deg < 118) continue; // straight up belongs to the dragline
    const d = new Vector3(Math.cos(a), Math.sin(a), 0);
    let hit = cast(d, 2.4);
    if (!hit && d.y < -0.15) hit = { t: floorY / d.y, label: 'floor' };
    if (!hit && d.y > 0.25) {
      const t = ceilY / d.y;
      if (t < 2.6) hit = { t, label: up ? 'ceiling' : 'above' };
    }
    if (!hit || hit.t > 2.6) continue;
    cands.push({ pos: d.multiplyScalar(hit.t), label: hit.label, angle: a });
  }
  // prefer real surfaces, then short lines; keep them well spread around the web
  const score = (c: Anchor) => (c.label === 'above' ? 3 : 0) + c.pos.length() * 0.6 + (c.label === 'floor' ? 0.35 : 0);
  cands.sort((a, b) => score(a) - score(b));
  const picked: Anchor[] = [];
  const sep = (55 * Math.PI) / 180;
  for (const c of cands) {
    if (picked.length >= 5) break;
    if (picked.every((p) => Math.abs(Math.atan2(Math.sin(p.angle - c.angle), Math.cos(p.angle - c.angle))) > sep)) picked.push(c);
  }
  picked.sort((a, b) => a.angle - b.angle);
  return { ceilY, floorY, anchors: picked, planes: planes.length };
}
