export type Quality = 'high' | 'medium' | 'low';
export type QualitySetting = Quality | 'auto';

export interface QualityProfile {
  pixelRatio: number;
  msaa: number;
  shadowMap: number;
  /** quantas lâmpadas projetam sombra */
  shadowLights: number;
  bloom: boolean;
  reflections: boolean;
  /** resolução das texturas de piso/parede */
  anisotropy: number;
  lightCones: boolean;
}

export function qualityProfile(q: Quality): QualityProfile {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  if (q === 'high') return { pixelRatio: Math.min(dpr, 2), msaa: 4, shadowMap: 2048, shadowLights: 3, bloom: true, reflections: true, anisotropy: 8, lightCones: true };
  if (q === 'medium') return { pixelRatio: Math.min(dpr, 1.5), msaa: 2, shadowMap: 1024, shadowLights: 1, bloom: true, reflections: true, anisotropy: 4, lightCones: true };
  return { pixelRatio: 1, msaa: 0, shadowMap: 1024, shadowLights: 0, bloom: false, reflections: false, anisotropy: 1, lightCones: false };
}

export function detectQuality(): Quality {
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  if ((coarse || small) && (mem <= 3 || cores <= 4)) return 'low';
  return coarse || small ? 'medium' : 'high';
}

export const resolveQuality = (s: QualitySetting): Quality => (s === 'auto' ? detectQuality() : s);
