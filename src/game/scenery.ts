// Light, reflections, rain and the few words on screen.

import {
  AmbientLight,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CustomBlending,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  Vector3,
  WebGLRenderer,
} from '@iwsdk/core';
import { fillDir, sunCol, sunDir } from './render.js';
export { sunCol };

/** A small studio for reflections: warm low sun behind the web, a cool window to one side, dark room. */
export function makeEnvironment(renderer: WebGLRenderer): Texture | null {
  try {
    const s = new Scene();
    const room = new Mesh(new SphereGeometry(10, 32, 16), new MeshBasicMaterial({ color: new Color(0.035, 0.03, 0.026), side: BackSide }));
    s.add(room);
    const floorGlow = new Mesh(new PlaneGeometry(30, 30), new MeshBasicMaterial({ color: new Color(0.06, 0.05, 0.04) }));
    floorGlow.rotation.x = -Math.PI / 2;
    floorGlow.position.y = -3;
    s.add(floorGlow);
    const panel = (dir: Vector3, w: number, h: number, c: Color) => {
      const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: c, side: 2 }));
      m.position.copy(dir).multiplyScalar(8);
      m.lookAt(0, 0, 0);
      s.add(m);
    };
    panel(sunDir, 2.2, 2.2, new Color(sunCol).multiplyScalar(14));
    panel(fillDir, 4, 5, new Color(0.45, 0.55, 0.7).multiplyScalar(1.6));
    panel(new Vector3(0, 1, 0.2).normalize(), 6, 6, new Color(0.18, 0.16, 0.14));
    const pm = new PMREMGenerator(renderer);
    const tex = pm.fromScene(s, 0.035).texture;
    pm.dispose();
    return tex;
  } catch (e) {
    console.warn('environment map failed', e);
    return null;
  }
}

export function makeLights(root: Group) {
  const key = new DirectionalLight(sunCol, 2.6);
  key.position.copy(sunDir).multiplyScalar(3);
  const fill = new DirectionalLight(new Color(0.7, 0.8, 1.0), 0.75);
  fill.position.copy(fillDir).multiplyScalar(3);
  const rim = new DirectionalLight(new Color(1, 0.9, 0.8), 0.6);
  rim.position.set(0, 2, 1);
  const amb = new AmbientLight(new Color(0.6, 0.55, 0.5), 0.35);
  root.add(key, key.target, fill, fill.target, rim, rim.target, amb);
  return { key, fill, amb };
}

// ---------------- rain ----------------

/**
 * Rain with depth: real drops, not lines. Each drop is a camera-facing ribbon with a round, bright
 * head and a fading tail, as thick as a drop at any distance (never thinner than a pixel), falling
 * through a column all around the web and between you and it, so near drops pass large and fast
 * and far ones are a fine mist. Drops that land call `onFloor` so the floor can splash.
 */
export class Rain {
  readonly mesh: Mesh;
  private N = 700;
  private p: Float32Array;
  private v: Float32Array;
  private iP: InstancedBufferAttribute;
  private iV: InstancedBufferAttribute;
  private geo: InstancedBufferGeometry;
  intensity = 0;
  private mat: ShaderMaterial;
  onFloor?: (x: number, y: number, z: number) => void;

