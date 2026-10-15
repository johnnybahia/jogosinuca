import { aimTrace } from '../../shared/aim';
import { powerToSpeed, type BallPos, type SimEvent } from '../../shared/physics';
import { avatarEl, btn, h, modal, toast, segmented } from './dom';
import { Hud } from './hud';
import type { Backend } from '../backend';
import { AimInput, type InputMode } from '../game/input';
import { getVolume, isMuted, setMuted, setVolume, sndClick, sndFoul, sndLose, sndTurn, sndWin } from '../game/audio';
import { FELTS } from '../game/tableView';
import type { AimState, PoolView } from '../game/view';
import { avatarColor, loadPrefs, loadStats, savePrefs, saveStats, type Profile } from '../store';
import { BOT_LABEL, BOT_LEVELS, type BotLevel } from '../../shared/bot';
import type { AimMsg, RoomView, ShotEvent } from '../../shared/protocol';
import { MODES, groupName, nearestFree, targets, type MatchState } from '../../shared/rules';
import { getPwa, applyUpdate } from '../pwa';
import { qualityOptions } from './settings';
import { LobbyPanel } from './lobby';

export interface GameOpts {
  view: PoolView;
  backend: Backend;
  profile: Profile;
  root: HTMLElement;
  onExit(): void;
}

type Phase = 'wait' | 'aim' | 'place' | 'shooting';

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

/** Tela da partida: liga o backend (local ou online) à cena 3D, aos controles e à interface. */
export class GameScreen {
  private view: PoolView;
  private backend: Backend;
  private profile: Profile;
  private hud: Hud;
  private input: AimInput;
  private v: RoomView | null = null;
  private deferred: RoomView | null = null;
  private photos: Record<string, string> = {};
  private phase: Phase = 'wait';
  private animating = false;
  private aim: AimState = { angle: 0, a: 0, b: 0, pull: 0.05 };
  private placed: { x: number; y: number } | null = null;
  private lastSeq = -1;
  private seenResult = false;
  private top = false;
  private clockOffset = 0;
  private myTurnPrev = false;
  private oppAimAt = 0;
  private pre: { t0: number; dur: number; from: number; to: number; ev: ShotEvent } | null = null;
  private keys = new Set<string>();
  private charging = 0;
  private done = false;
  private overlay: { close(): void } | null = null;
  private pendingShot = false;
  private streak = 0;
  private countedGame = -1;
  private connBanner: HTMLElement | null = null;
  private lobby: LobbyPanel | null = null;

  constructor(private o: GameOpts) {
    this.view = o.view;
    this.backend = o.backend;
    this.profile = o.profile;
    this.hud = new Hud({
      onPower: (p, rel) => this.onPower(p, rel),
      onSpin: (a, b) => this.onSpin(a, b),
      onView: () => this.toggleView(),
      onGuide: () => this.toggleGuide(),
      onSound: () => this.toggleSound(),
      onMenu: () => this.openMenu(),
      onFine: (d) => this.rotate(d * 0.0016 * (this.view.cam.userDist / 1.05)),
      onConfirmPlace: () => this.confirmPlace(),
    });
    o.root.replaceChildren(this.hud.root);
    if (o.backend.mode === 'online') this.lobby = new LobbyPanel(o.backend, o.profile.id, () => this.confirmExit());
    this.input = new AimInput(o.view.canvas, o.view, {
      mode: () => this.inputMode(),
      rotate: (d) => this.rotate(d),
      pointAt: (x, y) => this.pointAt(x, y),
      place: (x, y) => this.dragCue(x, y),
      sens: () => loadPrefs().sens,
      cuePos: () => this.placed,
    });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('resize', this.onResize);
    this.view.onFrame = (dt) => this.frame(dt);
    this.view.setFelt(loadPrefs().felt);
    this.hud.setButtons({ top: false, guide: loadPrefs().guide, muted: isMuted() });

    const be = this.backend;
    be.events = {
      onView: (v) => this.onView(v),
      onShot: (e) => this.onShot(e),
      onAim: (from, a) => this.onOppAim(from, a),
      onPhoto: (id, data) => {
        this.photos[id] = data;
        if (this.v) {
          if (this.v.phase === 'lobby') this.lobby?.render(this.v, this.photos);
          else this.hud.update(this.v, this.photos, this.profile.id);
        }
      },
      onNotice: (t) => toast(t),
      onError: (m) => {
        toast(m);
        if (this.pendingShot) {
          this.pendingShot = false;
          this.enterTurn();
        }
      },
      onKicked: () => {
        toast('Você saiu da sala.');
        this.exit();
      },
      onConn: (s) => this.onConn(s),
    };
    (window as unknown as { __game: GameScreen }).__game = this;
    be.connect();
  }

