import * as THREE from 'three';
import { BALL_R, FELT_Y, HL, HW } from '../../shared/table';

export type CamMode = 'aim' | 'top' | 'follow' | 'menu';

const damp = (cur: number, target: number, rate: number, dt: number): number => cur + (target - cur) * (1 - Math.exp(-rate * dt));

/**
 * Câmera da mesa. `aim`: atrás da branca olhando para onde vai a tacada. `top`: de cima. `follow`: acompanha a jogada.
 * `menu`: giro lento em volta da mesa para o menu.
 */
export class CameraRig {
  camera = new THREE.PerspectiveCamera(42, 1, 0.03, 40);
  mode: CamMode = 'menu';
  /** ângulo da mira (rad, plano da física) */
  aimAngle = 0;
  /** alvo (plano da física) */
  tx = 0;
  ty = 0;
  pitch = 0.5;
  dist = 1.05;
  private cur = { x: 0, y: FELT_Y + BALL_R, z: 0, yaw: 0, pitch: 0.5, dist: 1.05, fov: 42, topK: 0 };
  private target = new THREE.Vector3();
  private t = 0;
  userPitch = 0.5;
  userDist = 1.05;
  aspect = 1;
  private shake = 0;
  /** só para depuração: câmera fixa [x,y,z, alvoX,alvoY,alvoZ] */
  override: number[] | null = null;

  setAspect(w: number, h: number): void {
    this.aspect = w / h;
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
  }

  kick(a: number): void {
    this.shake = Math.max(this.shake, a);
  }

  /** Distância necessária para a mesa inteira caber na tela vista de cima. */
  private topDist(): number {
    const fov = (this.camera.fov * Math.PI) / 180;
    const needV = (HW + 0.2) / Math.tan(fov / 2);
    const needH = (HL + 0.2) / (Math.tan(fov / 2) * this.aspect);
    return Math.max(needV, needH) * 1.0;
  }

  update(dt: number, follow?: { x: number; y: number }): void {
    this.t += dt;
    if (this.override) {
      const o = this.override;
      this.camera.position.set(o[0]!, o[1]!, o[2]!);
      this.camera.lookAt(o[3]!, o[4]!, o[5]!);
      return;
    }
    const sc = this.cur;
    let gx = this.tx;
    let gy = this.ty;
    let gYaw = 0;
    let gPitch = this.userPitch;
    let gDist = this.userDist;
    let gTop = 0;
    let fovT = 42;
    if (this.mode === 'aim') {
      gYaw = -this.aimAngle + Math.PI; // câmera atrás: oposta à direção (física -> cena: z = -y)
      // aspecto vertical (celular): mais distante e um pouco mais alta
      if (this.aspect < 0.9) gDist *= 1.18;
    } else if (this.mode === 'follow') {
      const f = follow ?? { x: this.tx, y: this.ty };
      gx = f.x;
      gy = f.y;
      gYaw = -this.aimAngle + Math.PI;
      gPitch = Math.max(this.userPitch, 0.62);
      gDist = this.userDist * 1.55;
    } else if (this.mode === 'top') {
      gx = 0;
      gy = 0;
      gTop = 1;
      gYaw = Math.PI / 2;
      gPitch = 1.5;
      gDist = this.topDist();
      fovT = 40;
    } else {
      // menu
      gx = 0;
      gy = 0;
      gYaw = this.t * 0.07 + 0.6;
      gPitch = 0.42;
      gDist = 2.35;
      fovT = 38;
    }
    const rate = this.mode === 'follow' ? 2.2 : this.mode === 'top' ? 4.2 : this.mode === 'menu' ? 1.5 : 6.5;
    sc.x = damp(sc.x, gx, rate, dt);
    sc.z = damp(sc.z, -gy, rate, dt);
    // menor caminho no ângulo
    let dy = gYaw - sc.yaw;
    dy = ((dy + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    sc.yaw += dy * (1 - Math.exp(-rate * dt));
    sc.pitch = damp(sc.pitch, gPitch, rate, dt);
    sc.dist = damp(sc.dist, gDist, rate, dt);
    sc.fov = damp(sc.fov, fovT, 3, dt);
    sc.topK = damp(sc.topK, gTop, 4, dt);

    const cp = Math.cos(sc.pitch);
    const sp = Math.sin(sc.pitch);
    const ty = this.mode === 'top' || this.mode === 'menu' ? FELT_Y : FELT_Y + BALL_R * 1.4;
    this.target.set(sc.x, ty, sc.z);
    this.camera.position.set(sc.x + Math.cos(sc.yaw) * cp * sc.dist, ty + sp * sc.dist, sc.z + Math.sin(sc.yaw) * cp * sc.dist);
    if (this.shake > 0.0005) {
      this.camera.position.x += (Math.sin(this.t * 90) * this.shake) * 0.01;
      this.camera.position.y += (Math.cos(this.t * 77) * this.shake) * 0.01;
      this.shake *= Math.exp(-9 * dt);
    }
    if (Math.abs(this.camera.fov - sc.fov) > 0.01) {
      this.camera.fov = sc.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
  }

  /** Salta direto para o destino (sem animação). */
  snap(): void {
    for (let i = 0; i < 40; i++) this.update(0.1);
  }

  /** Ponto da mesa (plano da física) sob o ponteiro, ou null se não cruza o feltro. */
  pick(ndcX: number, ndcY: number): { x: number; y: number } | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const o = ray.ray.origin;
    const d = ray.ray.direction;
    if (Math.abs(d.y) < 1e-6) return null;
    const t = (FELT_Y + BALL_R - o.y) / d.y;
    if (t < 0) return null;
    return { x: o.x + d.x * t, y: -(o.z + d.z * t) };
  }
}