  constructor() {
    this.p = new Float32Array(this.N * 3);
    this.v = new Float32Array(this.N);
    const g = (this.geo = new InstancedBufferGeometry());
    // a quad: x across the drop (-1..1), y along it (0 at the head, 1 at the tail end)
    g.setAttribute('position', new BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    this.iP = new InstancedBufferAttribute(new Float32Array(this.N * 3), 3);
    this.iP.setUsage(DynamicDrawUsage);
    this.iV = new InstancedBufferAttribute(new Float32Array(this.N * 3), 3);
    g.setAttribute('iP', this.iP);
    g.setAttribute('iV', this.iV);
    const V = this.iV.array as Float32Array;
    for (let i = 0; i < this.N; i++) {
      this.respawn(i, true);
      V[i * 3] = 0.05; // length, set per frame from speed
      V[i * 3 + 1] = 0.3 + Math.pow(Math.random(), 2) * 0.7; // brightness
      V[i * 3 + 2] = Math.random(); // seed
    }
    g.instanceCount = this.N;
    this.mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      uniforms: { uI: { value: 0 }, uSun: { value: new Vector3(0, 0, -1) }, uSunCol: { value: sunCol }, uDown: { value: new Vector3(0, -1, 0) }, uMinW: { value: 0.0012 } },
      vertexShader: /* glsl */ `
        attribute vec3 iP; attribute vec3 iV;
        uniform vec3 uSun; uniform vec3 uDown; uniform float uMinW;
        varying vec2 vUv; varying float vB; varying float vGlow; varying float vScale; varying float vNear;
        void main(){
          vec3 C = (modelMatrix*vec4(iP,1.0)).xyz;
          vec3 toC = cameraPosition - C; float dist = max(length(toC), 1e-4);
          vec3 up = -uDown;
          vec3 side = normalize(cross(up, toC/dist) + vec3(1e-6));
          float w = 0.0013;
          float wr = max(w, dist*uMinW);
          vScale = clamp(w/wr, 0.0, 1.0);
          vNear = smoothstep(1.2, 0.25, dist);
          vec3 P = C + up*(position.y*iV.x) + side*(position.x*wr);
          vUv = position.xy; vB = iV.y;
          // rain is seen best against the light: drops between you and the sun catch it
          vGlow = pow(max(0.0, dot(-toC/dist, uSun)), 4.0);
          gl_Position = projectionMatrix*viewMatrix*vec4(P, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uI; uniform vec3 uSunCol;
        varying vec2 vUv; varying float vB; varying float vGlow; varying float vScale; varying float vNear;
        void main(){
          float x2 = vUv.x*vUv.x;
          float across = 1.0 - x2;
          // a round head that holds the light, and a tail that thins away
          float head = smoothstep(0.22, 0.0, vUv.y) * (1.0 - x2);
          float tail = exp(-vUv.y*3.2) * (1.0 - vUv.y) * across;
          float hi = pow(max(0.0, 1.0 - (vUv.x+0.35)*(vUv.x+0.35)*2.2), 3.0) * head; // a highlight on the head's lit side
          float a = uI * vB * (0.1 + 0.55*vGlow + 0.12*vNear) * (head*0.9 + tail*0.45) * vScale;
          vec3 c = mix(vec3(0.74, 0.8, 0.9), uSunCol*1.6, vGlow) + hi*0.8;
          a = clamp(a, 0.0, 1.0);
          gl_FragColor = vec4(c*a, a);
        }`,
    });
    this.mesh = new Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
  }

  private respawn(i: number, anywhere: boolean) {
    // a column around the web, and some of it between you and the web (z toward the player)
    const r = Math.sqrt(Math.random()) * 1.25;
    const a = Math.random() * Math.PI * 2;
    this.p[i * 3] = Math.cos(a) * r;
    this.p[i * 3 + 1] = anywhere ? -1.2 + Math.random() * 2.8 : 1.5 + Math.random() * 0.7;
    this.p[i * 3 + 2] = Math.min(0.5, Math.sin(a) * r * 0.85 - 0.1);
    this.v[i] = 2.6 + Math.random() * 1.6;
  }

  setSun(worldDir: Vector3) {
    this.mat.uniforms.uSun.value.copy(worldDir);
  }

  update(dt: number, floorY: number) {
    this.mat.uniforms.uI.value = this.intensity;
    this.mesh.visible = this.intensity > 0.01;
    if (!this.mesh.visible) return;
    const P = this.iP.array as Float32Array, V = this.iV.array as Float32Array;
    const n = Math.floor(this.N * (0.35 + 0.65 * this.intensity));
    for (let i = 0; i < this.N; i++) {
      const k = i * 3;
      this.p[k + 1] -= this.v[i] * dt;
      this.p[k] += 0.12 * dt;
      if (this.p[k + 1] < floorY) {
        if (i < n && this.onFloor && Math.random() < 0.3) this.onFloor(this.p[k], floorY, this.p[k + 2]);
        this.respawn(i, false);
      }
      P[k] = this.p[k];
      P[k + 1] = this.p[k + 1];
      P[k + 2] = this.p[k + 2];
      V[k] = 0.03 + this.v[i] * 0.014;
    }
    this.iP.needsUpdate = true;
    this.iV.needsUpdate = true;
    this.geo.instanceCount = n;
  }
}

/** Drops that slip off soaked threads and fall. */
export class Drips {
  readonly N = 80;
  p = new Float32Array(this.N * 3);
  vy = new Float32Array(this.N);
  r = new Float32Array(this.N);
  alive = new Uint8Array(this.N);
  private next = 0;

  spawn(x: number, y: number, z: number, r: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.N;
    this.p.set([x, y, z], i * 3);
    this.vy[i] = 0;
    this.r[i] = r;
    this.alive[i] = 1;
  }

  update(dt: number, floorY: number, emit: (x: number, y: number, z: number, r: number) => void) {
    for (let i = 0; i < this.N; i++) {
      if (!this.alive[i]) continue;
      this.vy[i] -= 9.81 * dt;
      this.p[i * 3 + 1] += this.vy[i] * dt;
      if (this.p[i * 3 + 1] < floorY) {
        this.alive[i] = 0;
        continue;
      }
      emit(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2], this.r[i]);
    }
  }
}

// ---------------- words ----------------

/** A line of text on a soft-edged card, drawn with a canvas. Fades with `opacity`. */
export function textCard(lines: { text: string; size: number; spacing?: number; color?: string; font?: string }[], width = 1024, height = 256) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d')!;
  const total = lines.reduce((s, l) => s + l.size * 1.5, 0);
  let y = (height - total) / 2;
  for (const l of lines) {
    y += l.size * 1.5;
    g.font = `${l.font ?? '300'} ${l.size}px "Cormorant Garamond", "Noto Serif", Georgia, serif`;
    g.fillStyle = l.color ?? 'rgba(244,236,222,1)';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    const sp = l.spacing ?? 0;
    if (sp) {
      const chars = [...l.text];
      const w = chars.reduce((s, ch) => s + g.measureText(ch).width + sp, -sp);
      let x = width / 2 - w / 2;
      g.textAlign = 'left';
      for (const ch of chars) {
        g.fillText(ch, x, y - l.size * 0.35);
        x += g.measureText(ch).width + sp;
      }
    } else g.fillText(l.text, width / 2, y - l.size * 0.35);
  }
  const tex = new CanvasTexture(c);
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    uniforms: { map: { value: tex }, uOpacity: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform sampler2D map; uniform float uOpacity; varying vec2 vUv;
      void main(){ vec4 t = texture2D(map, vUv); float a = t.a*uOpacity; gl_FragColor = vec4(t.rgb*a, a); }`,
  });
  const m = new Mesh(new PlaneGeometry(width / height, 1), mat);
  m.renderOrder = 30;
  m.frustumCulled = false;
  return { mesh: m, set: (o: number) => (mat.uniforms.uOpacity.value = o) };
}
