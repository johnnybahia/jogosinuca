/**
 * Motor de física da sinuca. Determinístico (só + − × ÷ e raiz quadrada, que são exatos em qualquer
 * navegador/servidor): o mesmo tiro dá o mesmo resultado no cliente, no servidor e nos bots.
 *
 * Modelo: bolas rígidas com giro 3D (rolagem, efeito lateral e de topo/recuo), atrito deslizante e de rolagem
 * no pano, colisão bola-bola com restituição e atrito (carrega o giro lateral e dá o "throw" no corte),
 * tabela com restituição que cai com a velocidade e atrito (o efeito muda o ângulo de saída) e caçapas.
 */
import { BALL_D, BALL_R, HL, HW, KNUCKLE_R, KNUCKLES, POCKETS, SEGS } from './table';

export const DT = 1 / 480;
const G = 9.81;
const MU_S = 0.2;
const MU_R = 0.011;
const E_BALL = 0.95;
const MU_BALL = 0.05;
const E_CUSH0 = 0.84;
const MU_CUSH = 0.16;
const WZ_TAU = 1.4;
const WZ_LIN = 4;
const V_EPS = 0.0009;
const D2 = BALL_D * BALL_D;
const R = BALL_R;

export interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  wx: number;
  wy: number;
  wz: number;
  /** ainda na mesa (false = encaçapada) */
  on: boolean;
  /** parada (sem velocidade nem giro) */
  rest: boolean;
}

export type SimEvent =
  | { t: number; k: 'ball'; a: number; b: number; v: number }
  | { t: number; k: 'cushion'; a: number; v: number }
  | { t: number; k: 'pocket'; a: number; p: number; v: number };

export interface BallPos {
  id: number;
  x: number;
  y: number;
  on: boolean;
}

export const newBall = (id: number, x = 0, y = 0): Ball => ({ id, x, y, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, on: true, rest: true });

export interface ShotParams {
  /** direção unitária da tacada */
  dx: number;
  dy: number;
  /** velocidade da bola branca ao sair do taco (m/s) */
  v: number;
  /** ponto de contato no taco em unidades do raio: a = lado (+ direita), b = altura (+ topo, − recuo) */
  a: number;
  b: number;
}

export const MAX_SPEED = 6.8;
export const MIN_SPEED = 0.25;
export const MAX_OFFSET = 0.62;

/** Potência 0..1 da barra → velocidade da branca. */
export const powerToSpeed = (p: number): number => MIN_SPEED + (MAX_SPEED - MIN_SPEED) * (p * (0.35 + 0.65 * p));

/** Dá a tacada na bola branca: velocidade e giro vêm do ponto de contato. */
export function strike(b: Ball, s: ShotParams): void {
  const len = Math.sqrt(s.dx * s.dx + s.dy * s.dy) || 1;
  const dx = s.dx / len;
  const dy = s.dy / len;
  let a = s.a;
  let h = s.b;
  const off = Math.sqrt(a * a + h * h);
  if (off > MAX_OFFSET) {
    a = (a / off) * MAX_OFFSET;
    h = (h / off) * MAX_OFFSET;
  }
  const v = Math.min(MAX_SPEED, Math.max(0, s.v));
  b.vx = dx * v;
  b.vy = dy * v;
  const k = (5 * v) / (2 * R);
  b.wx = -dy * (k * h);
  b.wy = dx * (k * h);
  b.wz = k * a;
  b.rest = false;
}

export class Sim {
  balls: Ball[];
  t = 0;
  events: SimEvent[] = [];
  /** dados para as regras */
  firstHit = -1;
  pocketed: { id: number; p: number }[] = [];
  /** bolas que encostaram na tabela depois do primeiro contato da branca */
  railAfterHit = false;
  cushionTouched = new Set<number>();
  private cueHitSeen = false;

  constructor(balls: Ball[]) {
    this.balls = balls;
  }

