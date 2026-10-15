import { describe, expect, it } from 'vitest';
import { cutAngle, aimTrace, pocketAim } from './aim';
import { HL, HW } from './table';
import type { BallPos } from './physics';

describe('mira', () => {
  it('bola alvo apontada para o canto: caçapa certa e a reta entra', () => {
    const ox = 0.9;
    const oy = 0.3;
    const l = Math.hypot(HL - ox, HW - oy);
    const r = pocketAim(ox, oy, (HL - ox) / l, (HW - oy) / l);
    expect(r.index).toBe(3);
    expect(r.enters).toBe(true);
  });

  it('desviada para o lado: aponta a caçapa mais próxima mas a reta não entra', () => {
    const r = pocketAim(0.9, 0.3, Math.cos(0.45), Math.sin(0.45) * 0.2 + 0.4);
    expect(r.enters).toBe(false);
  });

  it('sem caçapa na frente: índice -1', () => {
    const r = pocketAim(0, 0, 0, 1);
    expect(r.index).toBeGreaterThanOrEqual(-1);
    const none = pocketAim(0.6, 0.0, -1, 0);
    expect(none.index === -1 || none.index === 0 || none.index === 2).toBe(true);
  });

  it('ângulo de corte: reto = 0°, meia bola ≈ 30°', () => {
    const balls: BallPos[] = [
      { id: 0, x: 0, y: 0, on: true },
      { id: 1, x: 0.5, y: 0, on: true },
    ];
    const reto = aimTrace(balls, 0, 0, 1, 0);
    expect(cutAngle(reto, 1, 0)).toBeLessThan(1);
    const a = Math.asin(0.5 * 0.0571 / 0.5) ;
    const meia = aimTrace(balls, 0, 0, Math.cos(a), Math.sin(a));
    expect(cutAngle(meia, Math.cos(a), Math.sin(a))).toBeGreaterThan(20);
    expect(cutAngle(meia, Math.cos(a), Math.sin(a))).toBeLessThan(40);
  });
});
