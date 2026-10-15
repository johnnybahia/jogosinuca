/** Geometria da mira: bola fantasma, desvio da branca e da bola alvo, primeira batida na tabela. Só geometria (sem giro). */
import type { BallPos } from './physics';
import { BALL_D, BALL_R, HL, HW } from './table';

export interface AimInfo {
  /** onde a branca estará no instante da batida */
  ghostX: number;
  ghostY: number;
  /** distância percorrida pela branca até a batida (ou até a tabela) */
  dist: number;
  /** bola atingida (-1 se vai direto na tabela) */
  hit: number;
  /** direção de saída da bola alvo e da branca depois da batida (unitárias) */
  objDx: number;
  objDy: number;
  cueDx: number;
  cueDy: number;
  /** quão fino é o corte, 0 (reto) a 1 (raspando) */
  cut: number;
  /** primeira tabela: onde bate e direção refletida (quando não acerta bola) */
  wallX: number;
  wallY: number;
  rdx: number;
  rdy: number;
}

export function aimTrace(balls: BallPos[], cx: number, cy: number, dx: number, dy: number): AimInfo {
  let best = Infinity;
  let hit = -1;
  for (const b of balls) {
    if (!b.on || b.id === 0) continue;
    const ox = b.x - cx;
    const oy = b.y - cy;
    const t0 = ox * dx + oy * dy;
    if (t0 <= 0) continue;
    const perp2 = ox * ox + oy * oy - t0 * t0;
    const r2 = BALL_D * BALL_D;
    if (perp2 >= r2) continue;
    const t = t0 - Math.sqrt(r2 - perp2);
    if (t > 0 && t < best) {
      best = t;
      hit = b.id;
    }
  }
  // parede (retângulo recuado de um raio)
  const mx = HL - BALL_R;
  const my = HW - BALL_R;
  let tw = Infinity;
  if (dx > 1e-9) tw = Math.min(tw, (mx - cx) / dx);
  else if (dx < -1e-9) tw = Math.min(tw, (-mx - cx) / dx);
  if (dy > 1e-9) tw = Math.min(tw, (my - cy) / dy);
  else if (dy < -1e-9) tw = Math.min(tw, (-my - cy) / dy);
  const out: AimInfo = { ghostX: cx, ghostY: cy, dist: 0, hit: -1, objDx: 0, objDy: 0, cueDx: 0, cueDy: 0, cut: 0, wallX: cx + dx * tw, wallY: cy + dy * tw, rdx: dx, rdy: dy, };
  if (hit >= 0 && best < tw) {
    const o = balls.find((b) => b.id === hit)!;
    const gx = cx + dx * best;
    const gy = cy + dy * best;
    let nx = o.x - gx;
    let ny = o.y - gy;
    const l = Math.sqrt(nx * nx + ny * ny) || 1;
    nx /= l;
    ny /= l;
    const dot = dx * nx + dy * ny;
    let tx = dx - dot * nx;
    let ty = dy - dot * ny;
    const tl = Math.sqrt(tx * tx + ty * ty);
    if (tl > 1e-6) {
      tx /= tl;
      ty /= tl;
    } else {
      tx = 0;
      ty = 0;
    }
    out.ghostX = gx;
    out.ghostY = gy;
    out.dist = best;
    out.hit = hit;
    out.objDx = nx;
    out.objDy = ny;
    out.cueDx = tx;
    out.cueDy = ty;
    out.cut = 1 - Math.max(0, dot);
    return out;
  }
  out.ghostX = out.wallX;
  out.ghostY = out.wallY;
  out.dist = tw;
  // reflexão simples
  let rdx = dx;
  let rdy = dy;
  if (Math.abs(Math.abs(out.wallX) - mx) < 1e-6) rdx = -dx;
  if (Math.abs(Math.abs(out.wallY) - my) < 1e-6) rdy = -dy;
  out.rdx = rdx;
  out.rdy = rdy;
  return out;
}