  static from(pos: BallPos[]): Sim {
    const balls: Ball[] = [];
    for (const p of pos) {
      const b = newBall(p.id, p.x, p.y);
      b.on = p.on;
      balls[p.id] = b;
    }
    return new Sim(balls);
  }

  positions(): BallPos[] {
    const out: BallPos[] = [];
    for (const b of this.balls) if (b) out.push({ id: b.id, x: b.x, y: b.y, on: b.on });
    return out;
  }

  moving(): boolean {
    for (const b of this.balls) if (b && b.on && !b.rest) return true;
    return false;
  }

  private emit(e: SimEvent): void {
    this.events.push(e);
  }

  private advance(b: Ball, dt: number): void {
    let rem = dt;
    const ux = b.vx - R * b.wy;
    const uy = b.vy + R * b.wx;
    const us = Math.sqrt(ux * ux + uy * uy);
    if (us > 1e-5) {
      const ts = us / (3.5 * MU_S * G);
      const t1 = ts < rem ? ts : rem;
      const ax = (-MU_S * G * ux) / us;
      const ay = (-MU_S * G * uy) / us;
      b.x += b.vx * t1 + 0.5 * ax * t1 * t1;
      b.y += b.vy * t1 + 0.5 * ay * t1 * t1;
      b.vx += ax * t1;
      b.vy += ay * t1;
      const al = (2.5 * MU_S * G) / R;
      b.wx -= al * (uy / us) * t1;
      b.wy += al * (ux / us) * t1;
      rem -= t1;
      if (t1 >= ts) {
        b.wy = b.vx / R;
        b.wx = -b.vy / R;
      }
    }
    if (rem > 0) {
      const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (sp > 1e-6) {
        const dec = MU_R * G;
        const stop = sp / dec;
        if (stop <= rem) {
          const d = (sp * stop) / 2;
          b.x += (b.vx / sp) * d;
          b.y += (b.vy / sp) * d;
          b.vx = 0;
          b.vy = 0;
          b.wx = 0;
          b.wy = 0;
        } else {
          const hx = b.vx / sp;
          const hy = b.vy / sp;
          b.x += b.vx * rem - 0.5 * dec * hx * rem * rem;
          b.y += b.vy * rem - 0.5 * dec * hy * rem * rem;
          const ns = sp - dec * rem;
          b.vx = hx * ns;
          b.vy = hy * ns;
          b.wy = b.vx / R;
          b.wx = -b.vy / R;
        }
      } else if (Math.abs(b.wx) + Math.abs(b.wy) > 0 && us <= 1e-5) {
        b.wx = 0;
        b.wy = 0;
      }
    }
    // giro lateral: perde por atrito de pivô (exponencial + parcela fixa)
    if (b.wz !== 0) {
      const aw = Math.abs(b.wz);
      let nw = aw - (WZ_LIN + aw / WZ_TAU) * dt;
      if (nw < 0.4) nw = 0;
      b.wz = b.wz < 0 ? -nw : nw;
    }
    const sp2 = b.vx * b.vx + b.vy * b.vy;
    if (sp2 < V_EPS * V_EPS && b.wz === 0) {
      const uu = (b.vx - R * b.wy) * (b.vx - R * b.wy) + (b.vy + R * b.wx) * (b.vy + R * b.wx);
      if (uu < V_EPS * V_EPS) {
        b.vx = 0;
        b.vy = 0;
        b.wx = 0;
        b.wy = 0;
        b.rest = true;
      }
    }
  }

