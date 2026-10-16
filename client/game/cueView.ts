import * as THREE from 'three';
import { BALL_R, FELT_Y } from '../../shared/table';
import type { AimInfo, PocketAim } from '../../shared/aim';
import type { Assets } from './assets';

const SURFACE_Y = FELT_Y + BALL_R;
export const CUE_ELEVATION = 0.06;

/** Taco (taco.glb): ponta na origem, corpo para -Z. */
export class CueView {
  group = new THREE.Group();
  private tmp = new THREE.Vector3();
  length = 1.43;

  static async create(assets: Assets): Promise<CueView> {
    const [g, g2] = await Promise.all([assets.gltf('models/cue.glb'), assets.gltf('models/cue2.glb')]);
    return new CueView(g.scene, g2.scene);
  }

  private models: Record<string, THREE.Object3D> = {};

  /** 'pacote' = taco do pacote fornecido; qualquer outro = taco clássico */
  setModel(id: string): void {
    for (const [k, m] of Object.entries(this.models)) m.visible = k === (id === 'pacote' ? 'pacote' : 'classico');
  }

  constructor(model: THREE.Object3D, model2: THREE.Object3D) {
    this.models = { classico: model, pacote: model2 };
    model2.visible = false;
    model2.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = false;
      }
    });
    this.group.add(model2);
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = false;
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.metalness = 0;
        mat.roughness = 0.55;
        mat.envMapIntensity = 0.5;
        mat.color.setScalar(0.78);
      }
    });
    this.group.add(model);
    this.group.visible = false;
  }

  /**
   * Posiciona o taco mirando na bola em (cx, cy) (plano da física), ângulo `ang` (rad), com o ponto de contato
   * (a lado, b altura, em raios) e o recuo `pull` (m) entre a ponta e a bola.
   */
  place(cx: number, cy: number, ang: number, a: number, b: number, pull: number, elev = CUE_ELEVATION): void {
    const fx = Math.cos(ang);
    const fz = -Math.sin(ang);
    const ce = Math.cos(elev);
    const se = Math.sin(elev);
    const d3 = this.tmp.set(fx * ce, -se, fz * ce);
    // direita da mira vista de trás
    const rx = -fz;
    const rz = fx;
    const c = Math.sqrt(Math.max(0, 1 - a * a - b * b));
    const ox = rx * a * BALL_R - fx * c * BALL_R;
    const oy = b * BALL_R;
    const oz = rz * a * BALL_R - fz * c * BALL_R;
    const gap = 0.003 + pull;
    this.group.position.set(cx + ox - d3.x * gap, SURFACE_Y + oy - d3.y * gap, -cy + oz - d3.z * gap);
    this.group.lookAt(this.group.position.x + d3.x, this.group.position.y + d3.y, this.group.position.z + d3.z);
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  /** Taco translúcido enquanto se mira: não esconde a bola nem a linha de mira. */
  private faded: boolean | null = null;
  setFade(on: boolean): void {
    if (this.faded === on) return;
    this.faded = on;
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.transparent = on;
      mat.opacity = on ? 0.55 : 1;
      mat.depthWrite = !on;
      mat.needsUpdate = true;
    });
  }
}

function dashTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 8;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 38, 8);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  return t;
}

class Ribbon {
  mesh: THREE.Mesh;
  /** faixa escura embaixo: contraste sobre o pano verde */
  edge: THREE.Mesh;
  k = 1;
  private tex: THREE.CanvasTexture | null;
  constructor(color: number, opacity: number, private width: number, dashed: boolean, base: THREE.CanvasTexture) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.tex = dashed ? base.clone() : null;
    if (this.tex) this.tex.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, map: this.tex, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    this.edge = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x03140a, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    this.edge.renderOrder = 4;
    this.edge.visible = false;
    this.mesh.add(this.edge);
    this.edge.scale.set(1, 1, 2.6);
    this.edge.position.y = -0.0001;
  }
  setK(k: number): void {
    this.k = k;
    if (this.mesh.visible) this.mesh.scale.z = this.width * k;
  }
  set(x1: number, y1: number, x2: number, y2: number): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-4) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.edge.visible = true;
    this.mesh.position.set((x1 + x2) / 2, FELT_Y + 0.0012, -(y1 + y2) / 2);
    this.mesh.rotation.y = Math.atan2(dy, dx);
    this.mesh.scale.set(len, 1, this.width * this.k);
    if (this.tex) this.tex.repeat.x = len / 0.02;
  }
}

/** Linhas de mira: caminho da branca, bola fantasma, saída da bola alvo e da branca. */
export class AimView {
  group = new THREE.Group();
  private main: Ribbon;
  private obj: Ribbon;
  private pocket: Ribbon;
  private path: Ribbon[] = [];
  private pocketRing: THREE.Mesh;
  private cue: Ribbon;
  private ring: THREE.Mesh;
  private ghost: THREE.Mesh;
  private objRing: THREE.Mesh;

