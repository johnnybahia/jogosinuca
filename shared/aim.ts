/** Geometria da mira: bola fantasma, desvio da branca e da bola alvo, primeira batida na tabela. Só geometria (sem giro). */
import { Sim, strike, type BallPos } from './physics';
import { BALL_D, BALL_R, HL, HW, POCKETS } from './table';

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

export interface PocketAim {
  /** índice em POCKETS (-1 = nenhuma caçapa razoável na direção da bola alvo) */
  index: number;
  /** ponto da boca da caçapa (plano da física) */
  x: number;
  y: number;
  /** a reta da bola alvo passa pela boca (com folga de bola) */
  enters: boolean;
}

/** Caçapa mais alinhada com a saída da bola alvo e se a reta entra na boca. */
export function pocketAim(ox: number, oy: number, dx: number, dy: number): PocketAim {
  let best: PocketAim = { index: -1, x: ox, y: oy, enters: false };
  let bestAng = 0.6;
  POCKETS.forEach((p, i) => {
    const mx = (p.ax + p.bx) / 2;
    const my = (p.ay + p.by) / 2;
    const vx = mx - ox;
    const vy = my - oy;
    const along = vx * dx + vy * dy;
    if (along <= 0.02) return;
    const perp = Math.abs(vx * dy - vy * dx);
    const ang = Math.atan2(perp, along);
    if (ang < bestAng) {
      bestAng = ang;
      const half = Math.hypot(p.bx - p.ax, p.by - p.ay) / 2;
      best = { index: i, x: mx, y: my, enters: perp < half - BALL_R * 0.6 };
    }
  });
  return best;
}

/** Ângulo de corte em graus (0 = bola reta). */
export const cutAngle = (info: AimInfo, dx: number, dy: number): number => (info.hit < 0 ? 0 : (Math.acos(Math.min(1, Math.max(-1, dx * info.objDx + dy * info.objDy))) * 180) / Math.PI);

/**
 * Caminho real da branca (com giro e potência) a partir do primeiro contato (bola ou tabela): é o que a tacada vai fazer,
 * inclusive seguir/puxar e efeito. Usa a mesma física do jogo; roda só até `maxLen` metros depois do contato.
 */
export function previewCuePath(pos: BallPos[], dx: number, dy: number, v: number, a: number, b: number, maxLen = 0.9): { x: number; y: number }[] {
  const sim = Sim.from(pos);
  const cue = sim.balls[0];
  if (!cue || !cue.on) return [];
  strike(cue, { dx, dy, v, a, b });
  const pts: { x: number; y: number }[] = [];
  let seen = 0;
  let started = false;
  let len = 0;
  for (let n = 0; n < 6000 && sim.t < 6; n++) {
    sim.step(sim.nextDt());
    if (!started) {
      for (; seen < sim.events.length; seen++) {
        const e = sim.events[seen]!;
        if ((e.k === 'ball' && (e.a === 0 || e.b === 0)) || (e.k === 'cushion' && e.a === 0)) started = true;
      }
      if (started) pts.push({ x: cue.x, y: cue.y });
    } else {
      const l = pts[pts.length - 1]!;
      const d = Math.hypot(cue.x - l.x, cue.y - l.y);
      if (d >= 0.03) {
        pts.push({ x: cue.x, y: cue.y });
        len += d;
      }
      if (len >= maxLen || !cue.on) break;
    }
    if (!sim.moving() || (!cue.on && !started)) break;
  }
  return pts;
}
