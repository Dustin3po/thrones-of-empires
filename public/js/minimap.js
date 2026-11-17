import * as THREE from 'three';
import { HALF } from './terrain.js';

/* Minimapa tactico: terreno prerenderizado + niebla de guerra EXCLUSIVA del minimapa */
export class Minimap {
  constructor(canvas, terrain, size = 384) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    canvas.width = canvas.height = size;
    this.S = size; this.terrain = terrain;
    this.base = document.createElement('canvas'); this.base.width = this.base.height = size;
    this.fog = document.createElement('canvas'); this.fog.width = this.fog.height = size;
    this.dim = document.createElement('canvas'); this.dim.width = this.dim.height = size;
    this.sources = new Map();
    this.markers = [];
    this.onPick = null;
    this.ray = new THREE.Raycaster(); this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const f = this.fog.getContext('2d'); f.fillStyle = '#05080c'; f.fillRect(0, 0, size, size);
    this._bind();
  }

  toPx(x, z) { return [(x / HALF * 0.5 + 0.5) * this.S, (z / HALF * 0.5 + 0.5) * this.S]; }
  toWorld(px, py) { return [(px / this.S - 0.5) * 2 * HALF, (py / this.S - 0.5) * 2 * HALF]; }

  async buildTerrain(onProgress) {
    const S = this.S, ctx = this.base.getContext('2d'), img = ctx.createImageData(S, S), T = this.terrain, d = HALF / S * 2;
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const [x, z] = this.toWorld(px + 0.5, py + 0.5);
        const h = T.heightAt(x, z);
        const shade = 1 + Math.max(-0.35, Math.min(0.35, (T.heightAt(x - d, z - d) - T.heightAt(x + d, z + d)) * 0.06));
        let c;
        if (h < 0) { const t = Math.max(0, 1 + h / 14); c = [0.1 + 0.1 * t, 0.3 + 0.2 * t, 0.5 + 0.18 * t]; }
        else c = T.colorAt(h, 0, x, z).map(v => v * shade);
        const o = (py * S + px) * 4;
        img.data[o] = Math.min(255, c[0] * 255); img.data[o + 1] = Math.min(255, c[1] * 255);
        img.data[o + 2] = Math.min(255, c[2] * 255); img.data[o + 3] = 255;
      }
      if (py % 24 === 0) { if (onProgress) onProgress(py / S); await new Promise(r => setTimeout(r)); }
    }
    ctx.putImageData(img, 0, 0);
  }

  addSource(id, x, z, r) { this.sources.set(id, { x, z, r, lx: 1e9, lz: 1e9 }); }
  updateSource(id, x, z) { const s = this.sources.get(id); if (s) { s.x = x; s.z = z; } }
  setMarker(id, x, z, color) {
    const m = this.markers.find(m => m.id === id);
    if (m) { m.x = x; m.z = z; } else this.markers.push({ id, x, z, color });
  }

  _reveal(s) {
    const f = this.fog.getContext('2d'), [px, py] = this.toPx(s.x, s.z), pr = s.r / HALF * 0.5 * this.S;
    const g = f.createRadialGradient(px, py, pr * 0.65, px, py, pr);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    f.globalCompositeOperation = 'destination-out'; f.fillStyle = g;
    f.beginPath(); f.arc(px, py, pr, 0, Math.PI * 2); f.fill();
    f.globalCompositeOperation = 'source-over';
  }

  _bind() {
    const pick = (e) => {
      const r = this.canvas.getBoundingClientRect();
      const [x, z] = this.toWorld((e.clientX - r.left) / r.width * this.S, (e.clientY - r.top) / r.height * this.S);
      if (this.onPick) this.onPick(x, z);
    };
    this.canvas.addEventListener('pointerdown', (e) => { this.canvas.setPointerCapture(e.pointerId); pick(e); });
    this.canvas.addEventListener('pointermove', (e) => { if (e.buttons & 1) pick(e); });
  }

  draw(camera) {
    const S = this.S, c = this.ctx;
    for (const s of this.sources.values()) {
      if (Math.hypot(s.x - s.lx, s.z - s.lz) > 4) { this._reveal(s); s.lx = s.x; s.lz = s.z; }
    }
    // Zonas exploradas sin vision actual: atenuadas
    const d = this.dim.getContext('2d');
    d.globalCompositeOperation = 'source-over'; d.clearRect(0, 0, S, S);
    d.fillStyle = 'rgba(0,0,0,0.5)'; d.fillRect(0, 0, S, S);
    d.globalCompositeOperation = 'destination-out';
    for (const s of this.sources.values()) {
      const [px, py] = this.toPx(s.x, s.z), pr = s.r / HALF * 0.5 * this.S * 0.8;
      d.beginPath(); d.arc(px, py, pr, 0, Math.PI * 2); d.fill();
    }
    c.clearRect(0, 0, S, S);
    c.drawImage(this.base, 0, 0);
    c.drawImage(this.dim, 0, 0);
    c.drawImage(this.fog, 0, 0);
    for (const m of this.markers) {
      const [px, py] = this.toPx(m.x, m.z);
      c.fillStyle = m.color; c.strokeStyle = '#000'; c.lineWidth = 2;
      c.fillRect(px - 5, py - 5, 10, 10); c.strokeRect(px - 5, py - 5, 10, 10);
    }
    // Trapecio de la camara proyectado al suelo
    const pts = [];
    for (const [nx, ny] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {
      this.ray.setFromCamera({ x: nx, y: ny }, camera);
      const p = new THREE.Vector3();
      if (this.ray.ray.intersectPlane(this.plane, p)) pts.push(this.toPx(p.x, p.z));
    }
    if (pts.length === 4) {
      c.strokeStyle = 'rgba(255,255,255,0.95)'; c.lineWidth = 2; c.beginPath();
      pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]));
      c.closePath(); c.stroke();
    }
  }
}