  // ---------- estado ----------
  private get mySeat(): number {
    return this.v?.players.find((p) => p.id === this.profile.id)?.seat ?? -1;
  }
  private get match(): MatchState | null {
    return this.v?.match ?? null;
  }
  private get myTurn(): boolean {
    const m = this.match;
    return !!m && !!this.v && this.v.phase === 'playing' && m.turn === this.mySeat && !m.over;
  }

  private inputMode(): InputMode {
    if (this.done || this.overlay) return 'off';
    if (this.phase === 'place') return 'place';
    if (this.phase === 'aim') return this.top ? 'top' : 'aim';
    return this.animating || this.phase === 'shooting' ? 'off' : 'aim';
  }

  private onConn(s: 'connecting' | 'open' | 'closed'): void {
    if (this.backend.mode !== 'online') return;
    if (s === 'open') {
      this.connBanner?.remove();
      this.connBanner = null;
    } else if (!this.connBanner && !this.done) {
      this.connBanner = h('div', { class: 'conn', text: s === 'connecting' ? 'Conectando…' : 'Reconectando…' });
      this.o.root.append(this.connBanner);
    }
  }

  private onView(v: RoomView): void {
    this.clockOffset = v.serverNow - Date.now();
    if (this.animating || this.pre) {
      this.deferred = v;
      this.v = { ...v, match: this.v?.match ?? v.match };
      return;
    }
    this.apply(v, false);
  }

  private apply(v: RoomView, afterShot: boolean): void {
    const prevSeq = this.lastSeq;
    this.v = v;
    if (this.lobby) {
      if (v.phase === 'lobby') {
        if (!this.lobby.el.isConnected) this.o.root.append(this.lobby.el);
        this.lobby.render(v, this.photos);
        this.hud.root.style.display = 'none';
        this.view.setCameraMode('menu');
        this.view.setAim(null);
        this.phase = 'wait';
        return;
      }
      if (this.lobby.el.isConnected) {
        this.lobby.el.remove();
        this.hud.root.style.display = '';
        this.view.setBalls(v.match?.balls ?? []);
      }
    }
    this.hud.update(v, this.photos, this.profile.id);
    const m = v.match;
    if (!m) {
      this.view.setAim(null);
      this.hud.setEnabled(false);
      return;
    }
    if (v.shotSeq !== this.lastSeq || !afterShot) {
      // snap nas posições oficiais (também cobre reconexão)
      if (!this.pendingShot || v.shotSeq !== prevSeq) this.view.setBalls(m.balls);
    }
    this.lastSeq = v.shotSeq;
    this.pendingShot = false;
    if (v.phase === 'ended' || m.over) {
      this.phase = 'wait';
      this.hud.setEnabled(false);
      this.view.setAim(null);
      if (!this.seenResult) {
        this.seenResult = true;
        window.setTimeout(() => this.showResult(), afterShot ? 900 : 200);
      }
      return;
    }
    this.seenResult = false;
    this.enterTurn();
  }

  /** Decide se é a nossa vez (mira) ou a do adversário (espera). */
  private enterTurn(): void {
    const v = this.v;
    const m = this.match;
    if (!v || !m || v.phase !== 'playing') return;
    if (this.myTurn) {
      const first = !this.myTurnPrev;
      this.myTurnPrev = true;
      if (m.inHand !== 'none') {
        this.phase = 'place';
        const c = m.balls.find((b) => b.id === 0)!;
        this.placed = { x: c.x, y: c.y };
        this.top = true;
        this.view.setCameraMode('top');
        this.hud.setPlacing(true);
        this.hud.setHint('');
        this.hud.setEnabled(false);
        this.view.setAim(null);
        if (first) {
          sndTurn();
          this.hud.showBanner('Bola na mão', m.inHand === 'head' ? 'Posicione atrás da linha' : 'Posicione onde quiser', 'info');
        }
      } else {
        this.beginAim(first);
      }
    } else {
      this.myTurnPrev = false;
      this.phase = 'wait';
      this.hud.setPlacing(false);
      this.hud.setEnabled(false);
      this.top = false;
      this.view.setCameraMode('aim');
      const opp = v.players.find((p) => p.seat === m.turn);
      const c = m.balls.find((b) => b.id === 0)!;
      this.aim = { angle: this.aim.angle, a: 0, b: 0, pull: 0.1 };
      this.view.setAim(this.aim, false);
      this.view.cam.aimAngle = this.aim.angle;
      this.view.cam.tx = c.x;
      this.view.cam.ty = c.y;
      this.hud.setHint(opp ? `Vez de ${opp.name}…` : '');
    }
    this.hud.setButtons({ top: this.top, guide: loadPrefs().guide, muted: isMuted() });
  }

