import { describe, expect, it } from 'vitest';
import { applyPenalty, revivable, newMatch, resolveShot, legalFirstHit, targets, remaining, lowestOnTable, groupOf, rackPositions } from './rules';
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

  it('falta devolve à mesa uma bola já feita pelo infrator', () => {
    const s = newMatch('par_impar');
    const sim = simFrom(s);
    sim.firstHit = 2;
    sim.railAfterHit = true;
    sim.balls[2]!.on = false;
    sim.pocketed.push({ id: 2, p: 0 });
    const s1 = resolveShot(s, sim).state;
    expect(s1.tray).toContain(2);
    const sim2 = simFrom(s1);
    sim2.firstHit = 3; // bola do adversário primeiro
    sim2.railAfterHit = true;
    const r = resolveShot(s1, sim2);
    expect(r.out.foul).not.toBeNull();
    expect(r.out.respotted).toContain(2);
    expect(r.state.tray).not.toContain(2);
    expect(r.state.balls.find((b) => b.id === 2)!.on).toBe(true);
    expect(r.state.turn).toBe(1);
    expect(r.state.inHand).toBe('any');
  });

  it('errar a 8 (só ela restando) é falta sem devolver bola', () => {
    const s = newMatch('par_impar');
    s.groups = ['even', 'odd'] as never;
    s.tray = [2, 4, 6, 10, 12, 14];
    for (const b of s.balls) if (s.tray.includes(b.id)) b.on = false;
    const sim = simFrom(s);
    sim.firstHit = 3; // tocou numa bola do adversário em vez da 8
    sim.railAfterHit = true;
    const r = resolveShot(s, sim);
    expect(r.out.foul).not.toBeNull();
    expect(r.out.respotted).toEqual([]);
    expect(r.state.tray.length).toBe(6);
    expect(r.state.turn).toBe(1);
    expect(r.state.inHand).toBe('any');
  });

  it('tocar na bola certa sem derrubar nada nem bater na tabela não é falta', () => {
    const s = newMatch('par_impar');
    s.breakShot = false;
    const sim = simFrom(s);
    sim.firstHit = 3;
    sim.railAfterHit = false;
    const r = resolveShot(s, sim);
    expect(r.out.foul).toBeNull();
    expect(r.state.turn).toBe(1);
    expect(r.state.inHand).toBe('none');
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

describe('guerra', () => {
  const start = () => {
    const s = newMatch('guerra', 0);
    s.balls = JSON.parse(JSON.stringify(s.balls));
    return s;
  };
  it('7 azuis e 7 vermelhas coladas nas tabelas longas, branca na casa, a 15 fora', () => {
    const s = start();
    const on = s.balls.filter((b) => b.on && b.id > 0);
    expect(on.length).toBe(14);
    expect(s.balls.find((b) => b.id === 15)!.on).toBe(false);
    expect(s.groups).toEqual(['blue', 'red']);
    for (const b of on) expect(Math.abs(b.y) > 0.58 || Math.abs(b.x) > 1.2).toBe(true);
    expect(on.filter((b) => Math.abs(b.x) > 1.2).length).toBe(6);
    expect(on.filter((b) => groupOf('guerra', b.id) === 'blue').every((b) => b.x < 0)).toBe(true);
    expect(on.filter((b) => groupOf('guerra', b.id) === 'red').every((b) => b.x > 0)).toBe(true);
    // só bolas do adversário são alvo legal
    expect(targets(s).every((id) => groupOf('guerra', id) === 'red')).toBe(true);
    expect(legalFirstHit(s, 3)).toBe(false);
    expect(legalFirstHit(s, 10)).toBe(true);
    expect(remaining(s, 0)).toBe(7);
  });

  it('derrubar bola do adversário limpa continua a vez; bola sua (fogo amigo) passa a vez', () => {
    let s = start();
    let sim = simFrom(s);
    sim.firstHit = 10;
    sim.balls[10]!.on = false;
    sim.pocketed.push({ id: 10, p: 0 });
    let r = resolveShot(s, sim);
    expect(r.out.foul).toBeNull();
    expect(r.out.again).toBe(true);
    expect(r.state.turn).toBe(0);
    expect(r.state.score[0]).toBe(1);
    s = start();
    sim = simFrom(s);
    sim.firstHit = 10;
    sim.balls[2]!.on = false;
    sim.pocketed.push({ id: 2, p: 0 });
    r = resolveShot(s, sim);
    expect(r.out.again).toBe(false);
    expect(r.state.turn).toBe(1);
    expect(r.state.tray).toContain(2);
    expect(r.state.balls.find((b) => b.id === 2)!.on).toBe(false);
    expect(r.state.score[1]).toBe(1);
  });

  it('tocar primeiro na bola sua é falta (bola na mão); branca na caçapa também', () => {
    const s = start();
    let sim = simFrom(s);
    sim.firstHit = 3;
    let r = resolveShot(s, sim);
    expect(r.out.foul).toMatch(/sua/);
    expect(r.state.turn).toBe(1);
    expect(r.state.inHand).toBe('any');
    sim = simFrom(s);
    sim.firstHit = 10;
    sim.balls[0]!.on = false;
    sim.pocketed.push({ id: 0, p: 2 });
    r = resolveShot(s, sim);
    expect(r.out.foul).toMatch(/branca/i);
    expect(r.state.inHand).toBe('any');
    expect(r.state.balls.find((b) => b.id === 0)!.on).toBe(true);
  });

  it('vence quem limpar o lado do adversário; quem ficar sem bolas perde (até por fogo amigo)', () => {
    let s = start();
    for (const b of s.balls) if (b.id >= 8 && b.id <= 14 && b.id !== 14) b.on = false; // adversário só com a 14
    let sim = simFrom(s);
    sim.firstHit = 14;
    sim.balls[14]!.on = false;
    sim.pocketed.push({ id: 14, p: 1 });
    let r = resolveShot(s, sim);
    expect(r.out.over).toBe(true);
    expect(r.out.winner).toBe(0);
    s = start();
    for (const b of s.balls) if (b.id >= 1 && b.id <= 7 && b.id !== 7) b.on = false; // eu só com a 7
    sim = simFrom(s);
    sim.firstHit = 10;
    sim.balls[7]!.on = false; // derrubei a minha última
    sim.pocketed.push({ id: 7, p: 1 });
    r = resolveShot(s, sim);
    expect(r.out.over).toBe(true);
    expect(r.out.winner).toBe(1);
  });

  it('falta: quem recebe escolhe entre bola na mão e ressuscitar uma bola sua (se tiver)', () => {
    // sem bola para ressuscitar: bola na mão direto
    let s = start();
    let sim = simFrom(s);
    sim.firstHit = 3; // tocou na própria primeiro
    let r = resolveShot(s, sim);
    expect(r.state.inHand).toBe('any');
    // o adversário (assento 1) já perdeu a 10: a falta dá a escolha
    s = start();
    s.tray = [10];
    s.balls.find((b) => b.id === 10)!.on = false;
    sim = simFrom(s);
    sim.firstHit = 3;
    r = resolveShot(s, sim);
    expect(r.out.foul).not.toBeNull();
    expect(r.state.turn).toBe(1);
    expect(r.state.inHand).toBe('choice');
    expect(revivable(r.state, 1)).toEqual([10]);
    // escolhe ressuscitar: a 10 volta para a tabela do lado dele e a vez segue com ele
    const st = JSON.parse(JSON.stringify(r.state));
    const a = applyPenalty(st, 'revive');
    expect(a.revived).toBe(10);
    expect(st.inHand).toBe('none');
    const b10 = st.balls.find((b: { id: number }) => b.id === 10);
    expect(b10.on).toBe(true);
    expect(b10.x).toBeGreaterThan(0);
    expect(st.tray).not.toContain(10);
    // escolhe bola na mão
    const st2 = JSON.parse(JSON.stringify(r.state));
    expect(applyPenalty(st2, 'hand').revived).toBeNull();
    expect(st2.inHand).toBe('any');
    expect(st2.balls.find((b: { id: number }) => b.id === 10).on).toBe(false);
  });
});
