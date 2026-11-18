import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* Post-procesado HDR: render MSAA -> Bloom (oro, fuego, sol) -> correccion de color cinematografica
   (saturacion, contraste, sombras frias / luces calidas, vineta) -> tonemapping ACES + sRGB. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: 1.12 }, uContrast: { value: 1.08 }, uVignette: { value: 0.55 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uSat, uContrast, uVignette; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col = (col - 0.18)*uContrast + 0.18;
      col = mix(col*vec3(0.94, 0.98, 1.06), col*vec3(1.06, 1.0, 0.92), smoothstep(0.0, 1.0, l));
      vec2 q = vUv - 0.5;
      col *= clamp(1.0 - dot(q, q)*uVignette*1.6, 0.0, 1.0);
      gl_FragColor = vec4(max(col, 0.0), c.a);
    }`
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.enabled = true; this.ok = false;
    try {
      const c = this.composer = new EffectComposer(renderer);
      c.renderTarget1.samples = 4; c.renderTarget2.samples = 4;
      c.setPixelRatio(renderer.getPixelRatio()); c.setSize(innerWidth, innerHeight);
      this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.65, 1.0);
      this.grade = new ShaderPass(GradeShader);
      c.addPass(new RenderPass(scene, camera));
      c.addPass(this.bloom); c.addPass(this.grade); c.addPass(new OutputPass());
      this.ok = true;
    } catch (e) { console.warn('Post-procesado no disponible:', e); this.enabled = false; }
  }
  configure(enabled, bloom) { this.enabled = enabled && this.ok; if (this.ok) this.bloom.enabled = bloom; }
  setSize(w, h) { if (this.ok) { this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h); } }
  render(dt) { if (this.enabled) this.composer.render(dt); else this.renderer.render(this.scene, this.camera); }
  dispose() { if (this.ok) this.composer.dispose(); }
}