  constructor() {
    const dash = dashTexture();
    this.main = new Ribbon(0xffffff, 1, 0.0078, false, dash);
    this.obj = new Ribbon(0xffe27a, 1, 0.0078, true, dash);
    this.cue = new Ribbon(0xcfe8ff, 1, 0.0066, true, dash);
    this.pocket = new Ribbon(0x5df08a, 1, 0.0078, true, dash);
    this.pocketRing = new THREE.Mesh(new THREE.RingGeometry(BALL_R * 0.55, BALL_R * 0.75, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5df08a, transparent: true, opacity: 0.9, depthWrite: false }));
    this.pocketRing.renderOrder = 4;
    this.pocketRing.visible = false;
    const ringGeo = new THREE.RingGeometry(BALL_R * 0.84, BALL_R * 1.02, 56).rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    this.ring.renderOrder = 4;
    this.ghost = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 0.93, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }));
    this.ghost.renderOrder = 3;
    this.objRing = new THREE.Mesh(new THREE.RingGeometry(BALL_R * 1.05, BALL_R * 1.28, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 1, depthWrite: false }));
    this.objRing.renderOrder = 4;
    for (let i = 0; i < 24; i++) {
      const r = new Ribbon(0xcfe8ff, 1, 0.0066, true, dash);
      this.path.push(r);
      this.group.add(r.mesh);
    }
    this.group.add(this.main.mesh, this.obj.mesh, this.cue.mesh, this.pocket.mesh, this.pocketRing, this.ring, this.ghost, this.objRing);
    this.group.visible = false;
  }

  /** Linhas mais grossas quando a câmera está longe, para continuarem visíveis. */
  setScale(k: number): void {
    for (const r of [this.main, this.obj, this.cue, this.pocket, ...this.path]) r.setK(k);
  }

  /** `from` é a posição da branca (plano da física). */
  update(from: { x: number; y: number }, dx: number, dy: number, info: AimInfo, objPos: { x: number; y: number } | null, pocket: PocketAim | null = null, full = true): void {
    this.group.visible = true;
    const sx = from.x + dx * BALL_R * 1.05;
    const sy = from.y + dy * BALL_R * 1.05;
    this.main.set(sx, sy, info.ghostX - dx * BALL_R * (info.hit >= 0 ? 0.0 : 0), info.ghostY);
    if (info.hit >= 0) {
      this.ring.visible = true;
      this.ghost.visible = true;
      this.ring.position.set(info.ghostX, FELT_Y + 0.0014, -info.ghostY);
      this.ghost.position.set(info.ghostX, FELT_Y + 0.0013, -info.ghostY);
      const op = objPos!;
      const len = 0.3;
      if (full) this.obj.set(op.x, op.y, op.x + info.objDx * len, op.y + info.objDy * len);
      else this.obj.mesh.visible = false;
      if (full && pocket && pocket.index >= 0) {
        const col = pocket.enters ? 0x5df08a : 0xffa34d;
        ((this.pocket.mesh.material as THREE.MeshBasicMaterial)).color.setHex(col);
        (this.pocketRing.material as THREE.MeshBasicMaterial).color.setHex(col);
        this.obj.mesh.visible = false;
        this.pocket.set(op.x, op.y, pocket.x, pocket.y);
        this.pocketRing.visible = true;
        this.pocketRing.position.set(pocket.x, FELT_Y + 0.0013, -pocket.y);
      } else {
        this.pocket.mesh.visible = false;
        this.pocketRing.visible = false;
      }
      this.objRing.visible = true;
      this.objRing.position.set(op.x, FELT_Y + 0.0013, -op.y);
      if (full) this.cue.set(info.ghostX, info.ghostY, info.ghostX + info.cueDx * 0.2, info.ghostY + info.cueDy * 0.2);
      else this.cue.mesh.visible = false;
    } else {
      this.ring.visible = true;
      this.ghost.visible = false;
      this.ring.position.set(info.ghostX, FELT_Y + 0.0014, -info.ghostY);
      this.objRing.visible = false;
      this.obj.mesh.visible = false;
      this.pocket.mesh.visible = false;
      this.pocketRing.visible = false;
      if (full) this.cue.set(info.ghostX, info.ghostY, info.ghostX + info.rdx * 0.35, info.ghostY + info.rdy * 0.35);
      else this.cue.mesh.visible = false;
    }
  }

  /** Caminho real da branca depois do primeiro contato (substitui a linha de saída geométrica). */
  setPath(pts: { x: number; y: number }[] | null): void {
    for (let i = 0; i < this.path.length; i++) {
      const r = this.path[i]!;
      if (pts && i + 1 < pts.length) r.set(pts[i]!.x, pts[i]!.y, pts[i + 1]!.x, pts[i + 1]!.y);
      else r.mesh.visible = false;
    }
    if (pts && pts.length > 1) this.cue.mesh.visible = false;
  }

  hide(): void {
    this.group.visible = false;
    this.setPath(null);
  }
}
