/**
 * Lógica da sala/partida, igual para o jogo offline (no navegador) e para o servidor (Durable Object).
 * Não conhece rede nem relógio: quem usa passa `now` (ms) e envia o que ela devolve.
 */
import { botPlan, BOT_NAMES } from './bot';
import { Sim, strike, MAX_SPEED, type Ball, type BallPos } from './physics';
import {
  MAX_ROOM_PLAYERS,
  MAX_TIMEOUTS,
  NAME_MAX,
  SHOT_SAFETY_MS,
  BEST_OF_OPTIONS,
  TURN_SECONDS_OPTIONS,
  type BestOf,
  type BotLevel,
  type MatchResult,
  type RoomPlayer,
  type RoomView,
  type ShotEvent,
  type ShotMsg,
  type TurnSeconds,
} from './protocol';
import { cloneState, MODES, nearestFree, newMatch, resolveShot, type MatchState, type Mode, type ShotOutcome } from './rules';

export interface PlayerData {
  id: string;
  name: string;
  seat: number;
  bot: boolean;
  botLevel?: BotLevel;
  left: boolean;
  wins: number;
  title?: boolean;
}

export interface RoomData {
  code: string;
  hostId: string;
  mode: Mode;
  turnSeconds: TurnSeconds;
  bestOf: BestOf;
  isPublic: boolean;
  phase: 'lobby' | 'playing' | 'ended';
  players: PlayerData[];
  match: MatchState | null;
  shotSeq: number;
  turnEndsAt: number | null;
  gamesDone: number;
  result?: MatchResult;
  last?: ShotOutcome & { by: number };
  timeouts: number[];
  /** quem quebra a próxima partida */
  breaker: number;
  /** a sessão (melhor de N) já foi decidida */
  seriesOver: boolean;
  practice?: boolean;
}

