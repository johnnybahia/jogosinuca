import { aimTrace } from '../../shared/aim';
import { botPlan } from '../../shared/bot';
import { MAX_SPEED, MIN_SPEED, powerToSpeed, type SimEvent } from '../../shared/physics';
import { avatarEl, btn, h, modal, toast, segmented } from './dom';
import { Hud } from './hud';
import type { Backend } from '../backend';
import { AimInput, type InputMode } from '../game/input';
import { getVolume, isMuted, setMuted, setVolume, sndClick, sndFoul, sndLose, sndTurn, sndWin } from '../game/audio';
import { FELTS } from '../game/tableView';
import type { AimState, PoolView } from '../game/view';
import { avatarColor, loadPrefs, loadStats, savePrefs, saveStats, type Profile } from '../store';
import type { AimMsg, RoomView, ShotEvent } from '../../shared/protocol';
import { MODES, groupName, groupOf, nearestFree, targets, type MatchState } from '../../shared/rules';
import { getPwa, applyUpdate, onPwa } from '../pwa';
import { qualityOptions } from './settings';
import { LobbyPanel } from './lobby';
import { RtcMesh } from '../net/rtc';
import { getIceServers } from '../api';

export interface GameOpts {
  view: PoolView;
  backend: Backend;
  profile: Profile;
  root: HTMLElement;
  onExit(): void;
}

