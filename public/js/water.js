import * as THREE from 'three';
import { HALF } from './terrain.js';

/* Agua: olas de Gerstner en el vertex shader, color por profundidad (mapa de alturas del mundo),
   reflejo del cielo con Fresnel, brillo solar, ondulaciones finas y espuma costera/de cresta. */
const VERT = `
uniform float uTime;
uniform sampler2D tHeight;
uniform float uHalf;
varying vec3 vWorld;
varying vec3 vN;
varying float vCrest;
void main(){
  vec3 wp = (modelMatrix*vec4(position, 1.0)).xyz;
  float dist = distance(wp.xz, cameraPosition.xz);
  float fade = 1.0 - smoothstep(300.0, 560.0, dist);
  vec2 huv = wp.xz/(2.0*uHalf) + 0.5;
  float depth = max(-(texture2D(tHeight, huv).r*100.0 - 25.0), 0.0);
  fade *= 0.15 + 0.85*smoothstep(0.0, 2.5, depth);
  vec4 W[4];
  W[0] = vec4( 1.0,  0.2, 0.08, 70.0);
  W[1] = vec4(-0.6,  0.8, 0.07, 38.0);
  W[2] = vec4( 0.3, -1.0, 0.06, 21.0);
  W[3] = vec4(-0.9, -0.5, 0.04, 11.0);
  vec3 pos = wp; vec3 n = vec3(0.0, 1.0, 0.0);
  for (int i = 0; i < 4; i++) {
    vec2 d = normalize(W[i].xy);
    float k = 6.28318/W[i].w;
    float c = sqrt(9.8/k);
    float f = k*(dot(d, wp.xz) - c*uTime);
    float Q = W[i].z*fade;
    float a = Q/k;
    pos.x += d.x*a*cos(f); pos.z += d.y*a*cos(f); pos.y += a*sin(f);
    n.x -= d.x*Q*cos(f); n.z -= d.y*Q*cos(f); n.y -= Q*sin(f);
  }
  vWorld = pos; vN = normalize(n); vCrest = pos.y;
  gl_Position = projectionMatrix*viewMatrix*vec4(pos, 1.0);
}`;

const FRAG = `
uniform float uTime, uHalf, uSunI, uSpecI;
uniform sampler2D tHeight;
uniform vec3 uSunDir, uSunColor, uHorizon, uZenith;
varying vec3 vWorld;
varying vec3 vN;
varying float vCrest;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453); }
float vn(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 skyCol(vec3 d){
  float e = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uHorizon, uZenith, pow(e, 0.5));
  float s = max(dot(d, uSunDir), 0.0);
  c += uSunColor*(pow(s, 900.0)*10.0 + pow(s, 10.0)*0.12)*uSpecI;
  return c;
}
void main(){
  vec2 huv = vWorld.xz/(2.0*uHalf) + 0.5;
  float h = texture2D(tHeight, huv).r*100.0 - 25.0;
  float depth = max(-h, 0.0);
  vec3 N = normalize(vN);
  vec2 p = vWorld.xz;
  vec2 r1 = vec2(vn(p*0.8 + vec2(uTime*0.5, 0.0)), vn(p*0.8 + vec2(31.4, -uTime*0.45))) - 0.5;
  vec2 r2 = vec2(vn(p*2.9 + vec2(-uTime*0.8, 7.0)), vn(p*2.9 + vec2(5.0, uTime*0.7))) - 0.5;
  N = normalize(N + vec3(r1.x + r2.x*0.6, 0.0, r1.y + r2.y*0.6)*0.45);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = 0.02 + 0.98*pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  vec3 refl = skyCol(R);
  float dm = 1.0 - exp(-depth*0.3);
  float lit = 0.18 + 0.82*uSunI;
  vec3 body = mix(vec3(0.10, 0.42, 0.45), vec3(0.015, 0.13, 0.26), dm)*lit;
  vec3 col = mix(body, refl, clamp(fres, 0.0, 1.0));
  vec3 Hh = normalize(V + uSunDir);
  col += uSunColor*pow(max(dot(N, Hh), 0.0), 220.0)*2.5*uSpecI;
  float shore = (1.0 - smoothstep(0.0, 1.5, depth))*(1.0 - smoothstep(0.15, 0.45, h));
  float fn = vn(p*1.6 + uTime*0.25)*0.6 + vn(p*4.7 - uTime*0.18)*0.4;
  float band = 0.5 + 0.5*sin(depth*5.5 - uTime*1.5 + fn*4.0);
  float foam = shore*smoothstep(0.32, 0.8, fn*0.55 + band*0.5);
  foam += smoothstep(0.55, 0.95, vCrest)*smoothstep(0.45, 0.8, fn)*0.8*step(0.5, depth);
  foam = clamp(foam, 0.0, 1.0);
  col = mix(col, vec3(0.92, 0.96, 1.0)*(0.25 + 0.75*uSunI), foam*0.85);
  float alpha = mix(0.0, 0.95, smoothstep(0.0, 2.2, depth));
  alpha = max(alpha, foam*0.9);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Water {
  constructor(scene, heights, S, atmo) {
    this.scene = scene;
    const data = new Uint8Array(S * S);
    for (let i = 0; i < data.length; i++) data[i] = Math.max(0, Math.min(255, Math.round((heights[i] + 25) / 100 * 255)));
    this.heightTex = new THREE.DataTexture(data, S, S, THREE.RedFormat, THREE.UnsignedByteType);
    this.heightTex.magFilter = this.heightTex.minFilter = THREE.LinearFilter;
    this.heightTex.wrapS = this.heightTex.wrapT = THREE.ClampToEdgeWrapping;
    this.heightTex.unpackAlignment = 1;
    this.heightTex.needsUpdate = true;
    this.uniforms = {
      uTime: { value: 0 }, uHalf: { value: HALF }, tHeight: { value: this.heightTex },
      uSunI: { value: 1 }, uSpecI: { value: 1 },
      uSunDir: { value: atmo.lightDir }, uSunColor: { value: atmo.lightColor },
      uHorizon: atmo.u.uHorizon, uZenith: atmo.u.uZenith
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide
    });
    const nearGeo = new THREE.PlaneGeometry(1200, 1200, 300, 300); nearGeo.rotateX(-Math.PI / 2);
    const farGeo = new THREE.RingGeometry(590, 5000, 96, 1); farGeo.rotateX(-Math.PI / 2);
    this.near = new THREE.Mesh(nearGeo, this.material);
    this.far = new THREE.Mesh(farGeo, this.material);
    for (const m of [this.near, this.far]) { m.frustumCulled = false; m.renderOrder = 1; scene.add(m); }
  }

  update(tx, tz, time, atmo) {
    this.near.position.set(Math.round(tx / 4) * 4, 0, Math.round(tz / 4) * 4);
    this.far.position.set(tx, 0, tz);
    this.uniforms.uTime.value = time;
    this.uniforms.uSunI.value = atmo.day;
    this.uniforms.uSpecI.value = atmo.specI;
  }

  dispose() {
    for (const m of [this.near, this.far]) { this.scene.remove(m); m.geometry.dispose(); }
    this.material.dispose(); this.heightTex.dispose();
  }
}
