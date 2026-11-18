import * as THREE from 'three';

/* Atmosfera: cupula de cielo procedural (gradiente, sol, luna, estrellas, nubes) y ciclo dia/noche
   que gobierna la luz direccional, la luz hemisferica y los colores de agua y terreno. */
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const VERT = `
varying vec3 vDir;
void main(){
  vDir = position;
  gl_Position = projectionMatrix*modelViewMatrix*vec4(position, 1.0);
}`;

const FRAG = `
uniform vec3 uSunDir, uZenith, uHorizon, uSunColor;
uniform float uNight, uDay, uTime;
varying vec3 vDir;
float h31(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719)))*43758.5453); }
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453); }
float vn(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float cfbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a*vn(p); p = p*2.03 + 7.1; a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float e = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(e, 0.0, 1.0), 0.5));
  col = mix(col, uHorizon*0.7, 1.0 - smoothstep(-0.25, 0.0, e));
  float s = max(dot(d, uSunDir), 0.0);
  col += vec3(1.0, 0.75, 0.5)*pow(s, 5.0)*0.28*(1.0 - uNight);
  col += uSunColor*smoothstep(0.9993, 0.99985, s)*25.0*(1.0 - uNight);
  float m = max(dot(d, -uSunDir), 0.0);
  col += vec3(0.75, 0.82, 1.0)*smoothstep(0.9994, 0.9997, m)*3.0*uNight;
  if (uNight > 0.02 && e > 0.02) {
    vec3 q = floor(d*240.0);
    float r = h31(q);
    float st = step(0.9965, r)*(0.6 + 0.4*sin(uTime*2.0 + r*60.0));
    col += vec3(st)*uNight*smoothstep(0.02, 0.2, e);
  }
  if (e > 0.0) {
    vec2 cp = d.xz/(e + 0.12)*0.9 + vec2(uTime*0.01, uTime*0.004);
    float c = cfbm(cp*1.6);
    float cl = smoothstep(0.52, 0.78, c)*smoothstep(0.0, 0.18, e);
    vec3 cc = mix(vec3(0.18, 0.2, 0.28), vec3(0.9, 0.88, 0.86), uDay) + uSunColor*0.3*pow(s, 3.0)*(1.0 - uNight);
    col = mix(col, cc, cl*0.85);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Atmosphere {
  constructor(scene, sun, hemi, renderer) {
    this.scene = scene; this.sun = sun; this.hemi = hemi; this.renderer = renderer;
    this.time = 0.38;          // fraccion del dia: 0.25 amanecer, 0.5 mediodia, 0.75 atardecer
    this.auto = false;
    this.speed = 1 / 240;      // un dia completo cada 4 minutos cuando el ciclo esta activo
    this.sunDir = new THREE.Vector3(); this.lightDir = new THREE.Vector3(); this.lightColor = new THREE.Color();
    this.day = 1; this.night = 0; this.specI = 1;
    this.u = {
      uSunDir: { value: this.sunDir }, uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() }, uNight: { value: 0 }, uDay: { value: 1 }, uTime: { value: 0 }
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.u, vertexShader: VERT, fragmentShader: FRAG,
      side: THREE.BackSide, depthTest: false, depthWrite: false
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), this.mat);
    this.dome.renderOrder = -100; this.dome.frustumCulled = false;
    scene.add(this.dome);
    this.compute();
  }

  compute() {
    const ang = (this.time - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.cos(ang) * 0.85, Math.sin(ang), 0.45).normalize();
    const el = this.sunDir.y;
    this.day = sm(-0.08, 0.22, el);
    this.night = sm(0.05, -0.25, el);
    const dusk = Math.exp(-Math.pow((el - 0.04) / 0.16, 2));

    const sunCol = lerp3([1.0, 0.5, 0.22], [1.0, 0.95, 0.85], sm(0.02, 0.5, el));
    const sunI = 3.0 * sm(-0.03, 0.3, el), moonI = 0.35 * sm(-0.03, -0.3, el);
    if (el > -0.03) {
      this.lightDir.copy(this.sunDir); this.lightColor.setRGB(sunCol[0], sunCol[1], sunCol[2]); this.sun.intensity = sunI;
    } else {
      this.lightDir.copy(this.sunDir).negate(); this.lightColor.setRGB(0.55, 0.65, 1.0); this.sun.intensity = moonI;
    }
    this.sun.color.copy(this.lightColor);
    const hs = lerp3([0.04, 0.06, 0.14], [0.74, 0.85, 1.0], this.day);
    const hg = lerp3([0.05, 0.05, 0.07], [0.35, 0.29, 0.2], this.day);
    this.hemi.color.setRGB(hs[0], hs[1], hs[2]); this.hemi.groundColor.setRGB(hg[0], hg[1], hg[2]);
    this.hemi.intensity = 0.14 + 0.5 * this.day;

    const z = lerp3([0.005, 0.01, 0.04], [0.1, 0.3, 0.75], this.day);
    let hz = lerp3([0.02, 0.03, 0.07], [0.6, 0.75, 0.9], this.day);
    hz = lerp3(hz, [1.0, 0.42, 0.18], dusk * 0.7 * (1 - this.night * 0.5));
    this.u.uZenith.value.setRGB(z[0], z[1], z[2]);
    this.u.uHorizon.value.setRGB(hz[0], hz[1], hz[2]);
    this.u.uSunColor.value.setRGB(sunCol[0], sunCol[1], sunCol[2]);
    this.u.uNight.value = this.night; this.u.uDay.value = this.day;
    this.specI = Math.max(this.day, (moonI / 0.35) * 0.15);
    this.renderer.toneMappingExposure = 0.95;
  }

  update(dt, target, camera) {
    if (this.auto) this.time = (this.time + dt * this.speed) % 1;
    this.u.uTime.value += dt;
    this.compute();
    this.sun.position.set(target.x + this.lightDir.x * 220, target.y + this.lightDir.y * 220, target.z + this.lightDir.z * 220);
    this.sun.target.position.copy(target); this.sun.target.updateMatrixWorld();
    this.dome.position.copy(camera.position);
  }

  label() {
    const h = this.time * 24, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    return (this.sunDir.y > 0 ? '☀ ' : '☾ ') + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  }

  dispose() { this.scene.remove(this.dome); this.dome.geometry.dispose(); this.mat.dispose(); }
}
