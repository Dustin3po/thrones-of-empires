import * as THREE from 'three';

/* Texturas PBR procedurales y teselables (albedo+rugosidad en alfa, mapa de normales).
   Se generan en CPU con ruido periodico: cero archivos externos. */
const TAU = Math.PI * 2;
const cl = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sm = (a, b, x) => { const t = cl((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function hash(x, y, s) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function pn(x, y, px, py, s) { // ruido de valor periodico
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % px) + px) % px, x1 = (x0 + 1) % px, y0 = ((yi % py) + py) % py, y1 = (y0 + 1) % py;
  const a = hash(x0, y0, s), b = hash(x1, y0, s), c = hash(x0, y1, s), d = hash(x1, y1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(u, v, fx, fy, oct, s) {
  let sum = 0, amp = 0.5, norm = 0, ax = fx, ay = fy;
  for (let o = 0; o < oct; o++) { sum += amp * pn(u * ax, v * ay, ax, ay, s + o * 17); norm += amp; amp *= 0.5; ax *= 2; ay *= 2; }
  return sum / norm;
}

const MATERIALS = {
  grass: {
    size: 256, strength: 14,
    fn(u, v) {
      const broad = fbm(u, v, 4, 4, 4, 1), blades = fbm(u, v, 48, 12, 2, 2), fine = fbm(u, v, 64, 64, 2, 3), patch = fbm(u, v, 3, 3, 3, 9);
      const h = 0.5 * blades + 0.3 * fine + 0.2 * broad;
      let c = mix3([0.09, 0.22, 0.05], [0.34, 0.52, 0.13], cl((h - 0.25) * 2.2));
      c = mix3(c, [0.5, 0.46, 0.18], sm(0.55, 0.8, patch) * 0.45);
      return { h, c, rough: 0.92 };
    }
  },
  sand: {
    size: 256, strength: 8,
    fn(u, v) {
      const grain = fbm(u, v, 128, 128, 2, 4), warp = fbm(u, v, 4, 4, 3, 5);
      const ripple = 0.5 + 0.5 * Math.sin(TAU * (v * 14 + warp * 3));
      const h = 0.35 * ripple + 0.65 * grain;
      const c = mix3([0.7, 0.6, 0.42], [0.86, 0.76, 0.55], cl(0.35 + grain * 0.7 - (1 - ripple) * 0.15));
      return { h, c, rough: 0.96 };
    }
  },
  rock: {
    size: 256, strength: 30,
    fn(u, v) {
      const base = fbm(u, v, 6, 6, 5, 6), ridged = 1 - Math.abs(2 * base - 1), strata = 0.5 + 0.5 * Math.sin(TAU * (v * 10 + base * 2.5));
      const h = 0.55 * ridged + 0.25 * strata + 0.2 * fbm(u, v, 32, 32, 3, 7);
      let c = mix3([0.26, 0.24, 0.22], [0.57, 0.52, 0.46], cl(h * 1.15));
      c = mix3(c, [0.5, 0.38, 0.28], strata * 0.25);
      return { h, c, rough: 0.88 };
    }
  },
  snow: {
    size: 256, strength: 6,
    fn(u, v) {
      const h = fbm(u, v, 8, 8, 4, 8) * 0.7 + fbm(u, v, 64, 64, 2, 10) * 0.3;
      return { h, c: mix3([0.88, 0.92, 0.98], [0.97, 0.98, 1.0], cl(h * 1.3)), rough: 0.55 };
    }
  }
};

function makeTex(data, size, colorSpace) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = colorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function build(def) {
  const S = def.size, H = new Float32Array(S * S), alb = new Uint8Array(S * S * 4), nrm = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const o = def.fn(x / S, y / S), i = (y * S + x) * 4;
      H[y * S + x] = o.h;
      alb[i] = Math.round(cl(o.c[0]) * 255); alb[i + 1] = Math.round(cl(o.c[1]) * 255);
      alb[i + 2] = Math.round(cl(o.c[2]) * 255); alb[i + 3] = Math.round(cl(o.rough) * 255);
    }
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const hl = H[y * S + (x + S - 1) % S], hr = H[y * S + (x + 1) % S];
      const hu = H[((y + S - 1) % S) * S + x], hd = H[((y + 1) % S) * S + x];
      let nx = (hl - hr) * def.strength, ny = (hu - hd) * def.strength, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const i = (y * S + x) * 4;
      nrm[i] = Math.round((nx * 0.5 + 0.5) * 255); nrm[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      nrm[i + 2] = Math.round((nz * 0.5 + 0.5) * 255); nrm[i + 3] = 255;
    }
  }
  return { albedo: makeTex(alb, S, THREE.SRGBColorSpace), normal: makeTex(nrm, S, THREE.NoColorSpace) };
}

export function makeTerrainTextures() {
  const out = {};
  for (const k of Object.keys(MATERIALS)) out[k] = build(MATERIALS[k]);
  out.dispose = () => { for (const k of Object.keys(MATERIALS)) { out[k].albedo.dispose(); out[k].normal.dispose(); } };
  return out;
}
