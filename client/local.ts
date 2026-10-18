import type { Backend, BackendEvents } from './backend';
import { noopEvents } from './backend';
import { BOT_NAMES, thinkMs, type BotLevel } from '../shared/bot';
import type { AimMsg, BestOf, RoomView, ShotMsg, TurnSeconds } from '../shared/protocol';
import { newRoom, RoomCore } from '../shared/room';
import type { Mode } from '../shared/rules';
import type { OfflineSettings, Profile } from './store';
import { newMatch } from '../shared/rules';

/** Partida contra o bot, tudo no aparelho: usa a mesma lógica de sala do servidor. */
export class LocalBackend implements Backend {
  readonly mode = 'offline' as const;
  events: BackendEvents = noopEvents;
  private core: RoomCore;
  private timer = 0;
  private tick = 0;
  private dead = false;

  constructor(private profile: Profile, cfg: OfflineSettings, private practice = false) {
    this.core = new RoomCore(newRoom('LOCAL', { mode: practice ? 'par_impar' : cfg.mode, turnSeconds: practice ? 0 : cfg.turnSeconds }));
    this.core.d.practice = practice;
    this.core.d.hostColor = cfg.color;
    this.core.join(profile.id, profile.name);
    this.core.setBot(profile.id, true, practice ? 'facil' : cfg.level);
    if (practice) {
      const b = this.core.d.players.find((p) => p.bot);
      if (b) b.name = 'Treino livre';
    }
    this.core.start(profile.id, Date.now());
    if (practice) this.core.d.breaker = this.core.seatOf(profile.id);
    if (practice && this.core.d.match) this.core.d.match.turn = this.core.seatOf(profile.id);
  }

  get isPractice(): boolean {
    return this.practice;
  }

  /** Treino: a vez é sempre sua, sem faltas; só a branca na mão se cair. Mesa limpa = novo triângulo. */
  private fixPractice(ev: { out: { foul: string | null; again: boolean; message: string } }): void {
    const d = this.core.d;
    const m = d.match;
    if (!m) return;
    const my = this.core.seatOf(this.profile.id);
    const cue = m.balls.find((b) => b.id === 0);
    ev.out.foul = null;
    ev.out.again = true;
    ev.out.message = '';
    m.turn = my;
    m.groups = [null, null];
    m.score = [m.tray.length, 0];
    m.inHand = cue && !cue.on ? 'any' : 'none';
    if (cue && !cue.on) {
      cue.on = true;
    }
    m.over = false;
    if (d.phase === 'ended') {
      d.phase = 'playing';
      d.result = undefined;
    }
    if (!m.balls.some((b) => b.on && b.id > 0)) this.rerack(false);
    d.shotSeq++;
  }

  /** Treino: arruma o triângulo de novo. */
  rerack(emit = true): void {
    const d = this.core.d;
    if (!this.practice || !d.match) return;
    const my = this.core.seatOf(this.profile.id);
    const fresh = newMatch(d.mode, my);
    fresh.tray = [];
    d.match = fresh;
    d.phase = 'playing';
    d.result = undefined;
    d.shotSeq++;
    if (emit) this.emit();
  }

  private view(): RoomView {
    return this.core.view(this.profile.id, Date.now(), () => true);
  }

  private emit(): void {
    this.events.onView(this.view());
  }

  connect(): void {
    this.events.onConn('open');
    this.emit();
    this.scheduleBot(600);
    window.clearInterval(this.tick);
    this.tick = window.setInterval(() => {
      const r = this.core.timeout(Date.now());
      if (r) {
        this.events.onNotice(r.notice);
        this.emit();
        this.scheduleBot(800);
      }
    }, 500);
  }

  private scheduleBot(extraMs: number): void {
    window.clearTimeout(this.timer);
    if (this.dead || !this.core.botTurn()) return;
    const lvl = (this.core.botTurn()?.botLevel ?? 'normal') as BotLevel;
    this.timer = window.setTimeout(() => {
      if (this.dead) return;
      const plan = this.core.planBot();
      const bot = this.core.botTurn();
      if (!plan || !bot) return;
      const r = this.core.shot(bot.id, plan.shot, Date.now());
      if ('error' in r) return;
      this.events.onShot(r.ev);
      this.emit();
      this.scheduleBot(r.simSeconds * 1000 + 1400);
    }, extraMs + thinkMs(lvl));
  }

  start(): void {
    if (this.core.start(this.profile.id, Date.now())) {
      this.emit();
      this.scheduleBot(600);
    }
  }
  settings(opts: { mode?: Mode; turnSeconds?: TurnSeconds; bestOf?: BestOf; hostColor?: 'blue' | 'red' }): void {
    if (this.core.setSettings(this.profile.id, opts)) this.emit();
  }
  shot(msg: ShotMsg): void {
    const r = this.core.shot(this.profile.id, msg, Date.now());
    if ('error' in r) return void this.events.onError(r.error);
    if (this.practice) this.fixPractice(r.ev);
    this.events.onShot(r.ev);
    this.emit();
    this.scheduleBot(r.simSeconds * 1000 + 1400);
  }
  aim(_a: AimMsg): void {}
  next(): void {
    if (this.core.next(this.profile.id, Date.now())) {
      this.emit();
      this.scheduleBot(800);
    }
  }
  bot(): void {}
  kick(): void {}
  media(): void {}
  assist(): void {}
  penalty(choice: 'hand' | 'revive'): void {
    const r = this.core.penalty(this.profile.id, choice, Date.now());
    if (!r.ok) return void this.events.onError(r.error ?? 'Penalidade inválida.');
    this.emit();
  }
  rtc(): void {}
  emote(): void {}
  leave(): void {
    this.dead = true;
    window.clearTimeout(this.timer);
    window.clearInterval(this.tick);
  }
  get botName(): string {
    return BOT_NAMES[(this.core.d.players.find((p) => p.bot)?.botLevel ?? 'normal') as BotLevel];
  }
}
