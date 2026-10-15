import * as THREE from 'three';
import { aimTrace } from '../../shared/aim';
import { Sim, strike, type BallPos, type ShotParams, type SimEvent } from '../../shared/physics';
import { Assets } from './assets';
import { sndBall, sndCue, sndCushion, sndPocket } from './audio';
import { BallsView } from './ballsView';
import { CameraRig, type CamMode } from './cameraRig';
import { AimView, CueView } from './cueView';
import { PostFX } from './postfx';
import { qualityProfile, resolveQuality, type Quality, type QualityProfile, type QualitySetting } from './quality';
import { buildTable, FELTS, type TableParts } from './tableView';

export interface AimState {
  /** ângulo da mira, radianos, plano da física (x para a direita, y para cima) */
  angle: number;
  /** ponto de contato no taco (em raios): a = lado, b = altura */
  a: number;
  b: number;
  /** recuo do taco em metros (0 = encostado) */
  pull: number;
}

export interface PlaybackHandlers {
  onEvent?: (e: SimEvent, sim: Sim) => void;
  onContact?: () => void;
  onDone?: (sim: Sim) => void;
}

/** Cena inteira: mesa, bolas, taco, luzes, câmera e reprodução das tacadas. */
export class PoolView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cam = new CameraRig();
  private post!: PostFX;
  private table!: TableParts;
  private balls!: BallsView;
  private cue!: CueView;
  private aimView = new AimView();
  private qp: QualityProfile;
  private quality: Quality;
  private raf = 0;
  private last = 0;
  private time = 0;
  private running = false;
  /** posições atuais (estado "parado") */
  private pos: BallPos[] = [];
  private aim: AimState = { angle: 0, a: 0, b: 0, pull: 0.06 };
  private aimOn = false;
  private cueOn = false;
  /** reprodução de tacada */
  private sim: Sim | null = null;
  private evIdx = 0;
  private acc = 0;
  private handlers: PlaybackHandlers = {};
  private strikeT = -1;
  private strikeShot: ShotParams | null = null;
  private strikeStart: BallPos[] = [];
  private strikeFromPull = 0.06;
  private followCue = true;
  timeScale = 1;
  onFrame: ((dt: number) => void) | null = null;

  private constructor(readonly canvas: HTMLCanvasElement, setting: QualitySetting) {
    this.quality = resolveQuality(setting);
    this.qp = qualityProfile(this.quality);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.qp.msaa > 0 && !this.qp.bloom, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(this.qp.pixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
  }

  static async create(canvas: HTMLCanvasElement, setting: QualitySetting, onProgress: (pct: number) => void = () => {}): Promise<PoolView> {
    const v = new PoolView(canvas, setting);
    const assets = new Assets();
    assets.onProgress = onProgress;
    await v.build(assets);
    return v;
  }

  private async build(assets: Assets): Promise<void> {
    const { scene } = this;
    scene.background = new THREE.Color(0x07090c);
    scene.fog = new THREE.Fog(0x07090c, 6, 14);
    this.setupEnvironment();
    const hemi = new THREE.HemisphereLight(0xaab6d8, 0x3a2a1e, 0.55);
    scene.add(hemi);
    const [table, balls, cue] = await Promise.all([buildTable(assets, this.qp, this.renderer), BallsView.create(assets), CueView.create(assets)]);
    this.table = table;
    this.balls = balls;
    this.cue = cue;
    scene.add(table.group, balls.group, cue.group, this.aimView.group);
    this.post = new PostFX(this.renderer, scene, this.cam.camera, this.qp);
    this.applyProfile();
    this.resize();
    this.cam.snap();
  }

  /** Mapa de reflexos: sala escura com três painéis de luz (os abajures) e piso claro. */
  private setupEnvironment(): void {
    const envScene = new THREE.Scene();
    const box = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 8), new THREE.MeshBasicMaterial({ color: 0x15110f, side: THREE.BackSide }));
    envScene.add(box);
    const panel = (x: number, z: number, s: number, i: number): void => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s * 0.7), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.93, 0.8).multiplyScalar(i), side: THREE.DoubleSide }));
      m.position.set(x, 1.9, z);
      m.rotation.x = Math.PI / 2;
      envScene.add(m);
    };
    panel(-0.55, 0, 0.45, 7);
    panel(0, 0, 0.45, 7);
    panel(0.55, 0, 0.45, 7);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.36, 0.28), side: THREE.DoubleSide }));
    wall.position.set(0, -0.2, -3.9);
    envScene.add(wall);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.85, 1).multiplyScalar(3), side: THREE.DoubleSide }));
    win.position.set(4.9, 0.4, 0);
    win.rotation.y = Math.PI / 2;
    envScene.add(win);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(envScene, 0.035).texture;
    this.scene.environmentIntensity = 0.55;
    pm.dispose();
  }

  // ---------- configuração
  private applyProfile(): void {
    this.renderer.setPixelRatio(this.qp.pixelRatio);
    this.table.setProfile(this.qp);
    this.post.setProfile(this.qp);
    this.balls.setBlobOpacity(this.qp.shadowLights > 0 ? 0.35 : 0.6);
    this.renderer.shadowMap.enabled = this.qp.shadowLights > 0;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    this.resize();
  }

  setQuality(setting: QualitySetting): void {
    this.quality = resolveQuality(setting);
    this.qp = qualityProfile(this.quality);
    this.applyProfile();
  }

  setFelt(id: string): void {
    this.table.setFelt(FELTS.find((f) => f.id === id) ?? FELTS[0]!);
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    const w = parent?.clientWidth || window.innerWidth;
    const h = parent?.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(this.qp.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h);
    this.cam.setAspect(w, h);
  }

  // ---------- estado visual
  setBalls(pos: BallPos[]): void {
    this.pos = pos.map((p) => ({ ...p }));
    this.balls.setPositions(this.pos);
  }

  getPositions(): BallPos[] {
    return this.pos.map((p) => ({ ...p }));
  }

  setCueBall(x: number, y: number): void {
    const p = this.pos.find((b) => b.id === 0);
    if (!p) return;
    p.x = x;
    p.y = y;
    this.balls.setPositions(this.pos);
  }

  setCameraMode(m: CamMode): void {
    this.cam.mode = m;
    // vista de cima: a luminária atrapalha
    this.table.lampGroup.visible = m !== 'top';
  }

  /** Mostra o taco e a mira (ou esconde). A bola branca precisa estar na mesa. */
  setAim(aim: AimState | null, showGuide = true): void {
    if (!aim) {
      this.aimOn = false;
      this.cueOn = false;
      this.cue.setVisible(false);
      this.aimView.hide();
      return;
    }
    this.aim = aim;
    this.aimOn = showGuide;
    this.cueOn = true;
    this.refreshAim();
  }

  private refreshAim(): void {
    if (this.sim) return;
    const cue = this.pos.find((p) => p.id === 0);
    if (!cue || !cue.on) {
      this.cue.setVisible(false);
      this.aimView.hide();
      return;
    }
    const { angle, a, b, pull } = this.aim;
    this.cam.aimAngle = angle;
    this.cam.tx = cue.x;
    this.cam.ty = cue.y;
    if (this.cueOn) {
      this.cue.place(cue.x, cue.y, angle, a, b, pull);
      this.cue.setVisible(true);
    }
    if (this.aimOn) {
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const info = aimTrace(this.pos, cue.x, cue.y, dx, dy);
      const obj = info.hit >= 0 ? this.pos.find((p) => p.id === info.hit)! : null;
      this.aimView.update(cue, dx, dy, info, obj);
    } else {
      this.aimView.hide();
    }
  }

  // ---------- tacada
  /**
   * Reproduz uma tacada: o taco avança, bate, e a simulação roda em tempo real. `start` = posições antes da tacada.
   */
  playShot(start: BallPos[], shot: ShotParams, h: PlaybackHandlers = {}): void {
    this.handlers = h;
    this.setBalls(start);
    this.strikeStart = start;
    this.strikeShot = shot;
    this.strikeT = 0;
    this.strikeFromPull = Math.max(0.03, this.aim.pull);
    this.cam.aimAngle = Math.atan2(shot.dy, shot.dx);
    const cue = start.find((p) => p.id === 0)!;
    this.cam.tx = cue.x;
    this.cam.ty = cue.y;
    this.aimView.hide();
    this.cue.setVisible(true);
    this.followCue = true;
    this.cam.mode = 'aim';
  }

  get playing(): boolean {
    return this.sim !== null || this.strikeT >= 0;
  }

  /** Interrompe a reprodução e vai para as posições finais dadas (usado pelo online ao receber o estado do servidor). */
  finishAt(final: BallPos[]): void {
    this.sim = null;
    this.strikeT = -1;
    this.setBalls(final);
  }

  private startSim(): void {
    const sim = Sim.from(this.strikeStart);
    const cue = sim.balls[0]!;
    strike(cue, this.strikeShot!);
    this.sim = sim;
    this.evIdx = 0;
    this.acc = 0;
    sndCue(this.strikeShot!.v / 6.8);
    this.cam.kick(Math.min(1, this.strikeShot!.v / 6) * 0.8);
    this.handlers.onContact?.();
    if (this.cam.mode === 'aim') this.cam.mode = 'follow';
  }

  private stepSim(dt: number): void {
    const sim = this.sim!;
    const ts = Math.max(1, this.timeScale);
    this.acc = Math.min(this.acc + dt * this.timeScale, 0.06 * ts);
    let steps = 0;
    for (;;) {
      const d = sim.nextDt();
      if (this.acc < d || steps >= 40 * ts) break;
      this.acc -= sim.step(d);
      steps++;
      if (!sim.moving()) break;
    }
    // eventos novos
    while (this.evIdx < sim.events.length) {
      const e = sim.events[this.evIdx++]!;
      if (e.k === 'ball') sndBall(e.v);
      else if (e.k === 'cushion') sndCushion(e.v);
      else {
        sndPocket(e.v);
        const b = sim.balls[e.a]!;
        this.balls.pocket(e.a, e.p, b.x, b.y);
      }
      this.handlers.onEvent?.(e, sim);
    }
    this.balls.sync(sim.balls, dt * this.timeScale);
    if (!sim.moving() || sim.t > 45) {
      const done = sim;
      this.sim = null;
      this.pos = done.positions();
      this.cam.mode = 'aim';
      this.cue.setVisible(false);
      this.handlers.onDone?.(done);
    }
  }

  /** Centro das bolas em movimento (câmera de acompanhamento). */
  private followTarget(): { x: number; y: number } {
    const sim = this.sim;
    const cue = sim?.balls[0];
    if (cue && cue.on) return { x: cue.x, y: cue.y };
    if (sim) {
      for (const b of sim.balls) if (b && b.on && !b.rest) return { x: b.x, y: b.y };
    }
    return { x: this.cam.tx, y: this.cam.ty };
  }

  // ---------- laço de desenho
  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (t: number): void => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame(dt: number): void {
    this.time += dt;
    // animação do taco
    if (this.strikeT >= 0 && this.strikeShot) {
      this.strikeT += dt;
      const dur = 0.16;
      const k = Math.min(1, this.strikeT / dur);
      const e = k * k * (3 - 2 * k) * (0.4 + 0.6 * k);
      const cue = this.strikeStart.find((p) => p.id === 0)!;
      const ang = Math.atan2(this.strikeShot.dy, this.strikeShot.dx);
      const pull = this.strikeFromPull * (1 - e);
      this.cue.place(cue.x, cue.y, ang, this.aim.a, this.aim.b, pull);
      if (k >= 1) {
        this.strikeT = -1;
        this.startSim();
        this.strikeT = -2; // marca "seguindo": o taco avança um pouco e some
        this.followT = 0;
      }
    } else if (this.strikeT === -2) {
      this.followT += dt;
      const cue = this.strikeStart.find((p) => p.id === 0)!;
      const ang = Math.atan2(this.strikeShot!.dy, this.strikeShot!.dx);
      this.cue.place(cue.x, cue.y, ang, this.aim.a, this.aim.b, -Math.min(0.05, this.followT * 0.4));
      if (this.followT > 0.45) {
        this.cue.setVisible(false);
        this.strikeT = -1;
      }
    }
    if (this.sim) this.stepSim(dt);
    this.balls.update(dt);
    this.cam.update(dt, this.sim && this.followCue ? this.followTarget() : undefined);
    this.onFrame?.(dt);
    if (this.post.enabled) this.post.render(dt, this.time);
    else this.renderer.render(this.scene, this.cam.camera);
  }
  private followT = 0;

  dispose(): void {
    this.stop();
    this.balls.dispose();
    this.renderer.dispose();
  }
}
