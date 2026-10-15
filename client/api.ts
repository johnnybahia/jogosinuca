import type { LobbyRoom, RankingRow, TurnSeconds } from '../shared/protocol';
import type { BestOf } from '../shared/protocol';
import type { Mode } from '../shared/rules';

/** Vazio = mesmo endereço do jogo (o Worker serve tudo). Em dev aponta para o `wrangler dev`. */
const API: string = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? '';

export const wsUrl = (code: string): string => {
  if (!API) return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${code}`;
  return `${API.replace(/^http/, 'ws')}/ws/${code}`;
};

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, init);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

export const createRoom = (o: { mode: Mode; turnSeconds: TurnSeconds; isPublic: boolean; bestOf: BestOf }): Promise<{ code: string }> =>
  j('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
export const listRooms = (): Promise<LobbyRoom[]> => j('/api/rooms');
export const getRanking = (): Promise<RankingRow[]> => j('/api/ranking');

/** Reserva o nome para este perfil. `false` = já pertence a outro jogador; sem conexão não bloqueia. */
export async function claimName(id: string, name: string): Promise<boolean> {
  try {
    const r = await fetch(`${API}/api/name/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name }) });
    return r.status !== 409;
  } catch {
    return true;
  }
}
