import * as THREE from 'three';
import { makeTerrainTextures } from './textures.js';

/* Material de terreno PBR: splatting de 4 materiales (cesped, arena, roca, nieve) con
   mapas de normales, mapeo triplanar para la roca, variacion macro anti-repeticion y
   caustticas submarinas. Se inyecta sobre MeshStandardMaterial para conservar luces y sombras. */
const COMMON_FRAG = `#include <common>
uniform float uTime;
uniform float uSunI;
uniform sampler2D tGrassA, tSandA, tRockA, tSnowA, tGrassN, tSandN, tRockN, tSnowN;
varying vec4 vSplat;
varying vec3 vWPos;
varying vec3 vWNrm;
vec4 triA(sampler2D t, vec3 p, vec3 n, float s){
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z + 1e-4);
  return texture2D(t, p.zy*s)*w.x + texture2D(t, p.xz*s)*w.y + texture2D(t, p.xy*s)*w.z;
}
vec3 triN(sampler2D t, vec3 p, vec3 n, float s){
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z + 1e-4);
  vec3 tx = texture2D(t, p.zy*s).xyz*2.0-1.0;
  vec3 ty = texture2D(t, p.xz*s).xyz*2.0-1.0;
  vec3 tz = texture2D(t, p.xy*s).xyz*2.0-1.0;
  tx = vec3(tx.xy + n.zy, abs(tx.z)*n.x);
  ty = vec3(ty.xy + n.xz, abs(ty.z)*n.y);
  tz = vec3(tz.xy + n.xy, abs(tz.z)*n.z);
  return normalize(tx.zyx*w.x + ty.xzy*w.y + tz.xyz*w.z);
}
float caustic(vec2 uv, float t){
  vec2 p = mod(uv*6.28318, 6.28318) - 250.0;
  vec2 i = p; float c = 1.0; float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t*(1.0 - (3.5/float(n+1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0/length(vec2(p.x/(sin(i.x + tt)/inten), p.y/(cos(i.y + tt)/inten)));
  }
  c /= 4.0; c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}`;

const MAP_FRAG = `
vec3 N0 = normalize(vWNrm);
vec4 sw = vSplat; sw /= max(sw.x + sw.y + sw.z + sw.w, 1e-4);
vec2 uvA = vWPos.xz;
vec4 alb = vec4(0.0);
vec3 pw = vec3(0.0);
if (sw.x > 0.01) {
  alb += texture2D(tGrassA, uvA*0.17)*sw.x;
  vec3 t = texture2D(tGrassN, uvA*0.17).xyz*2.0-1.0;
  pw += normalize(N0 + vec3(t.x, 0.0, t.y))*sw.x;
}
if (sw.y > 0.01) {
  alb += texture2D(tSandA, uvA*0.23)*sw.y;
  vec3 t = texture2D(tSandN, uvA*0.23).xyz*2.0-1.0;
  pw += normalize(N0 + vec3(t.x, 0.0, t.y))*sw.y;
}
if (sw.z > 0.01) {
  alb += triA(tRockA, vWPos, N0, 0.11)*sw.z;
  pw += triN(tRockN, vWPos, N0, 0.11)*sw.z;
}
if (sw.w > 0.01) {
  alb += texture2D(tSnowA, uvA*0.14)*sw.w;
  vec3 t = texture2D(tSnowN, uvA*0.14).xyz*2.0-1.0;
  pw += normalize(N0 + vec3(t.x, 0.0, t.y))*sw.w;
}
float macro = texture2D(tGrassA, uvA*0.019 + 3.7).g;
alb.rgb *= 0.8 + 0.6*macro;
vec3 wn = length(pw) > 0.001 ? normalize(pw) : N0;
diffuseColor.rgb = alb.rgb;
vec3 causticAdd = vec3(0.0);
float uwf = 1.0 - smoothstep(-0.4, 0.3, vWPos.y);
if (uwf > 0.0) {
  float cs = caustic(vWPos.xz*0.06, uTime*0.6);
  float dd = clamp(-vWPos.y/9.0, 0.0, 1.0);
  causticAdd = vec3(0.7, 0.95, 1.0)*cs*0.55*(1.0 - dd*0.8)*uSunI*uwf;
}
`;

export function createTerrainMaterial() {
  const T = makeTerrainTextures();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide });
  const uniforms = {
    uTime: { value: 0 }, uSunI: { value: 1 },
    tGrassA: { value: T.grass.albedo }, tGrassN: { value: T.grass.normal },
    tSandA: { value: T.sand.albedo }, tSandN: { value: T.sand.normal },
    tRockA: { value: T.rock.albedo }, tRockN: { value: T.rock.normal },
    tSnowA: { value: T.snow.albedo }, tSnowN: { value: T.snow.normal }
  };
  mat.userData.uniforms = uniforms;
  mat.userData.disposeTextures = () => T.dispose();
  mat.customProgramCacheKey = () => 'toe-terrain-v2';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;\nvWPos = (modelMatrix*vec4(position, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix)*normal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', COMMON_FRAG)
      .replace('#include <map_fragment>', MAP_FRAG)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(alb.a, 0.35, 1.0);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix*vec4(wn, 0.0)).xyz)*faceDirection;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += causticAdd;');
  };
  return mat;
}
