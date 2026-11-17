import * as THREE from 'three';
import { makeNoise } from './noise.js';

export const CHUNK = 64;            // unidades por chunk
export const WORLD_CHUNKS = 24;     // 24x24 chunks = 1536 x 1536 unidades
export const HALF = (CHUNK * WORLD_CHUNKS) / 2;
export const VIEW_RADIUS = 8;       // chunks visibles alrededor del foco

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (c, r, g, b, t) => { c[0] += (r - c[0]) * t; c[1] += (g - c[1]) * t; c[2] += (b - c[2]) * t; };

export class Terrain {
  constructor(seed) {
    this.seed = seed;
    this.n1 = makeNoise(seed);
    this.n2 = makeNoise((seed ^ 0x9e3779b9) >>> 0);
    this.n3 = makeNoise((seed + 7919) >>> 0);
  }

  /* Altura: continentes + cordilleras ridged + rios + archipielagos + borde oceanico */
  heightAt(x, z) {
    const c = this.n1.fbm(x * 0.0011, z * 0.0011, 4);
    const ridge = 1 - Math.abs(this.n1.noise2(x * 0.004 + 50, z * 0.004 - 50));
    const mtMask = smooth(0.0, 0.45, c + 0.25);
    let h = c * 16 + 4 + ridge * ridge * ridge * 58 * mtMask + this.n2.fbm(x * 0.03, z * 0.03, 3) * 1.6;
    const river = 1 - smooth(0.0, 0.035, Math.abs(this.n3.noise2(x * 0.0028, z * 0.0028)));
    h += (-3 - h) * river * (1 - mtMask * 0.85);
    const d = Math.max(Math.abs(x), Math.abs(z)) / HALF;
    const edge = smooth(0.72, 0.98, d);
    return h + (-14 - h) * edge;
  }

  /* Color por bioma: lecho, arena, pasto, estepa seca, roca y nieve */
  colorAt(h, slope, x, z) {
    const v = this.n2.noise2(x * 0.08, z * 0.08) * 0.5 + 0.5;
    const v2 = this.n3.noise2(x * 0.4, z * 0.4) * 0.5 + 0.5;
    const c = [0.16, 0.27, 0.32];
    mix(c, 0.78, 0.70, 0.5, smooth(-2.5, -0.5, h));
    mix(c, 0.2 + 0.12 * v, 0.4 + 0.14 * v2, 0.13, smooth(0.8, 2.4, h));
    mix(c, 0.52, 0.47 + 0.05 * v, 0.26, smooth(9, 19, h + v * 5) * 0.8);
    const rock = Math.max(smooth(0.3, 0.55, slope), smooth(30, 40, h + v * 4));
    mix(c, 0.4 + 0.1 * v, 0.38 + 0.08 * v, 0.36 + 0.06 * v2, rock);
    mix(c, 0.95, 0.96, 0.98, smooth(46, 54, h + v * 5) * (1 - smooth(0.6, 0.9, slope) * 0.5));
    return c;
  }

  /* Busca un punto de aparicion en tierra firme cerca del centro */
  findSpawn(index = 0) {
    const a0 = index * 1.7;
    for (let r = 20; r < HALF * 0.6; r += 12) {
      for (let k = 0; k < 24; k++) {
        const a = a0 + (k / 24) * Math.PI * 2;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const h = this.heightAt(x, z);
        if (h > 2 && h < 8 && this.heightAt(x + 14, z) > 1.5 && this.heightAt(x - 14, z) > 1.5 &&
            this.heightAt(x, z + 14) > 1.5 && this.heightAt(x, z - 14) > 1.5) return { x, z };
      }
    }
    return { x: 0, z: 0 };
  }
}

