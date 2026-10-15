import { describe, expect, it } from 'vitest';
import { botPlan } from './bot';
import { Sim, strike, MAX_SPEED, MAX_OFFSET } from './physics';
import { newMatch, resolveShot, type MatchState } from './rules';
import { BALL_D, HL, HW } from './table';

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('robustez da física', () => {
  it('tacadas aleatórias (inclusive extremas) nunca quebram a mesa', () => {
    const r = rng(2024);
    let s: MatchState = newMatch('par_impar');
    let worst = 0;
    let maxT = 0;
    for (let i = 0; i < 160; i++) {
      const st = JSON.parse(JSON.stringify(s)) as MatchState;
      const sim = Sim.from(st.balls);
      const ang = r() * Math.PI * 2;
      const extreme = i % 7 === 0;
      strike(sim.balls[0]!, { dx: Math.cos(ang), dy: Math.sin(ang), v: extreme ? MAX_SPEED : r() * 5 + 0.2, a: (r() * 2 - 1) * MAX_OFFSET, b: (r() * 2 - 1) * MAX_OFFSET });
      const t0 = performance.now();
      sim.run(60);
      worst = Math.max(worst, performance.now() - t0);
      maxT = Math.max(maxT, sim.t);
      expect(sim.moving()).toBe(false);
      for (const b of sim.balls) {
        expect(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.wz)).toBe(true);
        if (b.on) {
          expect(Math.abs(b.x)).toBeLessThanOrEqual(HL);
          expect(Math.abs(b.y)).toBeLessThanOrEqual(HW);
        }
      }
      // sobreposição final pequena
      const on = sim.balls.filter((b) => b.on);
      for (let a = 0; a < on.length; a++) for (let c = a + 1; c < on.length; c++) {
        const d = Math.hypot(on[a]!.x - on[c]!.x, on[a]!.y - on[c]!.y);
        expect(d).toBeGreaterThan(BALL_D * 0.9);
      }
      const { state } = resolveShot(st, sim);
      s = state;
      if (s.over) s = newMatch(i % 2 ? 'bola61' : 'lisas_listradas');
      else if (s.balls.filter((b) => b.on).length < 4) s = newMatch('par_impar');
    }
    console.log('pior caso de CPU numa tacada:', worst.toFixed(1), 'ms; maior duração simulada:', maxT.toFixed(1), 's');
  });

  it('bot em posições variadas nunca devolve tacada inválida e a física responde', () => {
    const r = rng(77);
    let s = newMatch('lisas_listradas');
    for (let i = 0; i < 40; i++) {
      const plan = botPlan(s, (['facil', 'normal', 'dificil', 'mestre'] as const)[i % 4]!, r);
      expect(Number.isFinite(plan.shot.dx) && Number.isFinite(plan.shot.v)).toBe(true);
      expect(plan.shot.v).toBeLessThanOrEqual(MAX_SPEED + 1e-9);
      const st = JSON.parse(JSON.stringify(s)) as MatchState;
      if (plan.cue) {
        const c = st.balls.find((b) => b.id === 0)!;
        c.x = plan.cue.x;
        c.y = plan.cue.y;
        c.on = true;
      }
      const sim = Sim.from(st.balls);
      strike(sim.balls[0]!, plan.shot);
      sim.run(60);
      s = resolveShot(st, sim).state;
      if (s.over) s = newMatch('par_impar');
    }
  });
});
