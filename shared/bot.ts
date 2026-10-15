/**
 * Jogador automático. Gera tacadas pelo método da bola fantasma (bola alvo → caçapa), escolhe as mais fáceis e, nos
 * níveis altos, testa as melhores na própria física do jogo para ver o que acontece (cai? falta? como a branca fica?).
 * O erro de pontaria e de força cresce nos níveis baixos.
 */
import { Sim, powerToSpeed, strike, MAX_SPEED, type BallPos, type ShotParams } from './physics';
import { BALL_D, BALL_R, HEAD_X, HL, HW, POCKETS } from './table';
import { type MatchState, nearestFree, resolveShot, targets as legalTargets } from './rules';

export type BotLevel = 'facil' | 'normal' | 'dificil' | 'mestre';
export const BOT_LEVELS: BotLevel[] = ['facil', 'normal', 'dificil', 'mestre'];
export const BOT_LABEL: Record<BotLevel, string> = { facil: 'Fácil', normal: 'Normal', dificil: 'Difícil', mestre: 'Mestre' };
export const BOT_NAMES: Record<BotLevel, string> = { facil: 'Zeca', normal: 'Marcão', dificil: 'Dona Neide', mestre: 'Mestre Baiano' };

interface LevelCfg {
  angleSigma: number;
  powerSigma: number;
  /** quantas candidatas são simuladas na física antes de decidir */
  sims: number;
  spins: number;
  /** chance de jogar sem pensar (tacada qualquer) */
  slip: number;
  /** pensa em onde a branca fica depois */
  position: boolean;
}
export const LEVEL_CFG: Record<BotLevel, LevelCfg> = {
  facil: { angleSigma: 0.03, powerSigma: 0.3, sims: 0, spins: 1, slip: 0.3, position: false },
  normal: { angleSigma: 0.011, powerSigma: 0.15, sims: 0, spins: 1, slip: 0.1, position: false },
  dificil: { angleSigma: 0.0042, powerSigma: 0.07, sims: 4, spins: 1, slip: 0, position: true },
  mestre: { angleSigma: 0.0009, powerSigma: 0.02, sims: 7, spins: 3, slip: 0, position: true },
};

type Rnd = () => number;
const gauss = (r: Rnd): number => Math.sqrt(-2 * Math.log(1 - r() * 0.999999)) * Math.cos(2 * Math.PI * r());

interface Cand {
  t: number;
  p: number;
  gx: number;
  gy: number;
  dx: number;
  dy: number;
  dCG: number;
  dTP: number;
  cos: number;
  score: number;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy;
  let t = l2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + vx * t;
  const qy = ay + vy * t;
  return Math.sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy));
}

const aimPoint = (i: number): { x: number; y: number } => {
  const p = POCKETS[i]!;
  const mx = (p.ax + p.bx) / 2;
  const my = (p.ay + p.by) / 2;
  return { x: mx + p.nx * 0.012, y: my + p.ny * 0.012 };
};

