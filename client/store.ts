import type { BotLevel } from '../shared/bot';
import { BOT_LEVELS } from '../shared/bot';
import { MAX_PHOTO_CHARS, NAME_MAX, TURN_SECONDS_OPTIONS, type TurnSeconds } from '../shared/protocol';
import { MODES, type Mode } from '../shared/rules';
import type { QualitySetting } from './game/quality';

export interface Profile {
  id: string;
  name: string;
  photo: string | null;
}

const KEY = 'sinuca_profile_v1';

export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Profile;
    if (typeof p.id === 'string' && p.id.length >= 8 && typeof p.name === 'string') return { id: p.id, name: p.name.slice(0, NAME_MAX), photo: p.photo ?? null };
  } catch {
    /* navegador bloqueou o armazenamento */
  }
  return null;
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* vale só nesta sessão */
  }
}

export const newId = (): string => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

/** Recorta o centro, reduz para 128 px e comprime em JPEG até caber no limite do servidor. */
export async function photoFromFile(file: Blob, size = 128): Promise<string> {
  const bmp = await createImageBitmap(file);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d')!;
  const s = Math.min(bmp.width, bmp.height);
  c.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  bmp.close();
  for (const q of [0.78, 0.65, 0.5, 0.38]) {
    const url = cv.toDataURL('image/jpeg', q);
    if (url.length <= MAX_PHOTO_CHARS) return url;
  }
  return cv.toDataURL('image/jpeg', 0.3);
}

export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 55% 42%)`;
}

// ---------- partida offline ----------
const OFFLINE_KEY = 'sinuca_offline_v1';
export interface OfflineSettings {
  mode: Mode;
  level: BotLevel;
  turnSeconds: TurnSeconds;
}
export function loadOfflineSettings(): OfflineSettings {
  try {
    const s = JSON.parse(localStorage.getItem(OFFLINE_KEY) ?? '{}') as Partial<OfflineSettings>;
    return {
      mode: MODES.some((m) => m.id === s.mode) ? (s.mode as Mode) : 'par_impar',
      level: BOT_LEVELS.includes(s.level as BotLevel) ? (s.level as BotLevel) : 'normal',
      turnSeconds: (TURN_SECONDS_OPTIONS as readonly number[]).includes(s.turnSeconds as number) ? (s.turnSeconds as TurnSeconds) : 0,
    };
  } catch {
    return { mode: 'par_impar', level: 'normal', turnSeconds: 0 };
  }
}
export function saveOfflineSettings(s: OfflineSettings): void {
  try {
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(s));
  } catch {
    /* ok */
  }
}

// ---------- preferências do jogo ----------
const PREFS_KEY = 'sinuca_prefs_v1';
export interface Prefs {
  quality: QualitySetting;
  felt: string;
  /** madeira da mesa: aleatoria | classica | mogno */
  wood: string;
  /** mostra a linha de mira (bola fantasma e saída das bolas) */
  guide: boolean;
  /** sensibilidade do giro da mira: 0.5 .. 2 */
  sens: number;
  /** tamanho da interface: 0 normal, 1 grande, 2 extra grande */
  size: 0 | 1 | 2;
  /** reduz tremidas da câmera */
  calm: boolean;
}
const SIZE_PCT = [100, 115, 130] as const;
let prefs: Prefs | null = null;
export function loadPrefs(): Prefs {
  if (prefs) return prefs;
  prefs = { quality: 'auto', felt: 'verde', wood: 'aleatoria', guide: true, sens: 1, size: 0, calm: false };
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    if (p) {
      prefs = {
        quality: p.quality === 'high' || p.quality === 'medium' || p.quality === 'low' ? p.quality : 'auto',
        felt: typeof p.felt === 'string' ? p.felt : 'verde',
        wood: p.wood === 'classica' || p.wood === 'mogno' ? p.wood : 'aleatoria',
        guide: p.guide !== false,
        sens: typeof p.sens === 'number' ? Math.min(2, Math.max(0.3, p.sens)) : 1,
        size: p.size === 1 || p.size === 2 ? p.size : 0,
        calm: p.calm === true,
      };
    }
  } catch {
    /* padrão */
  }
  return prefs;
}
export function savePrefs(p: Prefs): void {
  prefs = p;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* vale só nesta sessão */
  }
  applyPrefsToPage();
}
export function applyPrefsToPage(): void {
  document.documentElement.style.fontSize = `${SIZE_PCT[loadPrefs().size]}%`;
}

// ---------- estatísticas locais ----------
const STATS_KEY = 'sinuca_stats_v1';
export interface Stats {
  games: number;
  wins: number;
  potted: number;
  bestStreak: number;
  vsBot: Record<string, { games: number; wins: number }>;
}
export function loadStats(): Stats {
  try {
    const s = JSON.parse(localStorage.getItem(STATS_KEY) ?? '{}') as Partial<Stats>;
    const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    return { games: n(s.games), wins: n(s.wins), potted: n(s.potted), bestStreak: n(s.bestStreak), vsBot: typeof s.vsBot === 'object' && s.vsBot ? s.vsBot : {} };
  } catch {
    return { games: 0, wins: 0, potted: 0, bestStreak: 0, vsBot: {} };
  }
}
export function saveStats(s: Stats): void {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(s));
  } catch {
    /* ok */
  }
}