/** Identificador público do jogador numa sala: o servidor nunca mostra o id de verdade (quem soubesse dele poderia tomar o lugar). */
export function publicId(id: string, code: string): string {
  let h1 = 0xdeadbeef ^ code.length;
  let h2 = 0x41c6ce57 ^ id.length;
  const str = `${code}:${id}`;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `p${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

export const cleanName = (n: unknown): string => String(n ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, NAME_MAX) || 'Jogador';

export function newRoom(code: string, opts: { mode?: Mode; turnSeconds?: number; isPublic?: boolean; bestOf?: number } = {}): RoomData {
  const turnSeconds = (TURN_SECONDS_OPTIONS as readonly number[]).includes(opts.turnSeconds ?? 60) ? ((opts.turnSeconds ?? 60) as TurnSeconds) : 60;
  const bestOf = (BEST_OF_OPTIONS as readonly number[]).includes(opts.bestOf ?? 1) ? ((opts.bestOf ?? 1) as BestOf) : 1;
  const mode = MODES.some((m) => m.id === opts.mode) ? (opts.mode as Mode) : 'par_impar';
  return { code, hostId: '', mode, turnSeconds, bestOf, isPublic: !!opts.isPublic, phase: 'lobby', players: [], match: null, shotSeq: 0, turnEndsAt: null, gamesDone: 0, timeouts: [0, 0], breaker: 0, seriesOver: false };
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export interface ShotResult {
  ev: ShotEvent;
  /** duração da simulação (s) */
  simSeconds: number;
}

export class RoomCore {
  constructor(public d: RoomData) {}

  get host(): PlayerData | undefined {
    return this.d.players.find((p) => p.id === this.d.hostId);
  }
  seatOf(id: string): number {
    return this.d.players.find((p) => p.id === id)?.seat ?? -1;
  }
  player(seat: number): PlayerData | undefined {
    return this.d.players.find((p) => p.seat === seat);
  }
  get turnPlayer(): PlayerData | undefined {
    return this.d.match ? this.player(this.d.match.turn) : undefined;
  }

  view(forId: string, now: number, connected: (id: string) => boolean, media: Record<string, { cam: boolean; mic: boolean }> = {}, pub: (id: string) => string = (x) => x): RoomView {
    const d = this.d;
    const players: RoomPlayer[] = d.players.map((p) => ({ id: pub(p.id), name: p.name, seat: p.seat, connected: p.bot || connected(p.id), isHost: p.id === d.hostId, bot: p.bot, botLevel: p.botLevel, left: p.left, wins: p.wins, title: p.title, cam: !!media[p.id]?.cam, mic: !!media[p.id]?.mic }));
    return { t: 'state', code: d.code, phase: d.phase, hostId: pub(d.hostId), mode: d.mode, turnSeconds: d.turnSeconds, bestOf: d.bestOf, isPublic: d.isPublic, you: pub(forId), players, match: d.match, shotSeq: d.shotSeq, turnEndsAt: d.turnEndsAt, serverNow: now, gamesDone: d.gamesDone, practice: d.practice, result: d.result, last: d.last };
  }

  // ---------- saguão
  join(id: string, name: string): { ok: boolean; error?: string; fresh?: boolean } {
    const d = this.d;
    const existing = d.players.find((p) => p.id === id);
    if (existing) {
      existing.name = cleanName(name);
      existing.left = false;
      return { ok: true };
    }
    if (d.phase !== 'lobby') return { ok: false, error: 'A partida já começou.' };
    const humans = d.players.filter((p) => !p.bot);
    if (d.players.length >= MAX_ROOM_PLAYERS) {
      // sala com bot: o humano que entra toma o lugar dele
      const bot = d.players.find((p) => p.bot);
      if (!bot || humans.length >= 1) return { ok: false, error: 'Sala cheia.' };
      d.players = d.players.filter((p) => !p.bot);
    }
    const seat = [0, 1].find((s) => !d.players.some((p) => p.seat === s)) ?? 0;
    d.players.push({ id, name: cleanName(name), seat, bot: false, left: false, wins: 0 });
    if (!d.hostId || !d.players.some((p) => p.id === d.hostId && !p.bot)) d.hostId = id;
    return { ok: true, fresh: true };
  }

  leave(id: string, now: number): void {
    const d = this.d;
    const p = d.players.find((x) => x.id === id);
    if (!p) return;
    if (d.phase === 'lobby') {
      d.players = d.players.filter((x) => x.id !== id);
      if (d.hostId === id) {
        const h = d.players.find((x) => !x.bot);
        d.hostId = h?.id ?? '';
        if (!h) d.players = [];
      }
      return;
    }
    p.left = true;
    if (d.phase === 'playing') this.forfeit(p.seat, 'abandono', now);
  }

  setSettings(by: string, s: { mode?: Mode; turnSeconds?: number; bestOf?: number }): boolean {
    const d = this.d;
    if (by !== d.hostId || (d.phase !== 'lobby' && d.phase !== 'ended')) return false;
    if (s.mode && MODES.some((m) => m.id === s.mode)) d.mode = s.mode;
    if (finite(s.turnSeconds) && (TURN_SECONDS_OPTIONS as readonly number[]).includes(s.turnSeconds)) d.turnSeconds = s.turnSeconds as TurnSeconds;
    if (finite(s.bestOf) && (BEST_OF_OPTIONS as readonly number[]).includes(s.bestOf) && d.phase === 'lobby') d.bestOf = s.bestOf as BestOf;
    return true;
  }

  setBot(by: string, on: boolean, level: BotLevel): boolean {
    const d = this.d;
    if (by !== d.hostId || d.phase !== 'lobby') return false;
    const bot = d.players.find((p) => p.bot);
    if (!on) {
      d.players = d.players.filter((p) => !p.bot);
      return true;
    }
    if (bot) {
      bot.botLevel = level;
      bot.name = BOT_NAMES[level];
      return true;
    }
    if (d.players.length >= MAX_ROOM_PLAYERS) return false;
    const seat = [0, 1].find((s) => !d.players.some((p) => p.seat === s)) ?? 1;
    d.players.push({ id: `bot-${level}`, name: BOT_NAMES[level], seat, bot: true, botLevel: level, left: false, wins: 0 });
    return true;
  }

  kick(by: string, id: string): boolean {
    const d = this.d;
    if (by !== d.hostId || id === by || d.phase !== 'lobby') return false;
    d.players = d.players.filter((p) => p.id !== id);
    return true;
  }

  // ---------- partida
  canStart(connected: (id: string) => boolean): string | null {
    const d = this.d;
    if (d.players.length < 2) return 'São necessários 2 jogadores (ou um bot).';
    for (const p of d.players) if (!p.bot && !connected(p.id)) return `${p.name} está desconectado.`;
    return null;
  }

  start(by: string, now: number, rand: () => number = Math.random): boolean {
    const d = this.d;
    if (by !== d.hostId || (d.phase !== 'lobby' && !(d.phase === 'ended' && d.seriesOver))) return false;
    if (d.players.length < 2) return false;
    for (const p of d.players) p.wins = 0;
    d.gamesDone = 0;
    d.seriesOver = false;
    d.breaker = rand() < 0.5 ? 0 : 1;
    this.beginGame(now);
    return true;
  }

  /** Próxima partida da sessão (melhor de N). */
  next(by: string, now: number): boolean {
    const d = this.d;
    if (by !== d.hostId || d.phase !== 'ended' || d.seriesOver) return false;
    this.beginGame(now);
    return true;
  }

  private beginGame(now: number): void {
    const d = this.d;
    d.phase = 'playing';
    d.match = newMatch(d.mode, d.breaker);
    d.result = undefined;
    d.last = undefined;
    d.shotSeq = 0;
    d.timeouts = [0, 0];
    this.armTimer(now, 0);
  }

  private armTimer(now: number, extraMs: number): void {
    const d = this.d;
    const p = this.turnPlayer;
    d.turnEndsAt = d.phase !== 'playing' || !p ? null : p.bot ? now + extraMs + 90_000 : d.turnSeconds > 0 ? now + extraMs + d.turnSeconds * 1000 : null;
  }

  private finish(winnerSeat: number, reason: string, forfeit: boolean): void {
    const d = this.d;
    d.phase = 'ended';
    d.gamesDone++;
    const w = this.player(winnerSeat);
    if (w) w.wins++;
    d.result = { winner: winnerSeat, reason, forfeit };
    d.turnEndsAt = null;
    const need = Math.floor(d.bestOf / 2) + 1;
    d.seriesOver = d.bestOf === 1 || d.players.some((p) => p.wins >= need) || forfeit;
    // quem perdeu quebra a próxima
    d.breaker = 1 - winnerSeat;
  }

  forfeit(seat: number, reason: string, _now: number): void {
    const d = this.d;
    if (d.phase !== 'playing') return;
    if (d.match) d.match.over = true;
    this.finish(1 - seat, reason, true);
  }

  /** Valida e resolve uma tacada. */
  shot(by: string, msg: ShotMsg, now: number): ShotResult | { error: string } {
    const d = this.d;
    if (d.phase !== 'playing' || !d.match) return { error: 'Sem partida em andamento.' };
    const seat = this.seatOf(by);
    if (seat < 0 || seat !== d.match.turn) return { error: 'Não é a sua vez.' };
    if (![msg.dx, msg.dy, msg.v, msg.a, msg.b].every(finite)) return { error: 'Tacada inválida.' };
    const len = Math.sqrt(msg.dx * msg.dx + msg.dy * msg.dy);
    if (len < 0.5 || len > 1.5) return { error: 'Tacada inválida.' };
    const start = cloneState(d.match);
    if (start.inHand !== 'none' && msg.cue && finite(msg.cue.x) && finite(msg.cue.y)) {
      const p = nearestFree(start, msg.cue.x, msg.cue.y);
      const c = start.balls.find((b) => b.id === 0)!;
      c.x = p.x;
      c.y = p.y;
      c.on = true;
    }
    const shot = { dx: msg.dx / len, dy: msg.dy / len, v: Math.min(MAX_SPEED, Math.max(0.05, msg.v)), a: Math.max(-1, Math.min(1, msg.a)), b: Math.max(-1, Math.min(1, msg.b)) };
    const sim = Sim.from(start.balls);
    strike(sim.balls[0] as Ball, shot);
    sim.run(45);
    const startPos: BallPos[] = start.balls.map((b) => ({ ...b }));
    const { state, out } = resolveShot(start, sim);
    d.match = state;
    d.shotSeq++;
    d.timeouts[seat] = 0;
    d.last = { ...out, by: seat };
    const ev: ShotEvent = { t: 'shot', seq: d.shotSeq, by: seat, start: startPos, shot, out };
    if (out.over) {
      this.finish(state.winner, out.reason ?? 'fim de jogo', false);
    } else {
      this.armTimer(now, Math.round(sim.t * 1000) + SHOT_SAFETY_MS);
    }
    return { ev, simSeconds: sim.t };
  }

  /** Tempo esgotado: falta (bola na mão para o adversário). 3 seguidas = derrota. */
  timeout(now: number): { notice: string } | null {
    const d = this.d;
    if (d.phase !== 'playing' || !d.match || d.turnEndsAt === null || now < d.turnEndsAt) return null;
    const seat = d.match.turn;
    const p = this.player(seat);
    if (!p || p.bot) return null;
    d.timeouts[seat] = (d.timeouts[seat] ?? 0) + 1;
    if ((d.timeouts[seat] ?? 0) >= MAX_TIMEOUTS) {
      this.forfeit(seat, 'tempo esgotado 3 vezes', now);
      return { notice: `${p.name} perdeu por tempo.` };
    }
    const m = d.match;
    m.turn = 1 - seat;
    m.inHand = 'any';
    d.shotSeq++;
    d.last = { foul: 'Tempo esgotado', message: 'Tempo esgotado', again: false, potted: [], respotted: [], over: false, winner: -1, by: seat };
    this.armTimer(now, 0);
    return { notice: `${p.name} demorou: falta.` };
  }

  /** Vez de um bot? */
  botTurn(): PlayerData | null {
    const d = this.d;
    if (d.phase !== 'playing' || !d.match) return null;
    const p = this.turnPlayer;
    return p && p.bot ? p : null;
  }

  planBot(rand?: () => number): { shot: ShotMsg } | null {
    const p = this.botTurn();
    if (!p || !this.d.match) return null;
    const plan = botPlan(this.d.match, p.botLevel ?? 'normal', rand);
    return { shot: { ...plan.shot, cue: plan.cue } };
  }
}
