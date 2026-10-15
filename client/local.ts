import type { Backend, BackendEvents } from './backend';
import { noopEvents } from './backend';
import { BOT_NAMES, thinkMs, type BotLevel } from '../shared/bot';
import type { AimMsg, BestOf, RoomView, ShotMsg, TurnSeconds } from '../shared/protocol';
import { newRoom, RoomCore } from '../shared/room';
import type { Mode } from '../shared/rules';
import type { OfflineSettings, Profile } from './store';

/** Partida contra o bot, tudo no aparelho: usa a mesma lógica de sala do servidor. */
export class LocalBackend implements Backend {
  readonly mode = 'offline' as const;
  events: BackendEvents = noopEvents;
  private core: RoomCore;
  private timer = 0;
  private tick = 0;
  private dead = false;

  constructor(private profile: Profile, cfg: OfflineSettings) {
    this.core = new RoomCore(newRoom('LOCAL', { mode: cfg.mode, turnSeconds: cfg.turnSeconds }));
    this.core.join(profile.id, profile.name);
    this.core.setBot(profile.id, true, cfg.level);
    this.core.start(profile.id, Date.now());
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
  settings(opts: { mode?: Mode; turnSeconds?: TurnSeconds; bestOf?: BestOf }): void {
    if (this.core.setSettings(this.profile.id, opts)) this.emit();
  }
  shot(msg: ShotMsg): void {
    const r = this.core.shot(this.profile.id, msg, Date.now());
    if ('error' in r) return void this.events.onError(r.error);
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
