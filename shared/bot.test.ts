import { describe, expect, it } from 'vitest';
import { botPlan, BOT_LEVELS, type BotLevel } from './bot';
import { Sim, strike } from './physics';
import { newMatch, resolveShot, type Mode, type MatchState } from './rules';

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function play(mode: Mode, lv: [BotLevel, BotLevel], seed: number, maxShots = 140): { s: MatchState; shots: number; ms: number; pots: number[] } {
  let s = newMatch(mode, 0);
  const r = mulberry(seed);
  const pots = [0, 0];
  let shots = 0;
  const t0 = performance.now();
  while (!s.over && shots < maxShots) {
    const plan = botPlan(s, lv[s.turn]!, r);
    const st = JSON.parse(JSON.stringify(s)) as MatchState;
    if (plan.cue) {
      const c = st.balls.find((b) => b.id === 0)!;
      c.x = plan.cue.x;
      c.y = plan.cue.y;
      c.on = true;
    }
    const sim = Sim.from(st.balls);
    strike(sim.balls[0]!, plan.shot);
    sim.run(40);
    const turn = s.turn;
    const { state, out } = resolveShot(st, sim);
    pots[turn]! += out.potted.length;
    s = state;
    shots++;
  }
  return { s, shots, ms: performance.now() - t0, pots };
}

describe('bot', () => {
  it('partida inteira termina e tem jogadas válidas', () => {
    for (const mode of ['par_impar', 'bola61', 'guerra'] as Mode[]) {
      const r = play(mode, ['normal', 'normal'], 7);
      console.log(mode, 'tacadas', r.shots, 'cpu', r.ms.toFixed(0), 'ms', 'caçapadas', r.pots.join('/'), 'fim', r.s.over, 'vencedor', r.s.winner, 'placar', r.s.score.join('-'));
      expect(r.shots).toBeGreaterThan(5);
    }
  });

  it('níveis: mestre derruba mais bolas que fácil', () => {
    const tot: Record<string, number> = {};
    for (const lv of BOT_LEVELS) {
      let pots = 0;
      let shots = 0;
      let ms = 0;
      for (let seed = 1; seed <= 5; seed++) {
        const r = play('bola61', [lv, lv], seed * 11, 60);
        pots += r.pots[0]! + r.pots[1]!;
        shots += r.shots;
        ms += r.ms;
      }
      tot[lv] = pots / shots;
      console.log(lv, 'bolas/tacada', (pots / shots).toFixed(2), 'cpu/tacada', (ms / shots).toFixed(0), 'ms');
    }
    expect(tot['mestre']!).toBeGreaterThanOrEqual(tot['facil']!);
  }, 120000);
});
