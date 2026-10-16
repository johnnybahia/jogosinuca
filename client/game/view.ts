import * as THREE from 'three';
import { aimTrace, cutAngle, pocketAim, previewCuePath } from '../../shared/aim';
import { BALL_R, HL, HW, POCKETS } from '../../shared/table';
import { Sim, powerToSpeed, strike, type BallPos, type ShotParams, type SimEvent } from '../../shared/physics';
import { Assets } from './assets';
import { sndBall, sndCue, sndCushion, sndPocket } from './audio';
import { BallsView } from './ballsView';
import { CameraRig, type CamMode } from './cameraRig';
import { AimView, CUE_ELEVATION, CueView } from './cueView';
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
  /** chamado quando o aparelho não aguenta a qualidade atual (só faz sentido no modo automático) */
  onSlow: ((q: Quality) => void) | null = null;
  private perfT = 0;
  private perfN = 0;
  private perfSum = 0;
  private perfWarm = 0;

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
    this.setLevel(resolveQuality(setting));
  }

  setLevel(q: Quality): void {
    this.quality = q;
    this.qp = qualityProfile(q);
    this.applyProfile();
    this.perfSum = this.perfN = this.perfT = 0;
    this.perfWarm = 0;
  }

  get level(): Quality {
    return this.quality;
  }

  setTable(id: string): void {
    this.table.setTable(id);
  }

  setCue(id: string): void {
    this.cue.setModel(id);
  }

  setWood(id: string): void {
    this.table.setWood(id);
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

  setMine(ids: ReadonlySet<number>): void {
    this.balls.setMine(ids);
  }

  setCameraMode(m: CamMode): void {
    this.cam.mode = m;
    // vista de cima: a luminária atrapalha
    this.lampOn = m !== 'top';
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

  guideFull = true;
  onAimInfo: ((t: string) => void) | null = null;

  setGuideFull(on: boolean): void {
    this.guideFull = on;
    this.refreshAim();
  }

  setOverview(on: boolean): void {
    this.cam.overview = on;
  }

  private cueEl = CUE_ELEVATION;
  private slide: { fx: number; fy: number; tx: number; ty: number; t: number } | null = null;

  /** Elevação do taco: sobe o suficiente para a parte de trás passar por cima de bolas atrás da branca e das tabelas. */
  private cueElev(pos: BallPos[], cx: number, cy: number, ang: number, b: number): number {
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    let need = 0;
    for (const o of pos) {
      if (o.id === 0 || !o.on) continue;
      const rx = o.x - cx;
      const ry = o.y - cy;
      const along = -(rx * dx + ry * dy);
      if (along <= 0 || along > 1.6) continue;
      if (Math.abs(rx * dy - ry * dx) > BALL_R + 0.016) continue;
      need = Math.max(need, Math.atan((BALL_R * (1 - b) + 0.012) / Math.max(0.03, along - BALL_R * 0.5)));
    }
    // tabela atrás da branca: o taco precisa passar por cima da madeira
    const lim = (c: number, u: number, half: number): number => (Math.abs(u) < 1e-4 ? Infinity : (u < 0 ? half - c : half + c) / Math.abs(u));
    const tn = Math.max(0.03, Math.min(lim(cx, dx, HL), lim(cy, dy, HW)));
    need = Math.max(need, Math.atan(0.034 / tn));
    const target = Math.min(0.75, Math.max(CUE_ELEVATION, need));
    this.cueEl += (target - this.cueEl) * 0.4;
    return this.cueEl;
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
      this.cue.place(cue.x, cue.y, angle, a, b, pull, this.cueElev(this.pos, cue.x, cue.y, angle, b));
      this.cue.setVisible(true);
    }
    this.cue.setFade(this.cueOn);
    if (this.aimOn) {
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const info = aimTrace(this.pos, cue.x, cue.y, dx, dy);
      const obj = info.hit >= 0 ? this.pos.find((p) => p.id === info.hit)! : null;
      const pk = obj ? pocketAim(obj.x, obj.y, info.objDx, info.objDy) : null;
      this.aimView.update(cue, dx, dy, info, obj, pk, this.guideFull);
      // trajetória real da branca (seguir/puxar/efeito) a partir do contato, com a potência que o taco indica
      if (this.guideFull) {
        const p = Math.min(1, Math.max(0.35, (pull - 0.04) / 0.24));
        this.aimView.setPath(previewCuePath(this.pos, dx, dy, powerToSpeed(p), a, b, 0.8));
      } else this.aimView.setPath(null);
      // enquadramento: branca + ponto do contato + bola alvo + caçapa provável
      const pts = [{ x: cue.x, y: cue.y }];
      if (obj) {
        pts.push({ x: info.ghostX, y: info.ghostY }, { x: obj.x, y: obj.y });
        if (pk && pk.index >= 0) pts.push({ x: pk.x, y: pk.y });
      } else pts.push({ x: info.ghostX, y: info.ghostY });
      this.cam.frame = pts;
      this.onAimInfo?.(obj ? `Corte ${Math.round(cutAngle(info, dx, dy))}°${pk && pk.index >= 0 ? (pk.enters ? ' · caçapa ✓' : ' · caçapa fora') : ''}` : '');
    } else {
      this.aimView.hide();
      this.cam.frame = null;
      this.onAimInfo?.('');
    }
  }

  // ---------- tacada
  /**
   * Reproduz uma tacada: o taco avança, bate, e a simulação roda em tempo real. `start` = posições antes da tacada.
   */
  playShot(start: BallPos[], shot: ShotParams, h: PlaybackHandlers = {}): void {
    this.handlers = h;
    const old = this.pos.find((p) => p.id === 0);
    const to = start.find((p) => p.id === 0);
    this.slide = null;
    this.setBalls(start);
    // bola na mão do adversário: a branca desliza até onde ele a pôs, em vez de teletransportar
    if (old && to && old.on && to.on && Math.hypot(old.x - to.x, old.y - to.y) > 0.004) this.slide = { fx: old.x, fy: old.y, tx: to.x, ty: to.y, t: 0 };
    this.strikeStart = start;
    this.strikeShot = shot;
    this.strikeT = 0;
    this.strikeFromPull = Math.max(0.03, this.aim.pull);
    this.cam.aimAngle = Math.atan2(shot.dy, shot.dx);
    const cue = start.find((p) => p.id === 0)!;
    this.cam.tx = cue.x;
    this.cam.ty = cue.y;
    this.aimView.hide();
    this.cue.setFade(false);
    this.cue.setVisible(true);
    this.followCue = true;
    if (this.cam.mode !== 'top') this.cam.mode = 'aim';
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
    this.pocketFocus = null;
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
        const pk = POCKETS[e.p];
        if (pk && e.a !== 0) this.pocketFocus = { x: pk.x, y: pk.y, t: 1.5 };
        this.balls.pocket(e.a, e.p, b.x, b.y);
      }
      this.handlers.onEvent?.(e, sim);
    }
    this.balls.sync(sim.balls, dt * this.timeScale);
    if (!sim.moving() || sim.t > 45) {
      const done = sim;
      this.sim = null;
      this.pos = done.positions();
      const cb = this.pos.find((p) => p.id === 0);
      if (cb && cb.on) {
        this.cam.tx = cb.x;
        this.cam.ty = cb.y;
      }
      this.cam.calm = 1.4;
      if (this.cam.mode !== 'top') this.cam.mode = 'aim';
      this.cue.setVisible(false);
      this.handlers.onDone?.(done);
    }
  }

  /** Câmera de acompanhamento: bola caindo na caçapa > bola perto de uma caçapa > bola batida > branca. */
  private followTarget(): { x: number; y: number; high?: boolean; yaw?: number } {
    const sim = this.sim;
    const toward = (px: number, py: number): number => Math.atan2(py, -px);
    if (this.pocketFocus && this.pocketFocus.t > 0) {
      const f = this.pocketFocus;
      return { x: f.x, y: f.y, high: true, yaw: toward(f.x, f.y) };
    }
    const cue = sim?.balls[0];
    if (sim) {
      let best: { x: number; y: number; d: number; pi: number } | null = null;
      for (const b of sim.balls) {
        if (!b || !b.on || b.rest || b.id === 0) continue;
        for (let i = 0; i < POCKETS.length; i++) {
          const p = POCKETS[i]!;
          const dx = p.x - b.x;
          const dy = p.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d < 0.7 && dx * b.vx + dy * b.vy > 0 && (!best || d < best.d)) best = { x: b.x, y: b.y, d, pi: i };
        }
      }
      if (best) {
        const p = POCKETS[best.pi]!;
        return { x: (best.x + p.x) / 2, y: (best.y + p.y) / 2, high: true, yaw: toward(p.x, p.y) };
      }
      const fh = sim.firstHit >= 0 ? sim.balls[sim.firstHit] : null;
      if (fh && fh.on && !fh.rest) return { x: fh.x, y: fh.y };
      if (cue && cue.on) return { x: cue.x, y: cue.y };
      for (const b of sim.balls) if (b && b.on && !b.rest) return { x: b.x, y: b.y };
    }
    return { x: this.cam.tx, y: this.cam.ty };
  }
  private pocketFocus: { x: number; y: number; t: number } | null = null;

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
    // monitor de desempenho: se a média passar de ~30 fps por alguns segundos, pede para baixar a qualidade
    if (document.visibilityState === 'visible' && dt < 0.2) {
      this.perfWarm += dt;
      if (this.perfWarm > 4) {
        this.perfSum += dt;
        this.perfN++;
        this.perfT += dt;
        if (this.perfT >= 3) {
          const avg = this.perfSum / this.perfN;
          this.perfSum = this.perfN = this.perfT = 0;
          if (avg > 0.036 && this.quality !== 'low') this.onSlow?.(this.quality === 'high' ? 'medium' : 'low');
        }
      }
    }
    // animação do taco
    if (this.slide) {
      const sl = this.slide;
      sl.t += dt;
      const k = Math.min(1, sl.t / 0.55);
      const e = k * k * (3 - 2 * k);
      const x = sl.fx + (sl.tx - sl.fx) * e;
      const y = sl.fy + (sl.ty - sl.fy) * e;
      this.balls.setPositions(this.pos.map((p) => (p.id === 0 ? { ...p, x, y } : p)));
      this.cam.tx = x;
      this.cam.ty = y;
      this.cue.setVisible(false);
      if (k >= 1) {
        this.slide = null;
        this.cue.setVisible(true);
      }
    } else if (this.strikeT >= 0 && this.strikeShot) {
      this.strikeT += dt;
      const dur = 0.16;
      const k = Math.min(1, this.strikeT / dur);
      const e = k * k * (3 - 2 * k) * (0.4 + 0.6 * k);
      const cue = this.strikeStart.find((p) => p.id === 0)!;
      const ang = Math.atan2(this.strikeShot.dy, this.strikeShot.dx);
      const pull = this.strikeFromPull * (1 - e);
      this.cue.place(cue.x, cue.y, ang, this.aim.a, this.aim.b, pull, this.cueElev(this.strikeStart, cue.x, cue.y, ang, this.aim.b));
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
      this.cue.place(cue.x, cue.y, ang, this.aim.a, this.aim.b, -Math.min(0.05, this.followT * 0.4), this.cueEl);
      if (this.followT > 0.45) {
        this.cue.setVisible(false);
        this.strikeT = -1;
      }
    }
    if (this.pocketFocus) this.pocketFocus.t -= dt;
    if (this.sim) this.stepSim(dt);
    this.balls.update(dt);
    this.table.update(dt);
    if (!this.lampBottom) this.lampBottom = new THREE.Box3().setFromObject(this.table.lampGroup).min.y;
    // a luminária fica no caminho quando a câmera sobe: some enquanto a câmera estiver perto da altura dela
    this.table.lampGroup.visible = this.lampOn && (this.cam.mode === 'menu' || this.cam.camera.position.y < this.lampBottom - 0.15);
    if (this.sim && this.followCue) {
      const c0 = this.sim.balls[0];
      const fh = this.sim.firstHit >= 0 ? this.sim.balls[this.sim.firstHit] : null;
      this.cam.frame = c0 && c0.on && fh && fh.on && Math.hypot(c0.x - fh.x, c0.y - fh.y) < 1.4 ? [{ x: c0.x, y: c0.y }, { x: fh.x, y: fh.y }] : null;
    }
    this.cam.update(dt, this.sim && this.followCue ? this.followTarget() : undefined);
    this.onFrame?.(dt);
    if (this.post.enabled) this.post.render(dt, this.time);
    else this.renderer.render(this.scene, this.cam.camera);
  }
  private followT = 0;
  private lampOn = true;
  private lampBottom = 0;

  dispose(): void {
    this.stop();
    this.balls.dispose();
    this.renderer.dispose();
  }
}
