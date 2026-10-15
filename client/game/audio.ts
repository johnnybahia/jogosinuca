/** Sons sintetizados (Web Audio): nada para baixar. Só começa depois do primeiro toque/clique. */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let volume = 0.8;
let muted = false;
let lastHit = 0;

const LS = 'sinuca_audio_v1';
try {
  const s = JSON.parse(localStorage.getItem(LS) ?? 'null') as { v?: number; m?: boolean } | null;
  if (s) {
    volume = typeof s.v === 'number' ? Math.min(1, Math.max(0, s.v)) : 0.8;
    muted = !!s.m;
  }
} catch {
  /* sem armazenamento */
}

function save(): void {
  try {
    localStorage.setItem(LS, JSON.stringify({ v: volume, m: muted }));
  } catch {
    /* ok */
  }
}

export function unlockAudio(): void {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : volume;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 5;
      master.connect(comp).connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* sem áudio */
  }
}
if (typeof window !== 'undefined') {
  const un = (): void => unlockAudio();
  window.addEventListener('pointerdown', un, { once: false, passive: true });
  window.addEventListener('keydown', un, { passive: true });
}

export const getVolume = (): number => volume;
export const isMuted = (): boolean => muted;
export function setVolume(v: number): void {
  volume = Math.min(1, Math.max(0, v));
  if (master && !muted) master.gain.value = volume;
  save();
}
export function setMuted(m: boolean): void {
  muted = m;
  if (master) master.gain.value = m ? 0 : volume;
  save();
}

const now = (): number => ctx?.currentTime ?? 0;

function noise(dur: number, f: number, q: number, gain: number, type: BiquadFilterType, when = 0, fEnd = f): void {
  if (!ctx || !master || !noiseBuf) return;
  const t = now() + when;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const flt = ctx.createBiquadFilter();
  flt.type = type;
  flt.frequency.setValueAtTime(f, t);
  flt.frequency.exponentialRampToValueAtTime(Math.max(30, fEnd), t + dur);
  flt.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(flt).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

function tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', when = 0, fEnd = freq): void {
  if (!ctx || !master) return;
  const t = now() + when;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, fEnd), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Taco batendo na branca (power 0..1). */
export function sndCue(power: number): void {
  if (!ctx) return;
  const p = Math.min(1, Math.max(0.05, power));
  noise(0.05, 3200, 1.2, 0.5 * p + 0.15, 'bandpass');
  tone(210, 0.07, 0.35 * p + 0.1, 'sine', 0, 90);
  noise(0.025, 7000, 0.7, 0.25 * p, 'highpass');
}

/** Bola contra bola; v = velocidade de aproximação (m/s). */
export function sndBall(v: number): void {
  if (!ctx) return;
  const t = performance.now();
  if (t - lastHit < 14) return;
  lastHit = t;
  const a = Math.min(1, v / 3.2);
  if (a < 0.03) return;
  const j = 0.93 + Math.random() * 0.14;
  noise(0.035, 4200 * j, 1.5, 0.32 * a + 0.04, 'bandpass');
  tone(2350 * j, 0.09, 0.12 * a, 'sine', 0, 2100 * j);
  tone(3800 * j, 0.05, 0.06 * a, 'sine');
  noise(0.012, 9000, 0.5, 0.2 * a, 'highpass');
}

export function sndCushion(v: number): void {
  if (!ctx) return;
  const a = Math.min(1, v / 3);
  if (a < 0.04) return;
  noise(0.09, 520, 0.9, 0.5 * a + 0.05, 'lowpass', 0, 160);
  tone(150, 0.1, 0.22 * a, 'sine', 0, 70);
}

export function sndPocket(v: number): void {
  if (!ctx) return;
  const a = Math.min(1, v / 2.5 + 0.35);
  noise(0.08, 900, 0.8, 0.35 * a, 'lowpass', 0, 200);
  tone(95, 0.16, 0.3 * a, 'sine', 0.03, 55);
  // rolando pela calha
  noise(0.7, 700, 1.1, 0.12 * a, 'bandpass', 0.18, 260);
}

export function sndClick(): void {
  if (!ctx) return;
  tone(880, 0.05, 0.12, 'triangle', 0, 1200);
}

export function sndTurn(): void {
  if (!ctx) return;
  tone(660, 0.12, 0.14, 'sine');
  tone(990, 0.16, 0.12, 'sine', 0.09);
}

export function sndFoul(): void {
  if (!ctx) return;
  tone(220, 0.22, 0.22, 'sawtooth', 0, 150);
  tone(165, 0.3, 0.2, 'sawtooth', 0.12, 110);
}

export function sndWin(): void {
  if (!ctx) return;
  [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.5, 0.2, 'triangle', i * 0.13));
  tone(1568, 0.9, 0.12, 'sine', 0.55);
}

export function sndLose(): void {
  if (!ctx) return;
  [392, 330, 262].forEach((f, i) => tone(f, 0.45, 0.17, 'triangle', i * 0.18));
}