/** Tacadas "bola alvo na caçapa" a partir de uma posição da branca. */
export function candidates(balls: BallPos[], tgt: number[], cue: { x: number; y: number }): Cand[] {
  const out: Cand[] = [];
  const others = balls.filter((b) => b.on && b.id !== 0);
  for (const id of tgt) {
    const t = balls.find((b) => b.id === id && b.on);
    if (!t) continue;
    for (let pi = 0; pi < POCKETS.length; pi++) {
      const pk = POCKETS[pi]!;
      const ap = aimPoint(pi);
      let ux = ap.x - t.x;
      let uy = ap.y - t.y;
      const dTP = Math.sqrt(ux * ux + uy * uy);
      if (dTP < BALL_D) continue;
      ux /= dTP;
      uy /= dTP;
      // entrada na caçapa: ângulo com a normal da boca
      if (ux * pk.nx + uy * pk.ny < (pk.side ? 0.5 : 0.42)) continue;
      const gx = t.x - ux * BALL_D;
      const gy = t.y - uy * BALL_D;
      if (Math.abs(gx) > HL - BALL_R || Math.abs(gy) > HW - BALL_R) continue;
      let vx = gx - cue.x;
      let vy = gy - cue.y;
      const dCG = Math.sqrt(vx * vx + vy * vy);
      if (dCG < 0.02) continue;
      vx /= dCG;
      vy /= dCG;
      const cos = vx * ux + vy * uy;
      if (cos < 0.14) continue;
      let blocked = false;
      for (const o of others) {
        if (o.id !== id && segDist(o.x, o.y, cue.x, cue.y, gx, gy) < BALL_D * 1.03) {
          blocked = true;
          break;
        }
        if (o.id !== id && segDist(o.x, o.y, t.x, t.y, ap.x, ap.y) < BALL_D * 1.03) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      const diff = (dCG + dTP * 1.6) / (0.25 + cos * cos);
      out.push({ t: id, p: pi, gx, gy, dx: vx, dy: vy, dCG, dTP, cos, score: -diff });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/** Velocidade da branca para a bola alvo chegar à caçapa com folga. */
function speedFor(c: Cand): number {
  const vObj = Math.sqrt(2 * 0.2 * c.dTP) + 0.55;
  const atImpact = vObj / Math.max(0.3, c.cos);
  const v0 = Math.sqrt(atImpact * atImpact + 2 * 0.18 * c.dCG);
  return Math.min(MAX_SPEED * 0.85, Math.max(0.9, v0));
}

const toSim = (balls: BallPos[]): Sim => Sim.from(balls);

interface Plan {
  shot: ShotParams;
  cue?: { x: number; y: number };
}

function evaluate(state: MatchState, me: number, shot: ShotParams, cue: { x: number; y: number }, cfg: LevelCfg): number {
  const s = JSON.parse(JSON.stringify(state)) as MatchState;
  const c = s.balls.find((b) => b.id === 0)!;
  c.x = cue.x;
  c.y = cue.y;
  const sim = toSim(s.balls);
  strike(sim.balls[0]!, shot);
  sim.run(25);
  const { state: after, out } = resolveShot(s, sim);
  if (out.over) return after.winner === me ? 100000 : -100000;
  let score = 0;
  if (out.foul) score -= 5000;
  score += out.potted.length * 200;
  if (!out.foul && out.again) {
    score += 80;
    if (cfg.position) {
      const cc = after.balls.find((b) => b.id === 0)!;
      if (cc.on) {
        const next = candidates(after.balls, legalTargets(after), cc);
        if (next.length) score += Math.max(0, 80 + next[0]!.score * 25);
      }
    }
  }
  return score;
}

/** Posição da branca quando está na mão. */
function placeCue(state: MatchState, cfg: LevelCfg, r: Rnd): { x: number; y: number } {
  const tgt = legalTargets(state);
  const minX = -HL + BALL_R * 1.5;
  const maxX = state.inHand === 'head' ? HEAD_X : HL - BALL_R * 1.5;
  let best = { x: Math.max(minX, Math.min(maxX, state.balls.find((b) => b.id === 0)!.x)), y: 0 };
  best = nearestFree(state, best.x, best.y);
  let bestScore = -Infinity;
  const nx = cfg.position ? 16 : 9;
  const ny = cfg.position ? 9 : 5;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const x = minX + ((maxX - minX) * (i + (cfg.position ? 0 : r() * 0.8))) / Math.max(1, nx - 1);
      const y = -HW + BALL_R * 2 + ((2 * HW - BALL_R * 4) * (j + (cfg.position ? 0 : r() * 0.8))) / Math.max(1, ny - 1);
      const np = nearestFree(state, x, y);
      if (Math.abs(np.x - x) > 0.001 || Math.abs(np.y - y) > 0.001) continue;
      const cs = candidates(state.balls, tgt, np);
      const sc = cs.length ? cs[0]!.score + (cs.length > 1 ? cs[1]!.score * 0.1 : 0) : -50;
      if (sc > bestScore) {
        bestScore = sc;
        best = np;
      }
    }
  }
  return best;
}

export function botPlan(state: MatchState, level: BotLevel, rnd: Rnd = Math.random): Plan {
  const cfg = LEVEL_CFG[level];
  const me = state.turn;
  const plan: Plan = { shot: { dx: 1, dy: 0, v: 2, a: 0, b: 0 } };
  let cue = state.balls.find((b) => b.id === 0)!;
  if (state.inHand !== 'none') {
    const p = placeCue(state, cfg, rnd);
    plan.cue = p;
    cue = { id: 0, x: p.x, y: p.y, on: true };
  }
  const tgt = legalTargets(state);
  const balls = state.balls.map((b) => (b.id === 0 ? { ...b, x: cue.x, y: cue.y, on: true } : b));
  const cands = candidates(balls, tgt, cue);

  let chosen: { dx: number; dy: number; v: number; b: number; a: number } | null = null;
  if (cands.length > 0 && rnd() >= cfg.slip) {
    let list = cands.slice(0, Math.max(1, cfg.sims));
    if (cfg.sims === 0) {
      // sem simulação: o mais fácil (os fracos escolhem entre os 3 melhores)
      const k = level === 'facil' ? Math.min(3, cands.length) : 1;
      list = [cands[Math.floor(rnd() * k)]!];
    }
    if (cfg.sims > 0) {
      let bestScore = -Infinity;
      for (const c of list) {
        const v0 = speedFor(c);
        const variants: [number, number][] = cfg.spins === 1 ? [[0.12, 1]] : [[0.12, 1], [-0.3, 1], [0.38, 1]];
        const speeds = cfg.spins === 1 ? [v0] : [v0, v0 * 1.18];
        for (const [b] of variants) {
          for (const v of speeds) {
            const shot: ShotParams = { dx: c.dx, dy: c.dy, v: Math.min(MAX_SPEED, v), a: 0, b };
            const sc = evaluate({ ...state, balls }, me, shot, cue, cfg) + c.score * 0.3;
            if (sc > bestScore) {
              bestScore = sc;
              chosen = { dx: c.dx, dy: c.dy, v: shot.v, a: 0, b };
            }
          }
        }
      }
    } else {
      const c = list[0]!;
      chosen = { dx: c.dx, dy: c.dy, v: speedFor(c), a: 0, b: 0.1 };
    }
  }
  if (!chosen && cfg.sims > 0 && tgt.length > 0) {
    // sem tacada limpa: os níveis altos procuram, na física, uma jogada segura (toca primeiro na bola certa, sem falta)
    const near = tgt
      .map((id) => balls.find((b) => b.id === id && b.on)!)
      .filter(Boolean)
      .sort((a, b) => (a.x - cue.x) ** 2 + (a.y - cue.y) ** 2 - ((b.x - cue.x) ** 2 + (b.y - cue.y) ** 2))
      .slice(0, 6);
    let bestScore = -Infinity;
    for (const t of near) {
      const base = Math.atan2(t.y - cue.y, t.x - cue.x);
      const dist = Math.sqrt((t.x - cue.x) ** 2 + (t.y - cue.y) ** 2);
      const spread = Math.asin(Math.min(0.9, (BALL_D * 0.85) / Math.max(dist, BALL_D * 1.2)));
      for (const off of [0, spread * 0.5, -spread * 0.5, spread * 0.9, -spread * 0.9]) {
        for (const v of [1.5, 2.6]) {
          const ang = base + off;
          const shot: ShotParams = { dx: Math.cos(ang), dy: Math.sin(ang), v, a: 0, b: 0 };
          const sc = evaluate({ ...state, balls }, me, shot, cue, cfg) - dist * 5;
          if (sc > bestScore) {
            bestScore = sc;
            chosen = { dx: shot.dx, dy: shot.dy, v, a: 0, b: 0 };
          }
        }
      }
    }
  }
  if (!chosen) {
    // sem tacada limpa: toca na bola legal mais acessível (ou escolhe qualquer uma)
    let bestId = -1;
    let bestD = Infinity;
    for (const id of tgt) {
      const t = balls.find((b) => b.id === id && b.on)!;
      const d = Math.sqrt((t.x - cue.x) ** 2 + (t.y - cue.y) ** 2);
      let blocked = false;
      for (const o of balls) {
        if (!o.on || o.id === 0 || o.id === id) continue;
        if (segDist(o.x, o.y, cue.x, cue.y, t.x, t.y) < BALL_D) {
          blocked = true;
          break;
        }
      }
      const eff = d + (blocked ? 2 : 0);
      if (eff < bestD) {
        bestD = eff;
        bestId = id;
      }
    }
    const t = balls.find((b) => b.id === bestId) ?? balls.find((b) => b.id !== 0 && b.on)!;
    let dx = t.x - cue.x;
    let dy = t.y - cue.y;
    const l = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= l;
    dy /= l;
    chosen = { dx, dy, v: Math.min(3.2, 1.3 + l * 1.5), a: 0, b: 0 };
  }
  // erro humano
  const ang = Math.atan2(chosen.dy, chosen.dx) + gauss(rnd) * cfg.angleSigma;
  const v = chosen.v * (1 + gauss(rnd) * cfg.powerSigma);
  plan.shot = { dx: Math.cos(ang), dy: Math.sin(ang), v: Math.min(MAX_SPEED, Math.max(0.35, v)), a: chosen.a, b: chosen.b };
  return plan;
}

/** Tempo de "pensar" simulado, em ms (para o bot não jogar instantaneamente). */
export const thinkMs = (level: BotLevel, rnd: Rnd = Math.random): number => ({ facil: 900, normal: 1300, dificil: 1700, mestre: 2000 })[level] + rnd() * 900;
export { powerToSpeed };
