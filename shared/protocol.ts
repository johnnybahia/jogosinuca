import type { BotLevel } from './bot';
import type { BallPos, ShotParams } from './physics';
import type { MatchState, Mode, ShotOutcome } from './rules';

export type { BotLevel };

export const MAX_ROOM_PLAYERS = 2;
/** tempo por tacada dos HUMANOS em segundos (0 = sem limite). */
export const TURN_SECONDS_OPTIONS = [30, 60, 0] as const;
export type TurnSeconds = (typeof TURN_SECONDS_OPTIONS)[number];
export const turnLabel = (s: number): string => (s === 0 ? 'Sem limite' : `${s}s`);
export const BEST_OF_OPTIONS = [1, 3, 5] as const;
export type BestOf = (typeof BEST_OF_OPTIONS)[number];
export const MAX_PHOTO_CHARS = 30000;
/** Reações rápidas (balões sobre o cartão do jogador). */
export const EMOTES = ['👍', '😮', '😂', '😡', '🙏', '⏳', 'GG'] as const;
export const NAME_MAX = 16;
/** Folga somada ao relógio de quem joga depois: a tacada precisa terminar de rolar na tela dos dois. */
export const SHOT_SAFETY_MS = 1500;
/** Estouros de tempo seguidos que tiram o jogador da partida. */
export const MAX_TIMEOUTS = 3;

export interface RoomPlayer {
  id: string;
  name: string;
  /** 0 ou 1: quem joga primeiro na quebra é sorteado */
  seat: number;
  connected: boolean;
  isHost: boolean;
  bot: boolean;
  botLevel?: BotLevel;
  left: boolean;
  /** vitórias na sessão (melhor de N) */
  wins: number;
  /** jogador com título (vitórias contra o Mestre contadas pelo servidor) */
  title?: boolean;
  /** câmera e microfone ligados (vídeo ao vivo entre os jogadores) */
  cam: boolean;
  mic: boolean;
  /** quer a mira completa (linha até a caçapa, trajetória da branca e ângulo de corte) */
  assist?: boolean;
}

export interface MatchResult {
  /** assento vencedor */
  winner: number;
  reason: string;
  forfeit?: boolean;
}

export interface RoomView {
  t: 'state';
  code: string;
  phase: 'lobby' | 'playing' | 'ended';
  hostId: string;
  mode: Mode;
  turnSeconds: TurnSeconds;
  bestOf: BestOf;
  isPublic: boolean;
  you: string;
  /** mira completa ligada para a sala: vale para os dois assim que um deles ativa (nunca contra bot Difícil/Mestre) */
  assist: boolean;
  players: RoomPlayer[];
  match: MatchState | null;
  /** número de tacadas já resolvidas (reconexão: quem já viu essa não repete a animação) */
  shotSeq: number;
  turnEndsAt: number | null;
  serverNow: number;
  /** partidas já terminadas na sessão */
  gamesDone: number;
  /** treino livre (só offline) */
  practice?: boolean;
  result?: MatchResult;
  /** última tacada (para o painel de "o que aconteceu") */
  last?: ShotOutcome & { by: number };
}

export interface ShotMsg extends ShotParams {
  /** posição da branca quando estava "na mão" */
  cue?: { x: number; y: number };
}

export interface AimMsg {
  angle: number;
  a: number;
  b: number;
  pull: number;
  /** posição da branca (bola na mão) */
  cx?: number;
  cy?: number;
}

export type ClientMsg =
  | { t: 'join'; id: string; name: string; photo?: string }
  | { t: 'start' }
  | { t: 'settings'; mode?: Mode; turnSeconds?: TurnSeconds; bestOf?: BestOf }
  | ({ t: 'shot' } & ShotMsg)
  | ({ t: 'aim' } & AimMsg)
  | { t: 'next' }
  | { t: 'kick'; id: string }
  | { t: 'bot'; on: boolean; level: BotLevel }
  | { t: 'media'; cam: boolean; mic: boolean }
  | { t: 'assist'; on: boolean }
  | { t: 'penalty'; choice: 'hand' | 'revive' }
  | { t: 'rtc'; to: string; data: unknown }
  | { t: 'emote'; n: number }
  | { t: 'leave' }
  | { t: 'ping' };

export interface ShotEvent {
  t: 'shot';
  seq: number;
  by: number;
  start: BallPos[];
  shot: ShotParams;
  out: ShotOutcome;
}

export type ServerMsg =
  | RoomView
  | ShotEvent
  | ({ t: 'aim'; from: string } & AimMsg)
  | { t: 'photo'; id: string; data: string }
  | { t: 'rtc'; from: string; data: unknown }
  | { t: 'emote'; from: string; n: number }
  | { t: 'notice'; text: string }
  | { t: 'error'; msg: string }
  | { t: 'kicked' }
  | { t: 'pong' };

export interface RankingRow {
  id: string;
  name: string;
  games: number;
  wins: number;
  /** pontos de ranking (vitória +3, derrota 0, abandono −1) com média móvel simples */
  points: number;
  streak: number;
}

export interface LobbyRoom {
  code: string;
  hostName: string;
  count: number;
  mode: Mode;
  turnSeconds: TurnSeconds;
}
