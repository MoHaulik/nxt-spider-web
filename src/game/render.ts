// Silk, dew, the dimmed room and the soft lights: the custom shaders.
// All transparent passes write premultiplied alpha so they composite cleanly over passthrough.

import {
  BackSide,
  BufferAttribute,
  DoubleSide,
  BufferGeometry,
  CanvasTexture,
  Color,
  CustomBlending,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { CAPTURE, MOOR, Web } from './web.js';

export const sunDir = new Vector3(0.25, 0.42, -1).normalize(); // web-local: behind the web, high
export const sunCol = new Color(1.0, 0.86, 0.66);
export const fillDir = new Vector3(-0.5, 0.25, 1).normalize();

const premul = {
  transparent: true,
  side: DoubleSide,
  depthWrite: false,
  blending: CustomBlending,
  blendSrc: OneFactor,
  blendDst: OneMinusSrcAlphaFactor,
  blendSrcAlpha: OneFactor,
  blendDstAlpha: OneMinusSrcAlphaFactor,
} as const;

const spectral = /* glsl */ `
vec3 spectral(float x){ return clamp(0.5 + 0.5*cos(6.28318*(x + vec3(0.0,0.33,0.67))), 0.0, 1.0); }
`;

// ---------------- silk ----------------

export class SilkMesh {
  readonly mesh: Mesh;
  private max: number;
  private aA: BufferAttribute;
  private aB: BufferAttribute;
  private aP: BufferAttribute;
  private aW: BufferAttribute;
  private geo: BufferGeometry;
  readonly uniforms = {
    uSun: { value: new Vector3() },
    uSunCol: { value: sunCol },
    uMinW: { value: 0.0016 },
    uBright: { value: 1 },
  };
  private n = 0;

  constructor(max: number) {
    this.max = max;
    const g = (this.geo = new BufferGeometry());
    const S = new Float32Array(max * 8);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) {
      S.set([0, -1, 0, 1, 1, -1, 1, 1], i * 8);
      const v = i * 4;
      idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
    }
    const dyn = (n: number) => {
      const a = new BufferAttribute(new Float32Array(max * 4 * n), n);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    g.setAttribute('position', new BufferAttribute(new Float32Array(max * 12), 3));
    g.setAttribute('aS', new BufferAttribute(S, 2));
    g.setAttribute('aA', (this.aA = dyn(3)));
    g.setAttribute('aB', (this.aB = dyn(3)));
    g.setAttribute('aP', (this.aP = dyn(4)));
    g.setAttribute('aW', (this.aW = dyn(1)));
    g.setIndex(new BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);

    const mat = new ShaderMaterial({
      ...premul,
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec3 aA; attribute vec3 aB; attribute vec2 aS; attribute vec4 aP; attribute float aW;
        uniform float uMinW;
        varying float vSide; varying vec3 vT; varying vec3 vPos; varying vec4 vP; varying float vW; varying float vScale;
        void main(){
          vec3 A = (modelMatrix*vec4(aA,1.0)).xyz;
          vec3 B = (modelMatrix*vec4(aB,1.0)).xyz;
          vec3 P = mix(A, B, aS.x);
          vec3 T = B - A; float len = length(T);
          T = len > 1e-6 ? T/len : vec3(0.0,1.0,0.0);
          vec3 toC = cameraPosition - P; float dist = max(length(toC), 1e-4);
          vec3 side = normalize(cross(T, toC/dist) + vec3(1e-6));
          float w = aP.x * 2.0;
          float wr = max(w, dist*uMinW);
          vScale = clamp(w/wr, 0.0, 1.0);
          P += side * aS.y * wr * 0.8;
          vSide = aS.y; vT = T; vPos = P; vP = aP; vW = aW;
          gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun; uniform vec3 uSunCol; uniform float uBright;
        varying float vSide; varying vec3 vT; varying vec3 vPos; varying vec4 vP; varying float vW; varying float vScale;
        ${spectral}
        void main(){
          float edge = 1.0 - abs(vSide);
          float a = smoothstep(0.0, 0.75, edge);
          vec3 T = normalize(vT);
          vec3 V = normalize(cameraPosition - vPos);
          vec3 L = normalize(uSun);
          vec3 H = normalize(L + V);
          float th = dot(T, H);
          float an = sqrt(max(0.0, 1.0 - th*th));
          float spec = pow(an, 110.0) * 1.7 + pow(an, 14.0) * 0.22;
          float back = pow(max(0.0, dot(-V, L)), 2.0);
          float g = dot(T, L) + dot(T, V);
          vec3 rainbow = spectral(fract(g * 1.35 + 0.15));
          float health = clamp(vP.y, 0.0, 1.0);
          float kind = floor(vP.z + 0.01);
          float glint = fract(vP.z);
          float fade = vP.w;
          vec3 base = kind > 1.5 ? vec3(0.93, 0.9, 0.82) : vec3(0.86, 0.86, 0.84);
          vec3 col = base * (0.62 + 0.3*back);
          col += uSunCol * spec * (0.7 + back*1.2);
          col += rainbow * pow(an, 40.0) * (0.25 + back*0.9) * 0.9;
          col += uSunCol * vW * pow(an, 30.0) * 0.8;
          col = mix(col * vec3(0.55, 0.5, 0.45), col, smoothstep(0.05, 0.65, health));
          col += vec3(1.0, 0.94, 0.82) * glint * 0.9;
          float alpha = a * vScale * fade * mix(0.35, 1.0, health) * (0.6 + min(0.4, spec*0.5 + glint + vW*0.3));
          alpha = clamp(alpha * uBright, 0.0, 1.0);
          gl_FragColor = vec4(col * alpha, alpha);
        }`,
    });
    this.mesh = new Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  begin() {
    this.n = 0;
  }

  push(ax: number, ay: number, az: number, bx: number, by: number, bz: number, thick: number, hp: number, kindGlint: number, fade: number, wet: number) {
    if (this.n >= this.max) return;
    const i = this.n++ * 4;
    const A = this.aA.array as Float32Array, B = this.aB.array as Float32Array;
    const P = this.aP.array as Float32Array, W = this.aW.array as Float32Array;
    for (let k = 0; k < 4; k++) {
      const v = (i + k) * 3;
      A[v] = ax; A[v + 1] = ay; A[v + 2] = az;
      B[v] = bx; B[v + 1] = by; B[v + 2] = bz;
      const q = (i + k) * 4;
      P[q] = thick; P[q + 1] = hp; P[q + 2] = kindGlint; P[q + 3] = fade;
      W[i + k] = wet;
    }
  }

  pushWeb(w: Web, thickScale = 1) {
    const p = w.p;
    for (let c = 0; c < w.nC; c++) {
      if (!w.cAlive[c]) continue;
      const age = w.time - w.born[c];
      if (age < 0) continue;
      const i = w.ca[c] * 3, j = w.cb[c] * 3;
      const k = w.kind[c];
      const fade = Math.min(1, age / 0.3) * (w.anchored[w.ca[c]] ? 1 : Math.max(0, w.hp[c] * 2));
      const th = w.thick[c] * (k === MOOR ? 1.15 : k === CAPTURE ? 0.8 : 1) * thickScale;
      this.push(p[i], p[i + 1], p[i + 2], p[j], p[j + 1], p[j + 2], th, w.hp[c], k + Math.min(0.95, w.glint[c] * 0.95), fade, w.cwet[c]);
    }
  }

  end() {
    for (const a of [this.aA, this.aB, this.aP, this.aW]) {
      a.needsUpdate = true;
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * 4 * a.itemSize);
    }
    this.geo.setDrawRange(0, this.n * 6);
  }
}

// ---------------- dew ----------------

export class DropMesh {
  readonly mesh: Mesh;
  private iPR: InstancedBufferAttribute;
  private geo: InstancedBufferGeometry;
  readonly max: number;
  n = 0;
  readonly uniforms = {
    uSun: { value: new Vector3() },
    uFill: { value: new Vector3() },
    uSunCol: { value: sunCol },
    uMinR: { value: 0.0011 },
    uGlow: { value: 0 },
  };

  constructor(max: number) {
    this.max = max;
    const g = (this.geo = new InstancedBufferGeometry());
    g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    this.iPR = new InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.iPR.setUsage(DynamicDrawUsage);
    g.setAttribute('iPR', this.iPR);
    g.instanceCount = 0;

    const mat = new ShaderMaterial({
      ...premul,
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec4 iPR;
        uniform float uMinR;
        varying vec2 vUv; varying vec3 vRight; varying vec3 vUp; varying vec3 vFwd; varying float vScale; varying float vR;
        void main(){
          vec3 C = (modelMatrix*vec4(iPR.xyz,1.0)).xyz;
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          float dist = length(cameraPosition - C);
          float r = iPR.w;
          float rr = max(r, dist*uMinR);
          vScale = clamp(r/rr, 0.0, 1.0);
          vUv = position.xy; vRight = right; vUp = up; vFwd = normalize(cameraPosition - C); vR = r;
          gl_Position = projectionMatrix * viewMatrix * vec4(C + (right*position.x + up*position.y)*rr, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun; uniform vec3 uFill; uniform vec3 uSunCol; uniform float uGlow;
        varying vec2 vUv; varying vec3 vRight; varying vec3 vUp; varying vec3 vFwd; varying float vScale; varying float vR;
        ${spectral}
        vec3 L;
        vec3 env(vec3 D){
          float s = max(0.0, dot(D, L));
          vec3 col = mix(vec3(0.03,0.028,0.026), vec3(0.34,0.31,0.27), smoothstep(-0.4, 0.7, D.y));
          col += uSunCol * (pow(s, 900.0)*40.0 + pow(s, 40.0)*1.6 + pow(s, 6.0)*0.3);
          col += vec3(0.55,0.68,0.85) * 0.5 * smoothstep(0.86, 0.97, dot(D, normalize(uFill)));
          return col;
        }
        vec3 through(vec3 I, vec3 N, float ior){
          vec3 d1 = refract(I, N, 1.0/ior);
          float chord = -2.0*dot(N, d1);
          vec3 N2 = normalize(N + d1*chord);
          vec3 d2 = refract(d1, -N2, ior);
          return d2;
        }
        void main(){
          float r2 = dot(vUv, vUv);
          if (r2 > 1.0) discard;
          L = normalize(uSun);
          float nz = sqrt(1.0 - r2);
          vec3 N = normalize(vRight*vUv.x + vUp*vUv.y + vFwd*nz);
          vec3 I = -vFwd;
          vec3 dr = through(I, N, 1.331), dg = through(I, N, 1.336), db = through(I, N, 1.343);
          vec3 tr = vec3(
            dot(dr,dr) > 0.0 ? env(dr).r : 0.0,
            dot(dg,dg) > 0.0 ? env(dg).g : 0.0,
            dot(db,db) > 0.0 ? env(db).b : 0.0);
          float fres = 0.02 + 0.98*pow(1.0 - nz, 5.0);
          vec3 refl = env(reflect(I, N));
          vec3 col = mix(tr*0.95, refl, fres);
          float spec = pow(max(0.0, dot(reflect(-L, N), vFwd)), 700.0) * 24.0;
          col += uSunCol * spec;
          float rim = smoothstep(0.78, 0.98, sqrt(r2));
          float back = pow(max(0.0, dot(I, L)), 2.0);
          col += spectral(atan(vUv.y, vUv.x)*0.159 + r2*1.3) * rim * (0.12 + back*0.5);
          col *= 1.0 + uGlow*0.7;
          float alpha = (0.62 + 0.38*fres + min(spec, 1.0)) * vScale;
          alpha *= smoothstep(1.0, 0.92, r2);
          alpha = clamp(alpha, 0.0, 1.0);
          gl_FragColor = vec4(col * alpha, alpha);
        }`,
    });
    this.mesh = new Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
  }

  begin() {
    this.n = 0;
  }

  push(x: number, y: number, z: number, r: number) {
    if (this.n >= this.max) return false;
    (this.iPR.array as Float32Array).set([x, y, z, r], this.n++ * 4);
    return true;
  }

  end() {
    this.iPR.needsUpdate = true;
    this.iPR.clearUpdateRanges();
    this.iPR.addUpdateRange(0, this.n * 4);
    this.geo.instanceCount = this.n;
  }
}

/** Beads on the silk: glue on the capture spiral always, water when it rains (Plateau–Rayleigh spacing). */
export function pushBeads(w: Web, drops: DropMesh, sizeScale: number) {
  const p = w.p;
  for (let c = 0; c < w.nC; c++) {
    if (!w.cAlive[c] || w.born[c] > w.time) continue;
    const k = w.kind[c];
    const wet = w.cwet[c];
    const glue = k === CAPTURE ? 1 : 0;
    if (!glue && wet < 0.04) continue;
    const i = w.ca[c] * 3, j = w.cb[c] * 3;
    const ax = p[i], ay = p[i + 1], az = p[i + 2];
    const ex = p[j] - ax, ey = p[j + 1] - ay, ez = p[j + 2] - az;
    const len = Math.hypot(ex, ey, ez);
    const spacing = wet > 0.04 ? 0.006 + 0.007 * (1 - wet) : 0.0075;
    const n = Math.min(14, Math.floor(len / spacing));
    const s = w.seed[c] * 97.13;
    const fade = Math.min(1, (w.time - w.born[c]) / 0.6);
    for (let b = 0; b < n; b++) {
      const h = fract(Math.sin(s + b * 12.9898) * 43758.5453);
      const big = (b * 7 + Math.floor(s)) % 5 === 0 ? 1.6 : 1;
      const r = (glue * 0.00038 * (0.7 + h * 0.6) + wet * 0.0021 * (0.35 + h * 0.9) * big) * sizeScale * fade;
      if (r < 0.00018) continue;
      const t = (b + 0.5 + (h - 0.5) * 0.5) / n;
      if (!drops.push(ax + ex * t, ay + ey * t - r * 0.55, az + ez * t, r)) return;
    }
  }
}

const fract = (x: number) => x - Math.floor(x);

// ---------------- the dimmed room ----------------

/** A sphere around your head that dims the passthrough room: darker away from the web, like a spotlight. */
export function makeDimmer() {
  const mat = new ShaderMaterial({
    ...premul,
    side: BackSide,
    depthTest: false,
    uniforms: { uAmount: { value: 0 }, uFwd: { value: new Vector3(0, 0, -1) }, uFlash: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){ vDir = normalize((modelMatrix*vec4(position,1.0)).xyz - (modelMatrix*vec4(0,0,0,1)).xyz);
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uAmount; uniform vec3 uFwd; uniform float uFlash;
      varying vec3 vDir;
      void main(){
        float f = max(0.0, dot(normalize(vDir), uFwd));
        float a = uAmount * mix(0.86, 0.5, smoothstep(0.55, 0.98, f));
        a = clamp(a - uFlash, 0.0, 1.0);
        vec3 c = vec3(0.035, 0.028, 0.022);
        gl_FragColor = vec4(c*a, a);
      }`,
  });
  const m = new Mesh(new SphereGeometry(6, 32, 16), mat);
  m.renderOrder = -100;
  m.frustumCulled = false;
  return m;
}

// ---------------- soft sprites ----------------

let glowTex: CanvasTexture | null = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.12, 'rgba(255,245,225,0.75)');
  gr.addColorStop(0.4, 'rgba(255,220,170,0.16)');
  gr.addColorStop(1, 'rgba(255,200,150,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  glowTex = new CanvasTexture(c);
  return glowTex;
}

/** A star glint: soft core plus two thin diffraction spikes. */
export function starTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.06, 'rgba(255,240,215,0.8)');
  gr.addColorStop(0.25, 'rgba(255,215,160,0.1)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  g.globalCompositeOperation = 'lighter';
  for (const [w, h] of [[256, 3], [3, 256]]) {
    const l = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    l.addColorStop(0, 'rgba(255,245,230,0.9)');
    l.addColorStop(1, 'rgba(255,245,230,0)');
    g.fillStyle = l;
    g.fillRect(128 - w / 2, 128 - h / 2, w, h);
  }
  return new CanvasTexture(c);
}

export function spriteMaterial(tex: CanvasTexture, color = new Color(1, 1, 1)) {
  return new ShaderMaterial({
    ...premul,
    depthTest: true,
    uniforms: { map: { value: tex }, uColor: { value: color }, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){
        vUv = uv;
        vec3 C = (modelMatrix*vec4(0,0,0,1)).xyz;
        float s = length(modelMatrix[0].xyz);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        gl_Position = projectionMatrix * viewMatrix * vec4(C + (right*position.x + up*position.y)*s, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform vec3 uColor; uniform float uOpacity;
      varying vec2 vUv;
      void main(){
        vec4 t = texture2D(map, vUv);
        float a = t.a * uOpacity;
        gl_FragColor = vec4(t.rgb * uColor * a, a * 0.85);
      }`,
  });
}
