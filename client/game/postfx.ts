import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { QualityProfile } from './quality';

// Gradação suave aplicada em HDR linear antes do tone mapping: vinheta, leve contraste e cor quente nas luzes.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.5 },
    uContrast: { value: 1.06 },
    uSat: { value: 1.06 },
    uTime: { value: 0 },
    uGrain: { value: 0.035 },
    uFlash: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVignette; uniform float uContrast; uniform float uSat; uniform float uTime; uniform float uGrain; uniform float uFlash;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126,0.7152,0.0722));
      c = mix(vec3(l), c, uSat);
      c = (c - 0.18) * uContrast + 0.18;
      vec2 d = vUv - 0.5; d.x *= 1.15;
      float v = smoothstep(0.85, 0.2, length(d));
      c *= mix(1.0 - uVignette, 1.0, v);
      c *= 1.0 + (hash(vUv * 1000.0 + uTime) - 0.5) * uGrain;
      c += uFlash;
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

export class PostFX {
  composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  enabled = true;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, qp: QualityProfile) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: qp.msaa });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.22, 0.5, 0.96);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.setProfile(qp);
  }

  setProfile(qp: QualityProfile): void {
    this.enabled = qp.bloom || qp.msaa > 0;
    this.bloom.enabled = qp.bloom;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer.setPixelRatio(qp.pixelRatio);
    this.composer.setSize(size.x / qp.pixelRatio, size.y / qp.pixelRatio);
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  /** 0..1: clareia a imagem (menos vinheta e mais contraste de luz) para a vista de cima. */
  setBright(k: number): void {
    this.grade.uniforms.uVignette!.value = 0.5 - 0.35 * k;
  }

  flash(a: number): void {
    this.grade.uniforms.uFlash!.value = a;
  }

  render(dt: number, t: number): void {
    this.grade.uniforms.uTime!.value = t % 100;
    if (this.grade.uniforms.uFlash!.value > 0) this.grade.uniforms.uFlash!.value *= Math.exp(-6 * dt);
    this.composer.render(dt);
  }
}
