import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const BASE = import.meta.env.BASE_URL;
export const url = (p: string): string => `${BASE}${p}`;

/** Carrega texturas e modelos contando o progresso (para a tela de carregamento). */
export class Assets {
  private total = 0;
  private done = 0;
  onProgress: (pct: number) => void = () => {};
  private tl = new THREE.TextureLoader();
  private gl = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  maxAniso = 4;

  private bump(): void {
    this.done++;
    this.onProgress(this.total ? this.done / this.total : 1);
  }

  texture(path: string, opts: { srgb?: boolean; repeat?: boolean; mirror?: boolean } = {}): Promise<THREE.Texture> {
    this.total++;
    return new Promise((resolve, reject) => {
      this.tl.load(
        url(path),
        (t) => {
          t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
          if (opts.mirror) t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
          else if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = this.maxAniso;
          this.bump();
          resolve(t);
        },
        undefined,
        (e) => reject(e),
      );
    });
  }

  gltf(path: string): Promise<GLTF> {
    this.total++;
    return this.gl.loadAsync(url(path)).then((g) => {
      this.bump();
      return g;
    });
  }
}
