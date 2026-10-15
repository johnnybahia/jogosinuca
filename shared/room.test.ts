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