  /** Impulso da tabela/ponta numa bola. n aponta da parede para a bola. */
  private cushionHit(b: Ball, nx: number, ny: number): void {
    const vn = b.vx * nx + b.vy * ny;
    if (vn >= 0) return;
    const sp = -vn;
    let e = E_CUSH0 - 0.022 * (sp > 6 ? 6 : sp);
    if (sp < 0.3) e = 0.5 + (e - 0.5) * (sp / 0.3);
    const jn = (1 + e) * sp;
    const tx = -ny;
    const ty = nx;
    const vt = b.vx * tx + b.vy * ty;
    const ut = vt - R * b.wz;
    const lim = ut < 0 ? -ut : ut;
    const maxj = MU_CUSH * jn;
    const need = lim / 3.5;
    const jt = ut === 0 ? 0 : (ut > 0 ? -1 : 1) * (maxj < need ? maxj : need);
    b.vx += jn * nx + jt * tx;
    b.vy += jn * ny + jt * ty;
    b.wz -= (2.5 * jt) / R;
    b.rest = false;
    if (this.cueHitSeen) this.railAfterHit = true;
    this.emit({ t: this.t, k: 'cushion', a: b.id, v: sp });
    if (b.id !== 0 && this.cueHitSeen) this.cushionTouched.add(b.id);
  }

  private cushions(b: Ball): void {
    // caçapas primeiro: o centro cruzou a boca
    for (let i = 0; i < POCKETS.length; i++) {
      const p = POCKETS[i]!;
      const d = (b.x - p.ax) * p.nx + (b.y - p.ay) * p.ny;
      if (d <= 0) continue;
      // projeção na linha da boca
      const sx = p.bx - p.ax;
      const sy = p.by - p.ay;
      const u = ((b.x - p.ax) * sx + (b.y - p.ay) * sy) / (sx * sx + sy * sy);
      if (u >= -0.05 && u <= 1.05) {
        const v = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        b.on = false;
        b.rest = true;
        b.vx = b.vy = b.wx = b.wy = b.wz = 0;
        this.pocketed.push({ id: b.id, p: i });
        this.emit({ t: this.t, k: 'pocket', a: b.id, p: i, v });
        return;
      }
    }
    if (b.x < -HL - 0.2 || b.x > HL + 0.2 || b.y < -HW - 0.2 || b.y > HW + 0.2) {
      b.on = false;
      b.rest = true;
      b.vx = b.vy = b.wx = b.wy = b.wz = 0;
      this.pocketed.push({ id: b.id, p: -1 });
      this.emit({ t: this.t, k: 'pocket', a: b.id, p: -1, v: 0 });
      return;
    }
    // só perto da borda vale testar as tabelas
    if (b.x > -HL + 0.2 && b.x < HL - 0.2 && b.y > -HW + 0.2 && b.y < HW - 0.2) return;
    for (let i = 0; i < SEGS.length; i++) {
      const s = SEGS[i]!;
      const d = (b.x - s.x1) * s.nx + (b.y - s.y1) * s.ny;
      if (d >= R) continue;
      // posição ao longo da tabela
      let along: number;
      if (s.nx === 0) along = (b.x - s.x1) / (s.x2 - s.x1);
      else along = (b.y - s.y1) / (s.y2 - s.y1);
      if (along < 0 || along > 1) continue;
      if (d < -R) continue;
      b.x += s.nx * (R - d);
      b.y += s.ny * (R - d);
      this.cushionHit(b, s.nx, s.ny);
    }
    const rr = (R + KNUCKLE_R) * (R + KNUCKLE_R);
    for (let i = 0; i < KNUCKLES.length; i++) {
      const k = KNUCKLES[i]!;
      const dx = b.x - k.x;
      const dy = b.y - k.y;
      const dd = dx * dx + dy * dy;
      if (dd >= rr || dd === 0) continue;
      const dist = Math.sqrt(dd);
      const nx = dx / dist;
      const ny = dy / dist;
      const pen = R + KNUCKLE_R - dist;
      b.x += nx * pen;
      b.y += ny * pen;
      this.cushionHit(b, nx, ny);
    }
  }