export class ChunkManager {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.chunks = new Map();
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    this.group = new THREE.Group();
    scene.add(this.group);
    this.limit = WORLD_CHUNKS / 2;
  }

  lodFor(dist) { return dist < 2.5 ? 32 : dist < 5 ? 16 : 8; }

  buildGeometry(cx, cz, res) {
    const T = this.terrain, step = CHUNK / res, ox = cx * CHUNK, oz = cz * CHUNK, W = res + 3;
    const H = new Float32Array(W * W);
    for (let j = -1; j <= res + 1; j++)
      for (let i = -1; i <= res + 1; i++) H[(j + 1) * W + i + 1] = T.heightAt(ox + i * step, oz + j * step);
    const at = (i, j) => H[(j + 1) * W + i + 1];

    const side = res + 1, N = side * side, nv = N + 4 * side;
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
    const idx = [];
    for (let j = 0; j <= res; j++) {
      for (let i = 0; i <= res; i++) {
        const k = j * side + i, x = ox + i * step, z = oz + j * step, y = at(i, j);
        let nx = at(i - 1, j) - at(i + 1, j), ny = 2 * step, nz = at(i, j - 1) - at(i, j + 1);
        const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
        pos.set([x, y, z], k * 3); nor.set([nx, ny, nz], k * 3);
        col.set(T.colorAt(y, 1 - ny, x, z), k * 3);
        if (i < res && j < res) idx.push(k, k + side, k + 1, k + 1, k + side, k + side + 1);
      }
    }
    // Faldones (skirts) para ocultar grietas entre LODs distintos
    const edges = [[], [], [], []];
    for (let t = 0; t <= res; t++) { edges[0].push(t); edges[1].push(res * side + t); edges[2].push(t * side); edges[3].push(t * side + res); }
    let s = N;
    for (const e of edges) {
      const base = s;
      for (let k = 0; k < e.length; k++, s++) {
        const o = e[k] * 3;
        pos.set([pos[o], pos[o + 1] - 6, pos[o + 2]], s * 3);
        nor.set([nor[o], nor[o + 1], nor[o + 2]], s * 3);
        col.set([col[o], col[o + 1], col[o + 2]], s * 3);
        if (k < e.length - 1) idx.push(e[k], e[k + 1], base + k + 1, e[k], base + k + 1, base + k);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  /* Carga/descarga chunks alrededor del foco; devuelve cuantos faltan por construir */
  update(fx, fz, budget = 3) {
    const ccx = Math.floor(fx / CHUNK), ccz = Math.floor(fz / CHUNK);
    const wanted = [];
    for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
      for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
        const cx = ccx + dx, cz = ccz + dz;
        if (cx < -this.limit || cx >= this.limit || cz < -this.limit || cz >= this.limit) continue;
        const dist = Math.hypot(dx, dz);
        if (dist > VIEW_RADIUS) continue;
        wanted.push({ cx, cz, dist });
      }
    }
    wanted.sort((a, b) => a.dist - b.dist);
    const keep = new Set();
    let pending = 0;
    for (const w of wanted) {
      const key = w.cx + ',' + w.cz;
      keep.add(key);
      const res = this.lodFor(w.dist);
      const ch = this.chunks.get(key);
      if (ch && ch.res === res) continue;
      if (budget <= 0) { pending++; continue; }
      budget--;
      const geo = this.buildGeometry(w.cx, w.cz, res);
      if (ch) { ch.mesh.geometry.dispose(); ch.mesh.geometry = geo; ch.res = res; }
      else {
        const mesh = new THREE.Mesh(geo, this.material);
        mesh.receiveShadow = true; mesh.castShadow = true;
        this.group.add(mesh);
        this.chunks.set(key, { mesh, res });
      }
    }
    for (const [key, ch] of this.chunks) {
      if (!keep.has(key)) { this.group.remove(ch.mesh); ch.mesh.geometry.dispose(); this.chunks.delete(key); }
    }
    return pending;
  }

  dispose() {
    for (const ch of this.chunks.values()) { this.group.remove(ch.mesh); ch.mesh.geometry.dispose(); }
    this.chunks.clear();
    this.scene.remove(this.group);
    this.material.dispose();
  }
}
