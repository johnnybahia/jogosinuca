import { describe, expect, it } from 'vitest';
import { botPlan } from './bot';
import { newRoom, RoomCore } from './room';

describe('sala', () => {
  it('fluxo: entrar, bot, começar, jogar até acabar, próxima partida', () => {
    const core = new RoomCore(newRoom('ABCDE', { mode: 'bola61', turnSeconds: 30, bestOf: 3 }));
    expect(core.join('u1', 'Ana').ok).toBe(true);
    expect(core.setBot('u1', true, 'normal')).toBe(true);
    expect(core.start('u1', 1000)).toBe(true);
    expect(core.d.phase).toBe('playing');
    let now = 1000;
    let n = 0;
    while (core.d.phase === 'playing' && n < 400) {
      const m = core.d.match!;
      const p = core.turnPlayer!;
      const plan = p.bot ? core.planBot()! : { shot: { ...botPlan(m, 'normal').shot } };
      const r = core.shot(p.id, plan.shot, now);
      expect('error' in r).toBe(false);
      now += 8000;
      n++;
    }
    expect(core.d.phase).toBe('ended');
    expect(core.d.gamesDone).toBe(1);
    expect(core.d.result).toBeTruthy();
    if (!core.d.seriesOver) expect(core.next('u1', now)).toBe(true);
  });

  it('guerra: sala com bot joga até o fim e mostra bolas azuis e vermelhas', () => {
    const core = new RoomCore(newRoom('ABCDE', { mode: 'guerra', turnSeconds: 30, bestOf: 1 }));
    core.join('u1', 'Ana');
    core.setBot('u1', true, 'normal');
    expect(core.start('u1', 1000)).toBe(true);
    expect(core.d.match!.groups).toEqual(['blue', 'red']);
    let now = 1000;
    let n = 0;
    while (core.d.phase === 'playing' && n < 400) {
      const p = core.turnPlayer!;
      const plan = p.bot ? core.planBot()! : { shot: { ...botPlan(core.d.match!, 'normal').shot } };
      const r = core.shot(p.id, plan.shot, now);
      expect('error' in r).toBe(false);
      now += 8000;
      n++;
    }
    expect(core.d.phase).toBe('ended');
    expect(core.d.result).toBeTruthy();
    const m = core.d.match!;
    const bl = m.balls.filter((b) => b.on && b.id >= 1 && b.id <= 7).length;
    const rd = m.balls.filter((b) => b.on && b.id >= 8 && b.id <= 14).length;
    expect(bl === 0 || rd === 0).toBe(true);
  });

  it('só o jogador da vez joga; tempo esgotado dá falta; 3 seguidas = derrota', () => {
    const core = new RoomCore(newRoom('ABCDE', { turnSeconds: 30 }));
    core.join('a', 'A');
    core.join('b', 'B');
    expect(core.start('a', 0, () => 0.1)).toBe(true);
    const turnId = core.turnPlayer!.id;
    const other = turnId === 'a' ? 'b' : 'a';
    expect('error' in core.shot(other, { dx: 1, dy: 0, v: 2, a: 0, b: 0 }, 10)).toBe(true);
    let now = 40_000;
    expect(core.timeout(now)).toBeTruthy();
    expect(core.d.match!.turn).not.toBe(core.seatOf(turnId));
    expect(core.d.match!.inHand).toBe('any');
  });

  it('abandono encerra a partida', () => {
    const core = new RoomCore(newRoom('ABCDE'));
    core.join('a', 'A');
    core.join('b', 'B');
    core.start('a', 0);
    core.leave('b', 5);
    expect(core.d.phase).toBe('ended');
    expect(core.d.result!.forfeit).toBe(true);
    expect(core.player(core.d.result!.winner)!.id).toBe('a');
  });
});

describe('mira completa', () => {
  it('vale para a sala se um dos humanos ligar; bloqueada com bot Difícil/Mestre', () => {
    const core = new RoomCore(newRoom('ABCDE', {}));
    core.join('u1', 'Ana');
    core.join('u2', 'Beto');
    expect(core.view('u1', 0, () => true).assist).toBe(false);
    expect(core.view('u2', 0, () => true, {}, (x) => x, { u1: true }).assist).toBe(true);
    expect(core.assistBlocked()).toBe(false);
    const solo = new RoomCore(newRoom('ABCDF', {}));
    solo.join('u1', 'Ana');
    solo.setBot('u1', true, 'mestre');
    expect(solo.assistBlocked()).toBe(true);
    expect(solo.view('u1', 0, () => true, {}, (x) => x, { u1: true }).assist).toBe(false);
    const facil = new RoomCore(newRoom('ABCDG', {}));
    facil.join('u1', 'Ana');
    facil.setBot('u1', true, 'normal');
    expect(facil.view('u1', 0, () => true, {}, (x) => x, { u1: true }).assist).toBe(true);
  });
});