  private pair(a: Ball, c: Ball, dt: number): void {
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= D2) return;
    let dist = Math.sqrt(d2);
    let nx: number;
    let ny: number;
    if (dist < 1e-9) {
      nx = 1;
      ny = 0;
      dist = 0;
    } else {
      nx = dx / dist;
      ny = dy / dist;
    }
    const rvx = c.vx - a.vx;
    const rvy = c.vy - a.vy;
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) {
      const pen = BALL_D - dist;
      if (pen > 1e-7) {
        a.x -= nx * pen * 0.5;
        a.y -= ny * pen * 0.5;
        c.x += nx * pen * 0.5;
        c.y += ny * pen * 0.5;
      }
      return;
    }
    // volta ao instante do contato
    const aa = rvx * rvx + rvy * rvy;
    const dv = dx * rvx + dy * rvy;
    const cc = d2 - D2;
    let tau = (dv + Math.sqrt(Math.max(0, dv * dv - aa * cc))) / aa;
    if (!(tau >= 0)) tau = 0;
    if (tau > dt) tau = dt;
    a.x -= a.vx * tau;
    a.y -= a.vy * tau;
    c.x -= c.vx * tau;
    c.y -= c.vy * tau;
    const ex = c.x - a.x;
    const ey = c.y - a.y;
    const el = Math.sqrt(ex * ex + ey * ey);
    if (el > 1e-9) {
      nx = ex / el;
      ny = ey / el;
    }
    const vn2 = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
    const sp = -vn2;
    if (sp > 0) {
      const jn = ((1 + E_BALL) * sp) / 2;
      const tx = -ny;
      const ty = nx;
      const ut = (a.vx - c.vx) * tx + (a.vy - c.vy) * ty + R * (a.wz + c.wz);
      const aut = ut < 0 ? -ut : ut;
      const maxj = MU_BALL * jn;
      const need = aut / 7;
      const jt = ut === 0 ? 0 : (ut > 0 ? -1 : 1) * (maxj < need ? maxj : need);
      a.vx += -jn * nx + jt * tx;
      a.vy += -jn * ny + jt * ty;
      c.vx += jn * nx - jt * tx;
      c.vy += jn * ny - jt * ty;
      const dw = (2.5 * jt) / R;
      a.wz += dw;
      c.wz += dw;
      a.rest = false;
      c.rest = false;
      if (!this.cueHitSeen && (a.id === 0 || c.id === 0)) {
        this.cueHitSeen = true;
        this.firstHit = a.id === 0 ? c.id : a.id;
      }
      this.emit({ t: this.t, k: 'ball', a: a.id, b: c.id, v: sp });
    }
    a.x += a.vx * tau;
    a.y += a.vy * tau;
    c.x += c.vx * tau;
    c.y += c.vy * tau;
  }

  /** Avança um passo de tempo. */
  step(dt = DT): void {
    const bs = this.balls;
    const n = bs.length;
    for (let i = 0; i < n; i++) {
      const b = bs[i];
      if (!b || !b.on || b.rest) continue;
      this.advance(b, dt);
      this.cushions(b);
    }
    for (let i = 0; i < n; i++) {
      const a = bs[i];
      if (!a || !a.on) continue;
      for (let j = i + 1; j < n; j++) {
        const c = bs[j];
        if (!c || !c.on) continue;
        if (a.rest && c.rest) continue;
        this.pair(a, c, dt);
      }
    }
    // bolas empurradas pelas colisões ainda podem ter ido de encontro às tabelas
    for (let i = 0; i < n; i++) {
      const b = bs[i];
      if (!b || !b.on || b.rest) continue;
      this.cushions(b);
    }
    this.t += dt;
  }

  /** Roda até tudo parar (ou o tempo máximo). Retorna o tempo simulado. */
  run(maxT = 40): number {
    const steps = Math.ceil(maxT / DT);
    for (let i = 0; i < steps; i++) {
      if (!this.moving()) break;
      this.step();
    }
    return this.t;
  }
}

/** Dá a tacada e simula até parar. Muda os `balls` e devolve a simulação. */
export function playShot(balls: Ball[], shot: ShotParams, maxT = 40): Sim {
  const cue = balls[0];
  const sim = new Sim(balls);
  if (cue) strike(cue, shot);
  sim.run(maxT);
  return sim;
}
