import { describe, expect, it } from 'vitest';
import { newMatch, resolveShot, legalFirstHit, targets, remaining, lowestOnTable, groupOf, rackPositions } from './rules';
import { Sim, strike, type Ball, newBall } from './physics';
import { POCKETS } from './table';

const simFrom = (s: ReturnType<typeof newMatch>): Sim => Sim.from(s.balls);

describe('regras', () => {
  it('triângulo tem 16 bolas sem sobreposição', () => {
    const r = rackPositions();
    expect(r.length).toBe(16);
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
      const d = Math.hypot(r[i]!.x - r[j]!.x, r[i]!.y - r[j]!.y);
      expect(d).toBeGreaterThan(0.0571);
    }
  });

  it('mesa aberta: tocar na 8 primeiro é falta; qualquer outra vale', () => {
    const s = newMatch('par_impar');
    expect(legalFirstHit(s, 8)).toBe(false);
    expect(legalFirstHit(s, 3)).toBe(true);
    expect(targets(s)).not.toContain(8);
  });

  it('bola 61 exige a menor bola da mesa', () => {
    const s = newMatch('bola61');
    expect(lowestOnTable(s.balls)).toBe(1);
    expect(legalFirstHit(s, 1)).toBe(true);
    expect(legalFirstHit(s, 2)).toBe(false);
  });

  it('falta passa a vez com bola na mão e dá pontos na 61', () => {
    const s = newMatch('bola61');
    const sim = simFrom(s);
    sim.firstHit = 5; // tocou na bola errada
    const { state, out } = resolveShot(s, sim);
    expect(out.foul).toBeTruthy();
    expect(state.turn).toBe(1);
    expect(state.score[1]).toBe(4);
    expect(state.inHand).toBe('any');
  });

  it('derrubar bola legal na 61 soma pontos e mantém a vez', () => {
    const s = newMatch('bola61');
    s.balls = s.balls.map((b) => ({ ...b }));
    const sim = simFrom(s);
    sim.firstHit = 1;
    sim.railAfterHit = true;
    sim.balls[1]!.on = false;
    sim.pocketed.push({ id: 1, p: 2 });
    const { state, out } = resolveShot(s, sim);
    expect(out.foul).toBeNull();
    expect(state.score[0]).toBe(1);
    expect(state.turn).toBe(0);
    expect(out.again).toBe(true);
  });

  it('define grupos pela primeira bola derrubada e a 8 vence só no final', () => {
    const s = newMatch('par_impar');
    const sim = simFrom(s);
    sim.firstHit = 2;
    sim.railAfterHit = true;
    sim.balls[2]!.on = false;
    sim.pocketed.push({ id: 2, p: 0 });
    const r1 = resolveShot(s, sim);
    expect(r1.state.groups[0]).toBe('even');
    expect(r1.state.groups[1]).toBe('odd');
    expect(r1.state.turn).toBe(0);
    // 8 antes da hora: perde
    const s2 = r1.state;
    const sim2 = simFrom(s2);
    sim2.firstHit = 4;
    sim2.railAfterHit = true;
    sim2.balls[8]!.on = false;
    sim2.pocketed.push({ id: 8, p: 1 });
    const r2 = resolveShot(s2, sim2);
    expect(r2.out.over).toBe(true);
    expect(r2.out.winner).toBe(1);
    // grupo limpo: 8 legal vence
    const s3 = JSON.parse(JSON.stringify(s2));
    for (const b of s3.balls) if (b.id > 0 && b.id !== 8 && groupOf('par_impar', b.id) === 'even') b.on = false;
    expect(remaining(s3, 0)).toBe(0);
    const sim3 = simFrom(s3);
    sim3.firstHit = 8;
    sim3.railAfterHit = true;
    sim3.balls[8]!.on = false;
    sim3.pocketed.push({ id: 8, p: 3 });
    const r3 = resolveShot(s3, sim3);
    expect(r3.out.winner).toBe(0);
  });

  it('simulação real: quebra gera estado consistente', () => {
    const s = newMatch('lisas_listradas');
    const balls: Ball[] = [];
    for (const p of s.balls) balls[p.id] = Object.assign(newBall(p.id, p.x, p.y), { on: p.on });
    const sim = new Sim(balls);
    strike(balls[0]!, { dx: 1, dy: 0.01, v: 6, a: 0, b: 0.1 });
    sim.run(60);
    const { state } = resolveShot(s, sim);
    expect(state.balls.length).toBe(16);
    expect(POCKETS.length).toBe(6);
    expect(state.breakShot).toBe(false);
  });
});