type Phase = 'wait' | 'aim' | 'place' | 'shooting';

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
  /** Mira completa (linha até a caçapa, trajetória da branca e ângulo): bloqueada contra bot Difícil/Mestre; online vale para os dois quando um ativa. */
  private assistBlocked(): boolean {
    return !!this.v?.players.some((p) => p.bot && (p.botLevel === 'dificil' || p.botLevel === 'mestre'));
  }
  private assistOn(): boolean {
    if (this.assistBlocked()) return false;
    return this.backend.mode === 'online' && this.v ? this.v.assist : loadPrefs().assist;
  }
  private assistNote(): string {
    if (this.assistBlocked()) return 'Mira completa indisponível contra bot Difícil ou Mestre.';
    if (this.backend.mode === 'online' && this.v?.assist && !loadPrefs().assist) return 'Ligada pelo adversário: vale para os dois jogadores.';
    if (this.backend.mode === 'online' && loadPrefs().assist) return 'Ligada para os dois jogadores (avisamos o adversário).';
    return '';
  }
  private assistSent: boolean | null = null;
  private refreshAssist(): void {
    this.view.setGuideFull(this.assistOn());
    // online: informa o servidor a preferência (e de novo ao reconectar)
    if (this.backend.mode === 'online' && this.v && this.v.phase !== 'lobby') {
      const want = loadPrefs().assist && !this.assistBlocked();
      const me = this.v.players.find((p) => p.id === this.v!.you);
      if (me && !!me.assist !== want && this.assistSent !== want) {
        this.assistSent = want;
        this.backend.assist(want);
      } else if (me && !!me.assist === want) this.assistSent = null;
    }
  }
  private setAssist(on: boolean): void {
    if (on && this.assistBlocked()) {
      toast('Mira completa indisponível contra bot Difícil ou Mestre.');
      this.overlay?.close();
      return;
    }
    savePrefs({ ...loadPrefs(), assist: on });
    this.assistSent = null;
    if (this.backend.mode === 'online') this.backend.assist(on);
    this.refreshAssist();
    this.view.setGuideFull(this.assistOn());
  }

  /** vista de cima escolhida pelo jogador: a câmera fica fixa (inclusive na tacada e na vez do adversário) */
  private topLock = false;
  private topOff = 0;
  private placeOff = { x: 0, y: 0 };
  private woodGame = 0;
  private turnGame = '';
  /** até quando o aviso do resultado da tacada fica na tela (o aviso de vez espera) */
  private resultUntil = 0;
  private turnToken = 0;
  private spinKeep = { a: 0, b: 0 };
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
  private pill: HTMLElement | null = null;
  private rtc: RtcMesh | null = null;
  /** identifica o "momento" da mesa: atualizações do servidor que não mudam isso (vídeo, conexão…) não reiniciam a mira */
  private turnKey = '';
  private peerIds: string[] = [];
  private rtcStarting = false;
  private offPwa: (() => void) | null = null;

  constructor(private o: GameOpts) {
    this.view = o.view;
    this.backend = o.backend;
    this.profile = o.profile;
    this.hud = new Hud({
      onPower: (p, rel) => this.onPower(p, rel),
      onSpin: (a, b) => this.onSpin(a, b),
      onView: () => this.toggleView(),
      onZoom: () => this.toggleZoom(),
      onTable: () => this.toggleTable(),
      onContact: () => this.toggleContact(),
      onGuide: () => this.toggleGuide(),
      onSound: () => this.toggleSound(),
      onMenu: () => this.openMenu(),
      onStep: (deg) => this.stepAim(deg),
      onBaseCam: () => this.baseCamera(),
      onFine: (d) => this.rotate(d * 0.0016 * (this.view.cam.userDist / 1.05)),
      onConfirmPlace: () => this.confirmPlace(),
      onHint: () => this.hint(),
      onCam: () => void this.toggleMedia('cam'),
      onMic: () => void this.toggleMedia('mic'),
      onEmote: (n) => {
        this.backend.emote(n);
        this.hud.showEmote(this.you, n);
      },
    });
    o.root.replaceChildren(this.hud.root);
    if (o.backend.mode === 'online') this.lobby = new LobbyPanel(o.backend, () => this.confirmExit());
    this.input = new AimInput(o.view.canvas, o.view, {
      mode: () => this.inputMode(),
      rotate: (d) => this.rotate(d),
      pointAt: (x, y, start) => this.pointAt(x, y, start),
      place: (x, y, start) => this.dragCue(x, y, start),
      sens: () => loadPrefs().sens,
    });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('resize', this.onResize);
    this.view.onFrame = (dt) => this.frame(dt);
    this.view.setFelt(loadPrefs().felt);
    this.refreshAssist();
    this.view.onAimInfo = (t) => this.hud.setAimInfo(this.phase === 'aim' ? t : '');
    this.applyWood();
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
          else this.hud.update(this.v, this.photos, this.v.you);
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
      onRtc: (from, data) => void this.rtc?.handle(from, data as never),
      onEmote: (from, n) => this.hud.showEmote(from, n),
      onKicked: () => {
        toast('Você saiu da sala.');
        this.exit();
      },
      onConn: (s) => this.onConn(s),
    };
    this.offPwa = onPwa((st) => this.setUpdate(st.update));
    this.hud.setOnline(o.backend.mode === 'online');
    (window as unknown as { __game: GameScreen }).__game = this;
    be.connect();
  }

  // ---------- estado ----------
  /** meu identificador público na sala (o servidor não mostra o id de verdade) */
  private get you(): string {
    return this.v?.you ?? this.profile.id;
  }
  private get mySeat(): number {
    return this.v?.players.find((p) => p.id === this.v?.you)?.seat ?? -1;
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

  private syncPeers(v: RoomView): void {
    if (this.backend.mode !== 'online') return;
    if (!this.rtc && !this.rtcStarting) {
      this.rtcStarting = true;
      void this.initRtc();
    }
    this.peerIds = v.players.filter((p) => !p.bot && !p.left && p.id !== v.you).map((p) => p.id);
    this.rtc?.setPeers(this.peerIds);
  }

  private apply(v: RoomView, afterShot: boolean): void {
    const prevSeq = this.lastSeq;
    this.v = v;
    this.refreshAssist();
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
    this.syncPeers(v);
    this.hud.update(v, this.photos, v.you);
    const m = v.match;
    if (!m) {
      this.view.setAim(null);
      this.hud.setEnabled(false);
      return;
    }
    const key = `${v.gamesDone}:${v.shotSeq}:${m.turn}:${m.inHand}:${v.phase}`;
    if (!afterShot && key === this.turnKey && !m.over) {
      this.pendingShot = this.phase === 'shooting' ? this.pendingShot : false;
      return; // mesmo momento: só o placar/relógio mudaram
    }
    this.turnKey = key;
    if (v.shotSeq !== this.lastSeq || !afterShot) {
      // snap nas posições oficiais (também cobre reconexão)
      if (!this.pendingShot || v.shotSeq !== prevSeq) this.view.setBalls(m.balls);
    }
    this.lastSeq = v.shotSeq;
    this.pendingShot = false;
    if (v.phase === 'ended' || m.over) {
      this.hud.setTurn('', false);
      this.turnKey = '';
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
    if (v.gamesDone !== this.woodGame) {
      this.woodGame = v.gamesDone;
      this.applyWood();
    }
    this.markMine(m);
    this.enterTurn();
  }

  /** Anel nas bolas do jogador (grupo dele; na 61, a bola da vez). */
  private markMine(m: MatchState): void {
    const ids = new Set<number>();
    const me = this.mySeat;
    if (me >= 0 && !this.v?.practice) {
      if (m.mode === 'bola61') {
        const low = m.balls.filter((b) => b.on && b.id > 0).map((b) => b.id);
        if (low.length) ids.add(Math.min(...low));
      } else {
        const g = m.groups[me];
        if (g) {
          for (const b of m.balls) if (b.on && b.id > 0 && b.id !== 8 && groupOf(m.mode, b.id) === g) ids.add(b.id);
          if (ids.size === 0 && m.balls.some((b) => b.on && b.id === 8)) ids.add(8);
        }
      }
    }
    this.view.setMine(ids);
  }

  /** Decide se é a nossa vez (mira) ou a do adversário (espera). */
  private enterTurn(): void {
    const v = this.v;
    const m = this.match;
    if (!v || !m || v.phase !== 'playing') return;
    if (this.myTurn) {
      const first = !this.myTurnPrev;
      this.myTurnPrev = true;
      this.hud.setTurn('Sua vez', true);
      this.turnGame = String(v.gamesDone);
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
          this.announceTurn('Bola na mão', m.inHand === 'head' ? 'Posicione atrás da linha' : 'Posicione onde quiser', 'info', 1800);
        }
      } else {
        this.beginAim(first);
      }
    } else {
      const wasMine = this.myTurnPrev;
      this.myTurnPrev = false;
      const oppName = v.players.find((p) => p.seat === m.turn)?.name ?? 'adversário';
      this.hud.setTurn(`Vez de ${oppName}`, false);
      // avisa quando a vez passa para o adversário e no começo de cada partida (as tacadas seguidas dele não repetem o aviso)
      const gameKey = String(v.gamesDone);
      if (wasMine || this.turnGame !== gameKey) this.announceTurn(`Vez de ${oppName}`, m.inHand !== 'none' ? 'Bola na mão para ele' : 'Aguarde a jogada', 'wait', 1300);
      this.turnGame = gameKey;
      this.phase = 'wait';
      this.hud.setAimDeg(null);
      this.hud.setPlacing(false);
      this.hud.setEnabled(false);
      this.top = this.topLock;
      this.view.setCameraMode(this.topLock ? 'top' : 'aim');
      const opp = v.players.find((p) => p.seat === m.turn);
      const c = m.balls.find((b) => b.id === 0)!;
      const oppAng = this.bestTargetAngle(m, c);
      this.aim = { angle: oppAng ?? this.aim.angle, a: 0, b: 0, pull: 0.1 };
      this.view.setAim(this.aim, false);
      this.view.cam.aimAngle = this.aim.angle;
      this.view.cam.tx = c.x;
      this.view.cam.ty = c.y;
      this.hud.setHint(opp ? `Vez de ${opp.name}…` : '');
    }
    this.hud.setButtons({ top: this.top, guide: loadPrefs().guide, muted: isMuted() });
  }

  /** Aviso de vez: espera o aviso do resultado da tacada terminar. */
  private announceTurn(title: string, sub: string, kind: 'info' | 'wait', ms = 1500): void {
    const token = ++this.turnToken;
    const wait = Math.max(0, this.resultUntil - performance.now());
    const show = (): void => {
      if (token === this.turnToken) this.hud.showBanner(title, sub, kind, ms);
    };
    if (wait > 0) window.setTimeout(show, wait + 150);
    else show();
  }

  /** Ângulo da branca até a melhor bola legal do jogador da vez: mais perto, e de preferência com caminho livre. */
  private bestTargetAngle(m: MatchState, c: { x: number; y: number }): number | null {
    let best: number | null = null;
    let score = Infinity;
    for (const id of targets(m)) {
      const t = m.balls.find((b) => b.id === id);
      if (!t || !t.on) continue;
      const ang = Math.atan2(t.y - c.y, t.x - c.x);
      const tr = aimTrace(m.balls, c.x, c.y, Math.cos(ang), Math.sin(ang));
      const sc = Math.hypot(t.x - c.x, t.y - c.y) + (tr.hit === id ? 0 : 1.2);
      if (sc < score) {
        score = sc;
        best = ang;
      }
    }
    return best;
  }

  private beginAim(announce: boolean): void {
    const m = this.match!;
    this.phase = 'aim';
    this.view.cam.manualZoom = false;
    this.hud.setPlacing(false);
    this.hud.setEnabled(true);
    this.hud.setPower(0);
    this.hud.setPowerHint(null);
    // a posição escolhida só vale enquanto a branca está na mão; fora disso manda o estado oficial
    if (m.inHand === 'none') this.placed = null;
    const c = this.placed ?? m.balls.find((b) => b.id === 0)!;
    if (this.placed) this.view.setCueBall(this.placed.x, this.placed.y);
    // a mira volta apontando para uma bola do jogador da vez (a mais próxima e com caminho livre)
    const ang = this.bestTargetAngle(m, c);
    if (ang !== null) this.aim.angle = ang;
    else if (!Number.isFinite(this.aim.angle)) this.aim.angle = 0;
    this.spinKeep = { a: 0, b: 0 };
    this.hud.setAimDeg((this.aim.angle * 180) / Math.PI);
    const sp = this.spinKeep;
    this.hud.setSpin(sp.a, sp.b);
    this.aim = { angle: this.aim.angle, a: sp.a, b: sp.b, pull: 0.05 };
    this.top = this.topLock;
    this.view.setCameraMode(this.top ? 'top' : 'aim');
    this.view.setAim(this.aim, loadPrefs().guide);
    this.hud.setHint(announce ? 'Arraste para mirar · puxe a força para baixo e solte' : '', 5000);
    if (announce) {
      sndTurn();
      const mode = MODES.find((x) => x.id === this.v!.mode);
      const g = m.groups[m.turn];
      this.announceTurn('Sua vez', mode?.id === 'bola61' ? `Toque na bola ${[...targets(m)][0] ?? ''}` : g ? `Você joga com as ${groupName(g).toLowerCase()}` : 'Mesa aberta', 'info');
    }
    this.placed = null;
  }

  // ---------- controles ----------
  private rotate(d: number): void {
    if (this.phase !== 'aim') return;
    this.aim.angle += d;
    this.pushAim();
  }
  /** Vista de cima: o dedo gira a mira em volta da branca sem pular (parte do ângulo atual) e funciona de qualquer ponto da tela. */
  private pointAt(x: number, y: number, start = false): void {
    if (this.phase !== 'aim') return;
    const c = this.view.getPositions().find((b) => b.id === 0);
    if (!c) return;
    const dx = x - c.x;
    const dy = y - c.y;
    if (dx * dx + dy * dy < 0.0064) return;
    const ang = Math.atan2(dy, dx);
    if (start) {
      this.topOff = this.aim.angle - ang;
      return;
    }
    this.aim.angle = ang + this.topOff;
    this.pushAim();
  }
  /** Bola na mão: arrasta a partir de qualquer ponto, a bola anda junto com o dedo (sem pular para o toque). */
  private dragCue(x: number, y: number, start = false): void {
    const m = this.match;
    if (!m || this.phase !== 'place') return;
    const c = this.placed ?? m.balls.find((b) => b.id === 0)!;
    if (start) {
      this.placeOff = { x: c.x - x, y: c.y - y };
      return;
    }
    const p = nearestFree(m, x + this.placeOff.x, y + this.placeOff.y);
    this.placed = p;
    this.view.setCueBall(p.x, p.y);
  }
  private confirmPlace(): void {
    if (this.phase !== 'place' || !this.match) return;
    const p = this.placed ?? this.match.balls.find((b) => b.id === 0)!;
    this.placed = { x: p.x, y: p.y };
    this.view.setCueBall(p.x, p.y);
    this.top = this.topLock;
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
    this.spinKeep = { a, b };
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
    this.hud.setAimDeg(this.phase === 'aim' ? (this.aim.angle * 180) / Math.PI : null);
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
    this.hud.setAimDeg(null);
    this.placed = null;
    this.pendingShot = true;
    this.hud.setAimInfo('');
    this.hud.setEnabled(false);
    this.hud.setPowerHint(null);
    this.hud.setHint('');
    const msg = { dx: Math.cos(this.aim.angle), dy: Math.sin(this.aim.angle), v: powerToSpeed(power), a: this.aim.a, b: this.aim.b, cue: m.inHand !== 'none' ? { x: pos.x, y: pos.y } : undefined };
    this.backend.shot(msg);
  }

  /** Dica (só offline): o melhor lance que o Mestre acharia para a posição atual. */
  private hint(): void {
    const m = this.match;
    if (!m || this.backend.mode === 'online' || (this.phase !== 'aim' && this.phase !== 'place')) return;
    const plan = botPlan(m, 'mestre');
    sndClick();
    if (this.phase === 'place') {
      if (plan.cue) {
        this.placed = { x: plan.cue.x, y: plan.cue.y };
        this.view.setCueBall(plan.cue.x, plan.cue.y);
        this.hud.showBanner('Dica', 'Posição sugerida para a branca', 'info', 1400);
      }
      return;
    }
    this.aim.angle = Math.atan2(plan.shot.dy, plan.shot.dx);
    this.aim.a = plan.shot.a;
    this.aim.b = plan.shot.b;
    this.spinKeep = { a: plan.shot.a, b: plan.shot.b };
    this.hud.setSpin(plan.shot.a, plan.shot.b);
    const q = Math.min(1, Math.max(0, (plan.shot.v - MIN_SPEED) / (MAX_SPEED - MIN_SPEED)));
    const p = (-0.35 + Math.sqrt(0.1225 + 2.6 * q)) / 1.3;
    this.hud.setPowerHint(p);
    this.view.setAim(this.aim, true);
    this.hud.showBanner('Dica', 'Mira e força sugeridas (a marca na barra de força)', 'info', 1800);
  }

  private toggleView(): void {
    if (this.phase === 'place') return;
    if (this.phase !== 'aim' && this.phase !== 'wait') return;
    this.top = !this.top;
    this.topLock = this.top;
    if (this.top && this.contact) {
      this.contact = false;
      this.view.setContactView(false);
      this.hud.setContactOn(false);
    }
    this.view.setCameraMode(this.top ? 'top' : 'aim');
    this.hud.setButtons({ top: this.top, guide: loadPrefs().guide, muted: isMuted() });
    sndClick();
  }
  /** Madeira da mesa: a escolhida, ou sorteada a cada partida. */
  private applyWood(): void {
    const pr = loadPrefs();
    const opts = ['classica', 'mogno', 'pacote'];
    const w = pr.wood === 'aleatoria' ? opts[Math.floor(Math.random() * opts.length)]! : pr.wood;
    this.view.setTable(w === 'pacote' ? 'pacote' : 'codigo');
    if (w !== 'pacote') this.view.setWood(w);
    this.view.setCue(pr.cue === 'aleatorio' ? (Math.random() < 0.5 ? 'pacote' : 'classico') : pr.cue);
  }

  /** Um grau de cada vez: toque único, sem arrastar. + = mira para a direita (gira no sentido horário visto de cima). */
  private stepAim(deg: number): void {
    if (this.phase !== 'aim') return;
    this.aim.angle -= (deg * Math.PI) / 180;
    this.pushAim();
    this.hud.setAimDeg((this.aim.angle * 180) / Math.PI);
    sndClick();
  }

  /** Câmera base: tira vista de cima/da mesa/zoom e volta ao enquadramento original. */
  private baseCamera(): void {
    const c = this.view.cam;
    c.userDist = 1.05;
    c.userPitch = 0.5;
    c.topZoom = 1;
    c.overview = false;
    c.manualZoom = false;
    this.contact = false;
    this.view.setContactView(false);
    this.hud.setContactOn(false);
    this.overview = false;
    this.topLock = false;
    if (this.phase !== 'place') {
      this.top = false;
      this.view.setCameraMode('aim');
    }
    this.hud.setTableOn(false);
    this.hud.setZoomOn(false);
    this.hud.setButtons({ top: this.top, guide: loadPrefs().guide, muted: isMuted() });
    sndClick();
  }

  private contact = false;
  /** Câmera de contato (🎯): de perto no ponto em que a branca toca a bola que você está mirando. */
  private toggleContact(): void {
    this.contact = !this.contact;
    if (this.contact) {
      // sai da vista de cima fixa e da vista da mesa
      this.overview = false;
      this.view.setOverview(false);
      this.hud.setTableOn(false);
      if (this.topLock) {
        this.topLock = false;
        this.top = false;
        if (this.phase !== 'place') this.view.setCameraMode('aim');
      }
      this.view.cam.contactDist = 0.5;
    }
    this.view.setContactView(this.contact);
    this.hud.setContactOn(this.contact);
    this.hud.setButtons({ top: this.top, guide: loadPrefs().guide, muted: isMuted() });
    sndClick();
  }

  private overview = false;
  private toggleTable(): void {
    this.overview = !this.overview;
    if (this.overview && this.contact) {
      this.contact = false;
      this.view.setContactView(false);
      this.hud.setContactOn(false);
    }
    this.view.setOverview(this.overview);
    this.hud.setTableOn(this.overview);
    sndClick();
  }

  private toggleZoom(): void {
    const c = this.view.cam;
    if (c.contactMode && c.mode === 'aim' && !c.overview) {
      const near = c.contactDist > 0.35;
      c.contactDist = near ? 0.26 : 0.5;
      this.hud.setZoomOn(near);
      sndClick();
      return;
    }
    if (c.mode === 'top' || c.overview) {
      const near = c.topZoom > 0.6;
      c.topZoom = near ? 0.35 : 1;
      this.hud.setZoomOn(near);
      sndClick();
      return;
    }
    const close = c.userDist > 0.5;
    c.userDist = close ? 0.3 : 1.05;
    this.hud.setZoomOn(close);
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
    if (k === 'z' || k === 'Z') return this.toggleZoom();
    if (k === 't' || k === 'T') return this.toggleTable();
    if (k === 'h' || k === 'H') return this.hint();
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
    if (this.animating || from === this.you || this.myTurn) return;
    this.aim = { angle: a.angle, a: a.a, b: a.b, pull: a.pull };
    if (a.cx !== undefined && a.cy !== undefined) this.view.setCueBall(a.cx, a.cy);
    this.view.setAim(this.aim, false);
  }

  /** tacadas que chegaram com outra ainda rolando (aparelho lento): tocam uma depois da outra */
  private shotQueue: ShotEvent[] = [];

  private onShot(e: ShotEvent): void {
    if (this.animating) {
      this.shotQueue.push(e);
      return;
    }
    this.animating = true;
    this.pendingShot = true;
    this.hud.setEnabled(false);
    this.hud.setHint('');
    this.hud.setPlacing(false);
    const mine = e.by === this.mySeat;
    const ang = Math.atan2(e.shot.dy, e.shot.dx);
    if (!mine) {
      // o adversário mira um instante antes de bater
      const from = Number.isFinite(this.aim.angle) ? this.aim.angle : ang;
      this.view.setBalls(e.start);
      this.top = this.topLock;
      this.view.setCameraMode(this.topLock ? 'top' : 'aim');
      let d = ang - from;
      d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      this.pre = { t0: performance.now(), dur: 650 + Math.min(500, Math.abs(d) * 500), from: from, to: from + d, ev: e };
    } else {
      this.aim = { angle: ang, a: e.shot.a, b: e.shot.b, pull: Math.max(0.05, this.aim.pull) };
      this.play(e);
    }
  }

  private play(e: ShotEvent): void {
    this.view.setCameraMode(this.topLock ? 'top' : 'aim');
    this.top = this.topLock;
    this.view.playShot(e.start, e.shot, {
      onEvent: (ev: SimEvent) => this.onSimEvent(ev),
      onDone: () => this.shotDone(e),
    });
  }

  private onSimEvent(_ev: SimEvent): void {}

  private buzz(ms: number | number[]): void {
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* sem vibração */
    }
  }

  private shotDone(e: ShotEvent): void {
    this.animating = false;
    const out = e.out;
    const mine = e.by === this.mySeat;
    const players = this.v?.players ?? [];
    const who = players.find((p) => p.seat === e.by)?.name ?? '';
    const other = players.find((p) => p.seat !== e.by)?.name ?? 'adversário';
    const banner = (t: string, sub: string, kind: 'good' | 'bad' | 'info' | 'wait', ms: number): void => {
      this.hud.showBanner(t, sub, kind, ms);
      this.resultUntil = performance.now() + ms;
    };
    if (out.over) {
      // fim de jogo: a mensagem diz quem ganhou, nunca "continue"
      const iWon = out.winner === this.mySeat;
      banner(out.message || (iWon ? 'Você venceu' : 'Fim de jogo'), out.reason ?? '', iWon ? 'good' : 'bad', 2400);
      if (mine) this.streak = 0;
    } else if (out.foul) {
      sndFoul();
      this.buzz([60, 40, 60]);
      banner('FALTA', `${who}: ${out.foul}`, 'bad', 2600);
      if (mine) this.streak = 0;
    } else if (out.potted.length && out.again) {
      banner(out.potted.length > 1 ? `${out.potted.length} bolas!` : 'Caçapa!', mine ? 'Continue jogando' : `${who} continua`, mine ? 'good' : 'info', 1700);
      if (mine) this.buzz(35);
    } else if (out.potted.length) {
      // derrubou, mas a vez passa (bola do adversário)
      banner(mine ? 'Bola do adversário' : 'Bola sua', mine ? `Vez de ${other}` : 'Sua vez', mine ? 'info' : 'good', 1700);
      if (mine) this.streak = 0;
    } else if (mine) {
      this.streak = 0;
    }
    if (mine && out.potted.length && out.again && !out.foul && !out.over) {
      this.streak += out.potted.length;
      const st = loadStats();
      st.potted += out.potted.length;
      st.bestStreak = Math.max(st.bestStreak, this.streak);
      saveStats(st);
    }
    const queued = this.shotQueue.shift();
    if (queued) {
      this.onShot(queued);
      return;
    }
    const next = this.deferred ?? this.v;
    this.deferred = null;
    if (next) this.apply(next, true);
  }

  // ---------- quadro a quadro ----------
  private frame(dt: number): void {
    // câmera por cima da mesa (⌖ ou ▦): a barra de força fica transparente para não cobrir a mesa
    const cm = this.view.cam;
    this.hud.root.classList.toggle('overhead', cm.mode === 'top' || (cm.mode === 'aim' && cm.overview));
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

  // ---------- vídeo e áudio ao vivo ----------
  private async initRtc(): Promise<void> {
    if (typeof RTCPeerConnection === 'undefined') return;
    const ice = await getIceServers();
    if (this.done) return;
    this.rtc = new RtcMesh({
      myId: this.you,
      iceServers: ice,
      send: (to, data) => this.backend.rtc(to, data),
      onStream: (id, stream) => this.hud.setStream(id, stream, false),
    });
    this.rtc.setPeers(this.peerIds);
  }

  private async toggleMedia(kind: 'cam' | 'mic'): Promise<void> {
    if (!this.rtc) return toast('Vídeo e áudio só funcionam no jogo online.');
    try {
      if (kind === 'cam') await this.rtc.setCam(!this.rtc.camOn);
      else await this.rtc.setMic(!this.rtc.micOn);
    } catch {
      toast(kind === 'cam' ? 'Não consegui usar a câmera. Verifique a permissão do navegador.' : 'Não consegui usar o microfone. Verifique a permissão do navegador.');
      return;
    }
    this.hud.setStream(this.you, this.rtc.camOn ? this.rtc.localVideo : null, true);
    this.hud.setMedia(this.rtc.camOn, this.rtc.micOn);
    this.backend.media(this.rtc.camOn, this.rtc.micOn);
  }

  // ---------- atualização do jogo ----------
  private setUpdate(on: boolean): void {
    if (on && !this.pill && !this.done) {
      this.pill = h('button', { class: 'upd-pill', text: '⬆ Nova versão disponível', attrs: { type: 'button' }, on: { click: () => this.askUpdate() } });
      this.o.root.append(this.pill);
    } else if (!on && this.pill) {
      this.pill.remove();
      this.pill = null;
    }
  }

  private askUpdate(): void {
    if (this.overlay) return;
    const online = this.backend.mode === 'online';
    const box = h(
      'div',
      { class: 'panel menu-modal' },
      h('h2', { text: 'Atualizar o jogo' }),
      h('p', { class: 'muted', text: online ? 'O jogo vai recarregar e você volta para a mesma partida.' : 'O jogo vai recarregar e esta partida contra o computador será reiniciada.' }),
      h('div', { class: 'row' }, btn('Atualizar agora', () => void applyUpdate(), 'primary'), btn('Depois', () => this.overlay?.close(), 'ghost')),
    );
    this.overlay = modal(box, () => {
      this.overlay = null;
    });
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
    const sensIn = h('input', { class: 'range', attrs: { type: 'range', min: '30', max: '200', value: String(Math.round(p.sens * 100)) } });
    sensIn.addEventListener('input', () => savePrefs({ ...loadPrefs(), sens: Number(sensIn.value) / 100 }));
    const upd = getPwa().update ? btn('Atualizar o jogo', () => void applyUpdate(), 'primary') : null;
    const online = this.backend.mode === 'online';
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
      h('div', { class: 'setting' }, h('span', { text: 'Linha de mira' }), segmented([{ value: 'first', label: 'Só contato' }, { value: 'full', label: 'Completa' }], this.assistOn() ? 'full' : 'first', (id) => this.setAssist(id === 'full'))),
      this.assistNote() ? h('div', { class: 'hint-line', text: this.assistNote() }) : null,
      h('div', { class: 'setting' }, h('span', { text: 'Madeira da mesa' }), segmented([{ value: 'aleatoria', label: 'Aleatória' }, { value: 'classica', label: 'Clássica' }, { value: 'mogno', label: 'Mogno' }, { value: 'pacote', label: 'Pacote' }], p.wood, (id) => {
        savePrefs({ ...loadPrefs(), wood: id });
        this.applyWood();
      })),
      h('div', { class: 'setting' }, h('span', { text: 'Taco' }), segmented([{ value: 'aleatorio', label: 'Aleatório' }, { value: 'classico', label: 'Clássico' }, { value: 'pacote', label: 'Pacote' }], p.cue, (id) => {
        savePrefs({ ...loadPrefs(), cue: id });
        this.view.setCue(id === 'aleatorio' ? (Math.random() < 0.5 ? 'pacote' : 'classico') : id);
      })),
      online ? h('div', { class: 'row' }, btn(this.rtc?.camOn ? '📷 Câmera ligada' : '🚫 Câmera desligada', () => { void this.toggleMedia('cam').then(() => this.overlay?.close()); }), btn(this.rtc?.micOn ? '🎤 Microfone ligado' : '🔇 Microfone desligado', () => { void this.toggleMedia('mic').then(() => this.overlay?.close()); })) : null,
      this.backend.isPractice ? btn('Reorganizar o triângulo', () => { this.overlay?.close(); this.backend.rerack?.(); }) : null,
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
    const isHost = v.hostId === v.you;
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
    this.pill?.remove();
    this.rtc?.close();
    this.offPwa?.();
    this.backend.leave();
    this.o.root.replaceChildren();
    this.o.onExit();
  }
}

