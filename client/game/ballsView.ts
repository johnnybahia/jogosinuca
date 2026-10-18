import * as THREE from 'three';
import type { Ball, BallPos } from '../../shared/physics';
import { BALL_R, FELT_Y, POCKETS } from '../../shared/table';
import type { Assets } from './assets';

const SURFACE_Y = FELT_Y + BALL_R;

interface Sink {
  t: number;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  vy: number;
}

export interface BallVis {
  id: number;
  mesh: THREE.Mesh;
  shadow: THREE.Mesh;
  ring: THREE.Mesh;
  mine: boolean;
  sink: Sink | null;
  on: boolean;
}

const _q = new THREE.Quaternion();
const _ax = new THREE.Vector3();

function blobTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, 'rgba(0,0,0,0.85)');
  gr.addColorStop(0.35, 'rgba(0,0,0,0.5)');
  gr.addColorStop(0.7, 'rgba(0,0,0,0.14)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Bola lisa de uma cor com duas pintinhas brancas opostas (para o giro aparecer na tela). */
function guerraMaterial(color: string): THREE.MeshPhysicalMaterial {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#f4f1e8';
  for (const x of [64, 192]) {
    g.beginPath();
    g.arc(x, 64, 11, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.14, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.035, envMapIntensity: 1.1, specularIntensity: 1 });
}

export class BallsView {
  group = new THREE.Group();
  vis: BallVis[] = [];
  private mats: THREE.MeshPhysicalMaterial[] = [];
  private guerraMats: Record<'blue' | 'red', THREE.MeshPhysicalMaterial> | null = null;
  private styled = false;

  static async create(assets: Assets): Promise<BallsView> {
    const v = new BallsView();
    const texs = await Promise.all(Array.from({ length: 16 }, (_, i) => assets.texture(`tex/balls/ball_${String(i).padStart(2, '0')}.jpg`)));
    const geo = new THREE.SphereGeometry(BALL_R, 64, 48);
    const blob = blobTexture();
    const blobGeo = new THREE.PlaneGeometry(BALL_R * 3.6, BALL_R * 3.6).rotateX(-Math.PI / 2);
    const blobMat = new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const ringGeo = new THREE.RingGeometry(BALL_R * 1.28, BALL_R * 1.62, 40).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.MeshPhysicalMaterial({ map: texs[i]!, roughness: 0.14, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.035, envMapIntensity: 1.1, specularIntensity: 1 });
      v.mats.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.name = `ball${i}`;
      const shadow = new THREE.Mesh(blobGeo, blobMat);
      shadow.renderOrder = 2;
      shadow.visible = false;
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.renderOrder = 3;
      ring.visible = false;
      v.group.add(mesh, shadow, ring);
      v.vis.push({ id: i, mesh, shadow, ring, mine: false, sink: null, on: true });
      // orientação inicial aleatória (determinística por bola) para os números não ficarem todos iguais
      mesh.quaternion.setFromEuler(new THREE.Euler(i * 1.9, i * 2.7, i * 0.9));
    }
    v.guerraMats = { blue: guerraMaterial('#1c4fd0'), red: guerraMaterial('#d2232a') };
    return v;
  }

  /** Guerra: bolas lisas azuis (1–7) e vermelhas (8–14), sem números; senão as bolas numeradas. */
  setStyle(guerra: boolean): void {
    if (guerra === this.styled || !this.guerraMats) return;
    this.styled = guerra;
    for (let i = 1; i < this.vis.length; i++) {
      const m = guerra ? (i <= 7 ? this.guerraMats.blue : i <= 14 ? this.guerraMats.red : this.mats[i]!) : this.mats[i]!;
      this.vis[i]!.mesh.material = m;
    }
  }

  /** Destaca (anel dourado no pano) as bolas indicadas. */
  setMine(ids: ReadonlySet<number>): void {
    for (const v of this.vis) {
      v.mine = ids.has(v.id);
      v.ring.visible = v.mine && v.on;
    }
  }

  setBlobOpacity(o: number): void {
    (this.vis[0]!.shadow.material as THREE.MeshBasicMaterial).opacity = o;
  }

  /** Coloca todas as bolas nas posições dadas (sem animação). */
  setPositions(pos: BallPos[]): void {
    for (const v of this.vis) {
      v.sink = null;
      v.on = false;
      v.mesh.visible = false;
      v.shadow.visible = false;
      v.ring.visible = false;
    }
    for (const p of pos) {
      const v = this.vis[p.id]!;
      v.on = p.on;
      v.mesh.visible = p.on;
      v.shadow.visible = p.on;
      v.ring.visible = p.on && v.mine;
      v.mesh.position.set(p.x, SURFACE_Y, -p.y);
      v.shadow.position.set(p.x, FELT_Y + 0.0006, -p.y);
      v.ring.position.set(p.x, FELT_Y + 0.0009, -p.y);
    }
  }

  /** Atualiza a partir da simulação em andamento. */
  sync(balls: Ball[], dt: number): void {
    for (const b of balls) {
      if (!b) continue;
      const v = this.vis[b.id]!;
      if (b.on) {
        v.mesh.position.set(b.x, SURFACE_Y, -b.y);
        v.shadow.position.set(b.x, FELT_Y + 0.0006, -b.y);
        v.ring.position.set(b.x, FELT_Y + 0.0009, -b.y);
        if (!b.rest) {
          // ω no referencial da cena: (wx, wz, -wy)
          const wx = b.wx;
          const wy = b.wz;
          const wz = -b.wy;
          const w = Math.sqrt(wx * wx + wy * wy + wz * wz);
          if (w > 1e-4) {
            _ax.set(wx / w, wy / w, wz / w);
            _q.setFromAxisAngle(_ax, w * dt);
            v.mesh.quaternion.premultiply(_q);
          }
        }
      }
    }
  }

  /** A bola caiu na caçapa: desliza até o buraco e afunda. */
  pocket(id: number, pocketIndex: number, x: number, y: number): void {
    const v = this.vis[id]!;
    const p = POCKETS[pocketIndex];
    v.on = false;
    v.shadow.visible = false;
    v.ring.visible = false;
    if (!p) {
      v.mesh.visible = false;
      return;
    }
    v.sink = { t: 0, fromX: x, fromZ: -y, toX: p.x * 0.985, toZ: -p.y * 0.985, vy: 0 };
  }

  update(dt: number): void {
    for (const v of this.vis) {
      const s = v.sink;
      if (!s) continue;
      s.t += dt;
      const k = Math.min(1, s.t / 0.16);
      v.mesh.position.x = s.fromX + (s.toX - s.fromX) * k;
      v.mesh.position.z = s.fromZ + (s.toZ - s.fromZ) * k;
      if (s.t > 0.1) {
        s.vy += 9.81 * dt;
        v.mesh.position.y -= s.vy * dt;
      }
      if (s.t > 0.55 || v.mesh.position.y < FELT_Y - 0.25) {
        v.mesh.visible = false;
        v.sink = null;
      }
    }
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
  }
}
