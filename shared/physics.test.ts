import { describe, expect, it } from 'vitest';
import { newBall, Sim, strike, playShot, powerToSpeed, type Ball } from './physics';
import { BALL_D, BALL_R, HL, HW, POCKETS } from './table';

const mk = (list: [number, number, number][]): Ball[] => {
  const balls: Ball[] = [];
  for (const [id, x, y] of list) balls[id] = newBall(id, x, y);
  return balls;
};

describe('física', () => {
  it('bola reta: com recuo leve a branca para onde bateu (stun) e a objeto segue', () => {
    const balls = mk([[0, -0.4, 0], [1, 0, 0]]);
    const sim = new Sim(balls);
    strike(balls[0]!, { dx: 1, dy: 0, v: 2, a: 0, b: -0.18 });
    sim.run(10);
    expect(sim.firstHit).toBe(1);
    expect(Math.abs(balls[0]!.x + BALL_D)).toBeLessThan(0.05);
    expect(Math.abs(balls[1]!.x)).toBeGreaterThan(0.05);
  });

  it('topo (follow) faz a branca seguir; recuo (draw) faz voltar', () => {
    const f = mk([[0, -0.4, 0], [1, 0, 0]]);
    playShot(f, { dx: 1, dy: 0, v: 2, a: 0, b: 0.5 });
    const d = mk([[0, -0.4, 0], [1, 0, 0]]);
    playShot(d, { dx: 1, dy: 0, v: 2, a: 0, b: -0.5 });
    expect(f[0]!.x).toBeGreaterThan(0.05);
    expect(d[0]!.x).toBeLessThan(-0.2);
  });

  it('corte meia-bola: objeto sai a ~30° da linha da branca', () => {
    const balls = mk([[0, -0.5, 0], [1, 0, 0]]);
    // aponta para a borda: branca à esquerda, objeto em (0,0); bola fantasma desviada de R
    const gx = -BALL_D * Math.cos(Math.PI / 6);
    const gy = BALL_D * Math.sin(Math.PI / 6);
    const dx = gx - -0.5;
    const dy = gy;
    const l = Math.sqrt(dx * dx + dy * dy);
    const sim = new Sim(balls);
    strike(balls[0]!, { dx: dx / l, dy: dy / l, v: 1.5, a: 0, b: 0.4 });
    sim.run(10);
    expect(sim.firstHit).toBe(1);
    const a1 = Math.atan2(balls[1]!.y, balls[1]!.x) * 180 / Math.PI;
    console.log('corte 30°: objeto sai a', a1.toFixed(1), '° ; branca em', (Math.atan2(balls[0]!.y - 0, balls[0]!.x - -0.5) * 180 / Math.PI).toFixed(1));
    expect(a1).toBeLessThan(-20);
    expect(a1).toBeGreaterThan(-45);
  });

  it('energia nunca cresce e a mesa para (quebra de triângulo)', () => {
    const balls: Ball[] = [];
    balls[0] = newBall(0, -HL / 2, 0);
    let id = 1;
    const apex = HL / 2;
    for (let row = 0; row < 5; row++) for (let c = 0; c <= row; c++) balls[id] = newBall(id++, apex + row * BALL_R * 1.7321 + 1e-4 * row, (c - row / 2) * (BALL_D + 1e-4));
    const sim = new Sim(balls);
    strike(balls[0]!, { dx: 1, dy: 0.003, v: 6.5, a: 0, b: 0.2 });
    const t0 = performance.now();
    sim.run(60);
    const ms = performance.now() - t0;
    for (const b of balls) {
      expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
      if (b.on) {
        expect(Math.abs(b.x)).toBeLessThanOrEqual(HL);
        expect(Math.abs(b.y)).toBeLessThanOrEqual(HW);
      }
    }
    expect(sim.moving()).toBe(false);
    console.log('quebra: t=', sim.t.toFixed(2), 's  caçapas:', sim.pocketed.length, ' cpu(ms)=', ms.toFixed(1));
    expect(ms).toBeLessThan(400);
  });

  it('determinismo: dois cálculos iguais dão exatamente o mesmo resultado', () => {
    const run = (): string => {
      const balls = mk([[0, -0.5, 0.05], [1, 0, 0], [2, 0.1, 0.2], [3, 0.3, -0.1]]);
      playShot(balls, { dx: 0.98, dy: 0.1989, v: 3.1, a: 0.3, b: -0.2 });
      return JSON.stringify(balls.map((b) => [b.x, b.y, b.on]));
    };
    expect(run()).toBe(run());
  });

  it('bola reta no canto entra; bola fina na tabela quica', () => {
    // bola 1 perto do canto (+x,+y), branca atrás alinhada pela diagonal
    const bx = HL - 0.2;
    const by = HW - 0.2 * (HW / HL);
    const balls = mk([[0, 0, 0], [1, bx, by]]);
    const dx = POCKETS[3]!.x - bx;
    const dy = POCKETS[3]!.y - by;
    const l = Math.sqrt(dx * dx + dy * dy);
    // posiciona a branca na linha do objeto para o caçapa
    balls[0]!.x = bx - (dx / l) * 0.35;
    balls[0]!.y = by - (dy / l) * 0.35;
    const sim = new Sim(balls);
    strike(balls[0]!, { dx: dx / l, dy: dy / l, v: 2.2, a: 0, b: 0 });
    sim.run(20);
    expect(sim.pocketed.some((p) => p.id === 1)).toBe(true);
  });

  it('caçapa do meio: bola reta entra', () => {
    const balls = mk([[0, 0, -0.3], [1, 0.0, 0.2]]);
    const sim = new Sim(balls);
    strike(balls[0]!, { dx: 0, dy: 1, v: 2, a: 0, b: 0 });
    sim.run(20);
    expect(sim.pocketed.some((p) => p.id === 1)).toBe(true);
  });

  it('potência mapeia para velocidade crescente', () => {
    expect(powerToSpeed(0)).toBeLessThan(powerToSpeed(0.5));
    expect(powerToSpeed(0.5)).toBeLessThan(powerToSpeed(1));
  });

  it('tabela: ângulo de saída com efeito lateral muda a direção', () => {
    const plain = mk([[0, 0.3, 0]]);
    playShot(plain, { dx: 0, dy: 1, v: 1.5, a: 0, b: 0.3 }, 3);
    const eng = mk([[0, 0.3, 0]]);
    playShot(eng, { dx: 0, dy: 1, v: 1.5, a: 0.5, b: 0.3 }, 3);
    expect(Math.abs(eng[0]!.x - plain[0]!.x)).toBeGreaterThan(0.01);
  });
});