  private beginAim(announce: boolean): void {
    const m = this.match!;
    this.phase = 'aim';
    this.hud.setPlacing(false);
    this.hud.setEnabled(true);
    this.hud.setPower(0);
    const c = this.placed ?? m.balls.find((b) => b.id === 0)!;
    if (this.placed) this.view.setCueBall(this.placed.x, this.placed.y);
    // mira inicial: para a bola alvo mais próxima
    const tg = targets(m).map((id) => m.balls.find((b) => b.id === id)!).filter(Boolean);
    let best: BallPos | null = null;
    let bd = Infinity;
    for (const b of tg) {
      const d = (b.x - c.x) ** 2 + (b.y - c.y) ** 2;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (best && (announce || !Number.isFinite(this.aim.angle))) this.aim.angle = Math.atan2(best.y - c.y, best.x - c.x);
    const sp = this.hud.spinNow;
    this.aim = { angle: this.aim.angle, a: sp.a, b: sp.b, pull: 0.05 };
    this.top = this.top && this.phase === 'aim' ? this.top : false;
    this.view.setCameraMode(this.top ? 'top' : 'aim');
    this.view.setAim(this.aim, loadPrefs().guide);
    this.hud.setHint(announce ? 'Arraste para mirar · puxe a força para baixo e solte' : '', 5000);
    if (announce) {
      sndTurn();
      const mode = MODES.find((x) => x.id === this.v!.mode);
      const g = m.groups[m.turn];
      this.hud.showBanner('Sua vez', mode?.id === 'bola61' ? `Toque na bola ${[...targets(m)][0] ?? ''}` : g ? `Você joga com as ${groupName(g).toLowerCase()}` : 'Mesa aberta', 'info', 1500);
    }
    this.placed = null;
  }

  // ---------- controles ----------
  private rotate(d: number): void {
    if (this.phase !== 'aim') return;
    this.aim.angle += d;
    this.pushAim();
  }
  private pointAt(x: number, y: number): void {
    if (this.phase !== 'aim') return;
    const c = this.view.getPositions().find((b) => b.id === 0);
    if (!c) return;
    const dx = x - c.x;
    const dy = y - c.y;
    if (dx * dx + dy * dy < 0.0016) return;
    this.aim.angle = Math.atan2(dy, dx);
    this.pushAim();
  }
  private dragCue(x: number, y: number): void {
    const m = this.match;
    if (!m || this.phase !== 'place') return;
    const p = nearestFree(m, x, y);
    this.placed = p;
    this.view.setCueBall(p.x, p.y);
  }
  private confirmPlace(): void {
    if (this.phase !== 'place' || !this.match) return;
    const p = this.placed ?? this.match.balls.find((b) => b.id === 0)!;
    this.placed = { x: p.x, y: p.y };
    this.view.setCueBall(p.x, p.y);
    this.top = false;
    sndClick();
    this.beginAim(false);
    // mantém a posição escolhida para a tacada
    this.placed = { x: p.x, y: p.y };
    const m = this.match;
    const tg = targets(m).map((id) => m.balls.find((b) => b.id === id)!).filter(Boolean);
    let bd = Infinity;
    for (const b of tg) {
      const d = (b.x - p.x) ** 2 + (b.y - p.y) ** 2;
      if (d < bd) {
        bd = d;
        this.aim.angle = Math.atan2(b.y - p.y, b.x - p.x);
      }
    }
    this.view.setAim(this.aim, loadPrefs().guide);
    this.pushAim();
  }
  private onSpin(a: number, b: number): void {
    if (this.phase !== 'aim') return;
    this.aim.a = a;
    this.aim.b = b;
    this.pushAim();
  }
  private onPower(p: number, release: boolean): void {
    if (this.phase !== 'aim') return;
    this.aim.pull = 0.04 + p * 0.24;
    this.pushAim(false);
    if (release) {
      if (p < 0.04) {
        this.aim.pull = 0.05;
        this.hud.setPower(0);
        this.pushAim(false);
        return;
      }
      this.fire(p);
    }
  }
  private pushAim(send = true): void {
    this.view.setAim(this.aim, loadPrefs().guide);
    if (send && this.backend.mode === 'online') {
      const now = performance.now();
      if (now - this.oppAimAt > 90) {
        this.oppAimAt = now;
        const c = this.view.getPositions().find((b) => b.id === 0);
        this.backend.aim({ angle: this.aim.angle, a: this.aim.a, b: this.aim.b, pull: this.aim.pull, cx: c?.x, cy: c?.y });
      }
    }
  }

  private fire(power: number): void {
    if (this.phase !== 'aim' || !this.match) return;
    const m = this.match;
    const c = m.balls.find((b) => b.id === 0)!;
    const pos = this.view.getPositions().find((b) => b.id === 0) ?? c;
    this.phase = 'shooting';
    this.pendingShot = true;
    this.hud.setEnabled(false);
    this.hud.setHint('');
    const msg = { dx: Math.cos(this.aim.angle), dy: Math.sin(this.aim.angle), v: powerToSpeed(power), a: this.aim.a, b: this.aim.b, cue: m.inHand !== 'none' ? { x: pos.x, y: pos.y } : undefined };
    this.backend.shot(msg);
  }

  private toggleView(): void {
    if (this.phase === 'place') return;
    if (this.phase !== 'aim' && this.phase !== 'wait') return;
    this.top = !this.top;
    this.view.setCameraMode(this.top ? 'top' : 'aim');
    this.hud.setButtons({ top: this.top, guide: loadPrefs().guide, muted: isMuted() });
    sndClick();
  }
  private toggleGuide(): void {
    const p = loadPrefs();
    savePrefs({ ...p, guide: !p.guide });
    if (this.phase === 'aim') this.view.setAim(this.aim, !p.guide);
    this.hud.setButtons({ top: this.top, guide: !p.guide, muted: isMuted() });
    sndClick();
  }
  private toggleSound(): void {
    setMuted(!isMuted());
    this.hud.setButtons({ top: this.top, guide: loadPrefs().guide, muted: isMuted() });
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.done) return;
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const k = e.key;
    if (k === 'Escape') return this.openMenu();
    if (this.overlay) return;
    if (k === 'v' || k === 'V') return this.toggleView();
    if (k === 'g' || k === 'G') return this.toggleGuide();
    if (k === 'm' || k === 'M') return this.toggleSound();
    if (k === ' ' && this.phase === 'aim') {
      e.preventDefault();
      if (!e.repeat) this.charging = 0.001;
      return;
    }
    if (k === 'Enter' && this.phase === 'place') return this.confirmPlace();
    this.keys.add(k);
  };
  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key);
    if (e.key === ' ' && this.charging > 0) {
      const p = this.charging;
      this.charging = 0;
      if (this.phase === 'aim' && p > 0.04) {
        this.hud.setPower(p);
        this.fire(p);
      } else if (this.phase === 'aim') {
        this.hud.setPower(0);
        this.aim.pull = 0.05;
        this.pushAim(false);
      }
    }
  };
  private onResize = (): void => this.view.resize();

  // ---------- adversário ----------
  private onOppAim(from: string, a: AimMsg): void {
    if (this.animating || from === this.profile.id || this.myTurn) return;
    this.aim = { angle: a.angle, a: a.a, b: a.b, pull: a.pull };
    if (a.cx !== undefined && a.cy !== undefined) this.view.setCueBall(a.cx, a.cy);
    this.view.setAim(this.aim, false);
  }

  private onShot(e: ShotEvent): void {
    this.animating = true;
    this.pendingShot = true;
    this.hud.setEnabled(false);
    this.hud.setHint('');
    this.hud.setPlacing(false);
    const mine = e.by === this.mySeat;
    const ang = Math.atan2(e.shot.dy, e.shot.dx);
    const sp = this.hud.spinNow;
    if (!mine) {
      // o adversário mira um instante antes de bater
      const from = Number.isFinite(this.aim.angle) ? this.aim.angle : ang;
      this.view.setBalls(e.start);
      this.top = false;
      this.view.setCameraMode('aim');
      let d = ang - from;
      d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      this.pre = { t0: performance.now(), dur: 650 + Math.min(500, Math.abs(d) * 500), from: from, to: from + d, ev: e };
    } else {
      this.aim = { angle: ang, a: e.shot.a, b: e.shot.b, pull: Math.max(0.05, this.aim.pull) };
      this.play(e);
    }
    void sp;
  }

  private play(e: ShotEvent): void {
    this.view.setCameraMode('aim');
    this.top = false;
    this.view.playShot(e.start, e.shot, {
      onEvent: (ev: SimEvent) => this.onSimEvent(ev),
      onDone: () => this.shotDone(e),
    });
  }

  private onSimEvent(_ev: SimEvent): void {}

  private shotDone(e: ShotEvent): void {
    this.animating = false;
    const out = e.out;
    const mine = e.by === this.mySeat;
    const who = this.v?.players.find((p) => p.seat === e.by)?.name ?? '';
    if (out.foul) {
      sndFoul();
      this.hud.showBanner('FALTA', `${who}: ${out.foul}`, 'bad', 2600);
      if (mine) this.streak = 0;
    } else if (out.potted.length) {
      this.hud.showBanner(out.potted.length > 1 ? `${out.potted.length} bolas!` : 'Caçapa!', mine ? 'Continue jogando' : `${who} continua`, mine ? 'good' : 'info', 1700);
      if (mine) {
        this.streak += out.potted.length;
        const st = loadStats();
        st.potted += out.potted.length;
        st.bestStreak = Math.max(st.bestStreak, this.streak);
        saveStats(st);
      }
    } else if (mine) {
      this.streak = 0;
    }
    const next = this.deferred ?? this.v;
    this.deferred = null;
    if (next) this.apply(next, true);
  }

  // ---------- quadro a quadro ----------
  private frame(dt: number): void {
    // espera/mira do adversário
    if (this.pre) {
      const t = (performance.now() - this.pre.t0) / this.pre.dur;
      const k = Math.min(1, t);
      const e = k * k * (3 - 2 * k);
      const ang = this.pre.from + (this.pre.to - this.pre.from) * e;
      const pull = 0.06 + 0.2 * Math.sin(Math.min(1, t) * Math.PI) * (t < 0.6 ? 1 : 0.4) + (t > 0.7 ? 0.04 : 0);
      this.aim = { angle: ang, a: this.pre.ev.shot.a, b: this.pre.ev.shot.b, pull };
      this.view.setAim(this.aim, false);
      if (t >= 1) {
        const ev = this.pre.ev;
        this.pre = null;
        this.aim = { angle: this.pre ? 0 : Math.atan2(ev.shot.dy, ev.shot.dx), a: ev.shot.a, b: ev.shot.b, pull: 0.1 };
        this.play(ev);
      }
    }
    // teclado
    if (this.phase === 'aim') {
      const fine = this.keys.has('Shift');
      const rate = (fine ? 0.35 : 1.4) * dt * (this.view.cam.userDist / 1.05);
      if (this.keys.has('ArrowLeft') || this.keys.has('a')) this.rotate(rate);
      if (this.keys.has('ArrowRight') || this.keys.has('d')) this.rotate(-rate);
      if (this.keys.has('ArrowUp') || this.keys.has('w')) this.input.zoom(Math.exp(-dt * 1.6));
      if (this.keys.has('ArrowDown') || this.keys.has('s')) this.input.zoom(Math.exp(dt * 1.6));
      if (this.charging > 0) {
        this.charging = Math.min(1, this.charging + dt * 0.8);
        this.hud.setPower(this.charging);
        this.aim.pull = 0.04 + this.charging * 0.24;
        this.pushAim(false);
      }
    }
    // relógio do turno
    const v = this.v;
    if (v && v.phase === 'playing' && v.turnEndsAt !== null && v.turnSeconds > 0) {
      const left = (v.turnEndsAt - (Date.now() + this.clockOffset)) / 1000;
      this.hud.setTimer(left, this.myTurn);
    } else this.hud.setTimer(null, false);
  }

  // ---------- menus ----------
  private openMenu(): void {
    if (this.done) return;
    if (this.overlay) {
      this.overlay.close();
      return;
    }
    const p = loadPrefs();
    const volIn = h('input', { class: 'range', attrs: { type: 'range', min: '0', max: '100', value: String(Math.round(getVolume() * 100)) } });
    volIn.addEventListener('input', () => setVolume(Number(volIn.value) / 100));
    const sensIn = h('input', { class: 'range', attrs: { type: 'range', min: '50', max: '200', value: String(Math.round(p.sens * 100)) } });
    sensIn.addEventListener('input', () => savePrefs({ ...loadPrefs(), sens: Number(sensIn.value) / 100 }));
    const upd = getPwa().update ? btn('Atualizar o jogo', () => void applyUpdate(), 'primary') : null;
    const box = h(
      'div',
      { class: 'panel menu-modal' },
      h('h2', { text: 'Pausa' }),
      h('div', { class: 'setting' }, h('span', { text: 'Volume' }), volIn),
      h('div', { class: 'setting' }, h('span', { text: 'Sensibilidade da mira' }), sensIn),
      h('div', { class: 'setting' }, h('span', { text: 'Gráficos' }), segmented(qualityOptions(), p.quality, (q) => {
        savePrefs({ ...loadPrefs(), quality: q });
        this.view.setQuality(q);
      })),
      h('div', { class: 'setting' }, h('span', { text: 'Pano da mesa' }), segmented(FELTS.map((f) => ({ value: f.id, label: f.name.split(' ')[0]! })), p.felt, (id) => {
        savePrefs({ ...loadPrefs(), felt: id });
        this.view.setFelt(id);
      })),
      upd,
      h('div', { class: 'row' }, btn('Continuar', () => this.overlay?.close(), 'primary'), btn('Sair da partida', () => this.confirmExit(), 'danger')),
    );
    this.overlay = modal(box, () => {
      this.overlay = null;
    });
  }

  private confirmExit(): void {
    this.overlay?.close();
    const box = h(
      'div',
      { class: 'panel menu-modal' },
      h('h2', { text: 'Sair da partida?' }),
      h('p', { class: 'muted', text: this.backend.mode === 'online' ? 'Sair no meio conta como abandono.' : 'O jogo atual será perdido.' }),
      h('div', { class: 'row' }, btn('Cancelar', () => this.overlay?.close(), 'ghost'), btn('Sair', () => this.exit(), 'danger')),
    );
    this.overlay = modal(box, () => {
      this.overlay = null;
    });
  }

  private showResult(): void {
    const v = this.v;
    if (!v || !v.result) return;
    this.overlay?.close();
    const me = this.mySeat;
    const won = v.result.winner === me;
    const winner = v.players.find((p) => p.seat === v.result!.winner);
    (won ? sndWin : sndLose)();
    if (this.backend.mode === 'offline' && this.countedGame !== v.gamesDone) {
      this.countedGame = v.gamesDone;
      const st = loadStats();
      st.games++;
      if (won) st.wins++;
      const bot = v.players.find((p) => p.bot);
      if (bot?.botLevel) {
        const r = (st.vsBot[bot.botLevel] ??= { games: 0, wins: 0 });
        r.games++;
        if (won) r.wins++;
      }
      saveStats(st);
    }
    const isHost = v.hostId === this.profile.id;
    const seriesOver = v.bestOf === 1 || v.players.some((p) => p.wins > v.bestOf / 2) || !!v.result.forfeit;
    const rows = v.players.map((p) => h('div', { class: `res-row${p.seat === v.result!.winner ? ' win' : ''}` }, avatarEl(p.name, avatarColor(p.id), this.photos[p.id] ?? null, 'avatar'), h('span', { text: p.name }), h('b', { text: v.bestOf > 1 ? String(p.wins) : p.seat === v.result!.winner ? '🏆' : '' })));
    const actions: HTMLElement[] = [];
    if (isHost) actions.push(btn(seriesOver ? 'Jogar de novo' : 'Próxima partida', () => { this.overlay?.close(); this.seenResult = false; if (seriesOver) this.backend.start(); else this.backend.next(); }, 'primary'));
    else actions.push(h('div', { class: 'muted', text: 'Aguardando o anfitrião…' }));
    actions.push(btn('Menu', () => this.exit(), 'ghost'));
    const box = h(
      'div',
      { class: `panel result ${won ? 'won' : 'lost'}` },
      h('div', { class: 'res-title', text: won ? 'Você venceu!' : `${winner?.name ?? 'Adversário'} venceu` }),
      h('div', { class: 'res-sub', text: v.result.reason }),
      h('div', { class: 'res-rows' }, ...rows),
      h('div', { class: 'row' }, ...actions),
    );
    this.overlay = modal(box, () => {
      this.overlay = null;
    });
  }

  exit(): void {
    if (this.done) return;
    this.done = true;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('resize', this.onResize);
    this.input.destroy();
    this.view.onFrame = null;
    this.view.finishAt(this.view.getPositions());
    this.view.setAim(null);
    this.overlay?.close();
    this.connBanner?.remove();
    this.lobby?.el.remove();
    this.backend.leave();
    this.o.root.replaceChildren();
    this.o.onExit();
  }
}

export { BOT_LABEL, BOT_LEVELS };
export type { BotLevel };
void aimTrace;
void clamp;
