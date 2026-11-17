import * as THREE from 'three';
import { HALF } from './terrain.js';

/* Camara RTS isometrica: WASD/flechas/bordes, Q/E o boton central para rotar, rueda con inercia */
export class RTSCamera {
  constructor(camera, dom, terrain) {
    this.camera = camera; this.dom = dom; this.terrain = terrain;
    this.target = new THREE.Vector3(0, 0, 0);
    this.yaw = Math.PI * 0.25;
    this.zoom = 0.35; this.zoomVel = 0;
    this.keys = new Set(); this.enabled = true;
    this.mouse = { x: -1, y: -1, inside: false, rotating: false };
    this.bookmarks = {}; this.lastNum = { key: null, t: 0 };
    this.onCenterBase = null;
    this._bind();
  }

  _bind() {
    this._kd = (e) => {
      if (!this.enabled || e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (/^[1-9]$/.test(e.key)) {
        if (e.ctrlKey) { this.bookmarks[e.key] = { x: this.target.x, z: this.target.z, yaw: this.yaw, zoom: this.zoom }; e.preventDefault(); }
        else if (this.bookmarks[e.key]) {
          const now = performance.now(), b = this.bookmarks[e.key];
          if (this.lastNum.key === e.key && now - this.lastNum.t < 350) { this.target.x = b.x; this.target.z = b.z; this.yaw = b.yaw; this.zoom = b.zoom; }
          else { this.target.x = b.x; this.target.z = b.z; }
          this.lastNum = { key: e.key, t: now };
        }
      }
      if (k === 'h' && this.onCenterBase) this.onCenterBase();
    };
    this._ku = (e) => this.keys.delete(e.key.toLowerCase());
    this._bl = () => this.keys.clear();
    this._mu = (e) => { if (e.button === 1) this.mouse.rotating = false; };
    addEventListener('keydown', this._kd);
    addEventListener('keyup', this._ku);
    addEventListener('blur', this._bl);
    addEventListener('mouseup', this._mu);
    this.dom.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true;
      if (this.mouse.rotating) this.yaw -= e.movementX * 0.005;
    });
    this.dom.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    this.dom.addEventListener('mousedown', (e) => { if (e.button === 1) { this.mouse.rotating = true; e.preventDefault(); } });
    this.dom.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomVel += Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0009; }, { passive: false });
    this.dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  dispose() {
    removeEventListener('keydown', this._kd); removeEventListener('keyup', this._ku);
    removeEventListener('blur', this._bl); removeEventListener('mouseup', this._mu);
  }

  get dist() { return 18 + Math.pow(this.zoom, 1.4) * 170; }
  get pitch() { return 0.5 + this.zoom * 0.65; }

  focus(x, z) { this.target.x = x; this.target.z = z; }

  update(dt) {
    if (this.enabled) {
      const k = this.keys; let mx = 0, mz = 0;
      if (k.has('w') || k.has('arrowup')) mz += 1;
      if (k.has('s') || k.has('arrowdown')) mz -= 1;
      if (k.has('d') || k.has('arrowright')) mx += 1;
      if (k.has('a') || k.has('arrowleft')) mx -= 1;
      if (this.mouse.inside && !this.mouse.rotating) {
        const m = 10;
        if (this.mouse.x <= m) mx -= 1;
        if (this.mouse.x >= innerWidth - m) mx += 1;
        if (this.mouse.y <= m) mz += 1;
        if (this.mouse.y >= innerHeight - m) mz -= 1;
      }
      if (k.has('q')) this.yaw += 1.8 * dt;
      if (k.has('e')) this.yaw -= 1.8 * dt;
      if (mx || mz) {
        const l = Math.hypot(mx, mz), speed = this.dist * 1.15 * (k.has('shift') ? 2 : 1);
        const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
        this.target.x += (fx * mz + -fz * mx) * speed * dt / l;
        this.target.z += (fz * mz + fx * mx) * speed * dt / l;
      }
    }
    this.zoom = Math.min(1, Math.max(0, this.zoom + this.zoomVel));
    this.zoomVel *= Math.exp(-9 * dt);
    const lim = HALF - 20;
    this.target.x = Math.min(lim, Math.max(-lim, this.target.x));
    this.target.z = Math.min(lim, Math.max(-lim, this.target.z));
    const gh = Math.max(0, this.terrain.heightAt(this.target.x, this.target.z));
    this.target.y += (gh - this.target.y) * Math.min(1, dt * 6);
    const d = this.dist, p = this.pitch;
    this.camera.position.set(
      this.target.x + Math.cos(p) * Math.sin(this.yaw) * d,
      this.target.y + Math.sin(p) * d,
      this.target.z + Math.cos(p) * Math.cos(this.yaw) * d);
    this.camera.lookAt(this.target);
  }
}
