import type { AimMsg, BestOf, BotLevel, RoomView, ShotEvent, ShotMsg, TurnSeconds } from '../shared/protocol';
import type { Mode } from '../shared/rules';

export interface BackendEvents {
  onView(v: RoomView): void;
  onShot(e: ShotEvent): void;
  onAim(from: string, a: AimMsg): void;
  onPhoto(id: string, data: string): void;
  onRtc(from: string, data: unknown): void;
  onEmote(from: string, n: number): void;
  onNotice(text: string): void;
  onError(msg: string): void;
  onKicked(): void;
  onConn(state: 'connecting' | 'open' | 'closed'): void;
}

/** Mesma interface para jogo online (servidor) e offline (bot local). */
export interface Backend {
  readonly mode: 'online' | 'offline';
  events: BackendEvents;
  connect(): void;
  start(): void;
  settings(opts: { mode?: Mode; turnSeconds?: TurnSeconds; bestOf?: BestOf; hostColor?: 'blue' | 'red' }): void;
  shot(msg: ShotMsg): void;
  aim(a: AimMsg): void;
  next(): void;
  bot(on: boolean, level: BotLevel): void;
  kick(id: string): void;
  media(cam: boolean, mic: boolean): void;
  /** pede/retira a mira completa (online: vale para os dois jogadores) */
  assist(on: boolean): void;
  /** Guerra: escolha da penalidade depois de uma falta do adversário */
  penalty(choice: 'hand' | 'revive'): void;
  rtc(to: string, data: unknown): void;
  emote(n: number): void;
  leave(): void;
  /** só treino */
  rerack?(): void;
  readonly isPractice?: boolean;
}

export const noopEvents: BackendEvents = {
  onView() {},
  onShot() {},
  onAim() {},
  onPhoto() {},
  onRtc() {},
  onEmote() {},
  onNotice() {},
  onError() {},
  onKicked() {},
  onConn() {},
};
