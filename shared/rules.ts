/**
 * Regras da sinuca (jogo de bolas numeradas, 2 jogadores).
 *  - par_impar: sinuca brasileira com 8 — um jogador fica com as pares, o outro com as ímpares, a 8 por último.
 *  - lisas_listradas: bola 8 internacional (1–7 lisas, 9–15 listradas).
 *  - bola61: quem fizer 61 pontos primeiro (valor = número da bola). Tem que tocar primeiro na menor da mesa.
 */
import type { BallPos } from './physics';
import { Sim } from './physics';
import { BALL_D, BALL_R, FOOT_X, HEAD_X, HL, HW } from './table';

export type Mode = 'par_impar' | 'lisas_listradas' | 'bola61';
export type Group = 'even' | 'odd' | 'solid' | 'stripe';
export type InHand = 'none' | 'any' | 'head';

export const MODES: { id: Mode; name: string; short: string; desc: string }[] = [
  { id: 'par_impar', name: 'Par ou Ímpar', short: 'Pares x Ímpares', desc: 'Sinuca brasileira: um fica com as bolas pares, o outro com as ímpares. A 8 só no final.' },
  { id: 'lisas_listradas', name: 'Lisas x Listradas', short: 'Bola 8', desc: 'Bola 8 clássica: 1–7 lisas contra 9–15 listradas. A 8 só no final.' },
  { id: 'bola61', name: 'Bola 61', short: '61 pontos', desc: 'Cada bola vale o seu número. Toque sempre na menor da mesa. Quem chegar a 61 vence.' },
];

export const POINTS_TO_WIN = 61;
export const FOUL_POINTS = 4;

export interface MatchState {
  mode: Mode;
  balls: BallPos[];
  turn: number;
  groups: (Group | null)[];
  /** bola 61: pontos. Demais: bolas do próprio grupo já encaçapadas */
  score: number[];
  /** ids das bolas encaçapadas, na ordem (bandeja) */
  tray: number[];
  inHand: InHand;
  breakShot: boolean;
  over: boolean;
  winner: number;
  shotNo: number;
}

export interface ShotOutcome {
  foul: string | null;
  message: string;
  /** a vez continua com o mesmo jogador */
  again: boolean;
  /** bolas encaçapadas no tiro (já sem as recolocadas) */
  potted: number[];
  /** bolas recolocadas na mesa depois de uma falta */
  respotted: number[];
  over: boolean;
  winner: number;
  reason?: string;
}

export const isGroupMode = (m: Mode): boolean => m !== 'bola61';

export const groupOf = (mode: Mode, id: number): Group | null => {
  if (id <= 0 || id === 8) return null;
  if (mode === 'par_impar') return id % 2 === 0 ? 'even' : 'odd';
  if (mode === 'lisas_listradas') return id < 8 ? 'solid' : 'stripe';
  return null;
};

export const groupName = (g: Group | null): string =>
  g === 'even' ? 'Pares' : g === 'odd' ? 'Ímpares' : g === 'solid' ? 'Lisas' : g === 'stripe' ? 'Listradas' : '—';

const otherGroup = (g: Group): Group => (g === 'even' ? 'odd' : g === 'odd' ? 'even' : g === 'solid' ? 'stripe' : 'solid');

/** Posição inicial: branca na casa e o triângulo com a 8 no centro e uma lisa e uma listrada nas pontas de trás. */
export function rackPositions(): BallPos[] {
  const order = [1, 10, 2, 3, 8, 11, 12, 4, 13, 5, 6, 14, 7, 15, 9];
  const out: BallPos[] = [{ id: 0, x: HEAD_X, y: 0, on: true }];
  let i = 0;
  const dx = BALL_R * 1.7321 + 0.00012;
  const dy = BALL_D + 0.00022;
  for (let row = 0; row < 5; row++) {
    for (let c = 0; c <= row; c++) {
      out.push({ id: order[i++]!, x: FOOT_X + row * dx, y: (c - row / 2) * dy, on: true });
    }
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

export function newMatch(mode: Mode, firstTurn = 0): MatchState {
  return { mode, balls: rackPositions(), turn: firstTurn, groups: [null, null], score: [0, 0], tray: [], inHand: 'none', breakShot: true, over: false, winner: -1, shotNo: 0 };
}

export const cloneState = (s: MatchState): MatchState => JSON.parse(JSON.stringify(s)) as MatchState;

/** Bolas do grupo (ou, na 61, todas) que ainda estão na mesa. */
export function remaining(s: MatchState, player: number): number {
  const g = s.groups[player];
  if (!g) return 99;
  let n = 0;
  for (const b of s.balls) if (b.on && b.id > 0 && b.id !== 8 && groupOf(s.mode, b.id) === g) n++;
  return n;
}

export const lowestOnTable = (balls: BallPos[]): number => {
  let m = 99;
  for (const b of balls) if (b.on && b.id > 0 && b.id < m) m = b.id;
  return m === 99 ? 8 : m;
};

/** A primeira bola tocada é permitida para quem joga? */
export function legalFirstHit(s: MatchState, id: number): boolean {
  if (id <= 0) return false;
  if (s.mode === 'bola61') return id === lowestOnTable(s.balls);
  const g = s.groups[s.turn];
  if (!g) return id !== 8;
  if (remaining(s, s.turn) === 0) return id === 8;
  return groupOf(s.mode, id) === g;
}

/** Bolas que o jogador da vez pode mirar. */
export function targets(s: MatchState): number[] {
  const out: number[] = [];
  for (const b of s.balls) if (b.on && legalFirstHit(s, b.id)) out.push(b.id);
  return out;
}

const free = (balls: BallPos[], x: number, y: number, ignore: number): boolean => {
  for (const b of balls) {
    if (!b.on || b.id === ignore) continue;
    const dx = b.x - x;
    const dy = b.y - y;
    if (dx * dx + dy * dy < BALL_D * BALL_D * 1.0004) return false;
  }
  return Math.abs(x) <= HL - BALL_R && Math.abs(y) <= HW - BALL_R;
};

/** Recoloca uma bola na linha central a partir da marca do pé, andando para trás se estiver ocupada. */
export function respot(balls: BallPos[], id: number): void {
  const b = balls.find((x) => x.id === id);
  if (!b) return;
  for (let k = 0; k < 40; k++) {
    const x = FOOT_X + k * (BALL_D + 0.0004);
    if (x <= HL - BALL_R && free(balls, x, 0, id)) {
      b.x = x;
      b.y = 0;
      b.on = true;
      return;
    }
  }
  for (let k = 1; k < 40; k++) {
    const x = FOOT_X - k * (BALL_D + 0.0004);
    if (free(balls, x, 0, id)) {
      b.x = x;
      b.y = 0;
      b.on = true;
      return;
    }
  }
}

export function placeCueLegal(s: MatchState, x: number, y: number): boolean {
  if (s.inHand === 'none') return false;
  if (s.inHand === 'head' && x > HEAD_X) return false;
  return free(s.balls, x, y, 0);
}

/** Posição legal mais próxima para a branca na mão. */
export function nearestFree(s: MatchState, x: number, y: number): { x: number; y: number } {
  let px = Math.min(Math.max(x, -HL + BALL_R), s.inHand === 'head' ? HEAD_X : HL - BALL_R);
  let py = Math.min(Math.max(y, -HW + BALL_R), HW - BALL_R);
  if (free(s.balls, px, py, 0)) return { x: px, y: py };
  // afasta de quem está atrapalhando
  for (let i = 0; i < 12; i++) {
    for (const b of s.balls) {
      if (!b.on || b.id === 0) continue;
      const dx = px - b.x;
      const dy = py - b.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < BALL_D * 1.01) {
        const k = (BALL_D * 1.01 - d) / (d || 1);
        px += (d === 0 ? 1 : dx) * k;
        py += dy * k;
      }
    }
    px = Math.min(Math.max(px, -HL + BALL_R), s.inHand === 'head' ? HEAD_X : HL - BALL_R);
    py = Math.min(Math.max(py, -HW + BALL_R), HW - BALL_R);
    if (free(s.balls, px, py, 0)) return { x: px, y: py };
  }
  return { x: px, y: py };
}

/** Aplica o resultado da física ao estado e decide faltas, vez e fim de jogo. */
export function resolveShot(prev: MatchState, sim: Sim): { state: MatchState; out: ShotOutcome } {
  const s = cloneState(prev);
  const me = s.turn;
  const opp = 1 - me;
  const wasBreak = s.breakShot;
  const potted = sim.pocketed.map((p) => p.id);
  const cueGone = potted.includes(0);
  const objPotted = potted.filter((id) => id !== 0);
  const first = sim.firstHit;
  s.balls = sim.positions();
  s.shotNo++;
  s.breakShot = false;

  let foul: string | null = null;
  const prevRemaining = isGroupMode(s.mode) ? remaining(prev, me) : 0;
  if (cueGone) foul = 'A branca caiu na caçapa';
  else if (first < 0) foul = 'A branca não tocou em nenhuma bola';
  else if (!legalFirstHit(prev, first)) {
    foul = s.mode === 'bola61' ? `Tinha que tocar na bola ${lowestOnTable(prev.balls)}` : first === 8 && prevRemaining !== 0 ? 'Tocou na 8 antes da hora' : 'Tocou primeiro numa bola do adversário';
  }

  const out: ShotOutcome = { foul, message: '', again: false, potted: objPotted.slice(), respotted: [], over: false, winner: -1 };

  // bola da cabeça: 8 na quebra volta para a mesa
  if (wasBreak && objPotted.includes(8) && isGroupMode(s.mode)) {
    respot(s.balls, 8);
    out.respotted.push(8);
    out.potted = out.potted.filter((id) => id !== 8);
    objPotted.splice(objPotted.indexOf(8), 1);
  }

  if (s.mode === 'bola61') {
    if (foul) {
      // bolas derrubadas numa falta voltam para a mesa
      for (const id of objPotted) {
        respot(s.balls, id);
        out.respotted.push(id);
      }
      out.potted = [];
      s.score[opp] += FOUL_POINTS;
      s.turn = opp;
      s.inHand = 'any';
      out.message = `${foul}. +${FOUL_POINTS} para o adversário`;
    } else {
      const pts = objPotted.reduce((a, b) => a + b, 0);
      s.score[me] += pts;
      s.tray.push(...objPotted);
      s.inHand = 'none';
      if (objPotted.length > 0) {
        out.again = true;
        out.message = `+${pts} ponto${pts === 1 ? '' : 's'}`;
      } else {
        s.turn = opp;
      }
    }
    if (s.score[me] >= POINTS_TO_WIN) {
      s.over = true;
      s.winner = me;
      out.reason = `${s.score[me]} pontos`;
    } else if (s.score[opp] >= POINTS_TO_WIN) {
      s.over = true;
      s.winner = opp;
      out.reason = `${s.score[opp]} pontos`;
    } else if (!s.balls.some((b) => b.on && b.id > 0)) {
      s.over = true;
      s.winner = s.score[0] === s.score[1] ? me : s.score[0] > s.score[1] ? 0 : 1;
      out.reason = 'mesa limpa';
    }
  } else {
    // define os grupos: a primeira bola derrubada numa tacada limpa
    if (!foul && !s.groups[0] && objPotted.length > 0) {
      const g = groupOf(s.mode, objPotted.find((id) => id !== 8) ?? 0);
      if (g) {
        s.groups[me] = g;
        s.groups[opp] = otherGroup(g);
      }
    }
    const pocketed8 = objPotted.includes(8);
    const sunk = objPotted.filter((id) => id !== 8);
    s.tray.push(...objPotted);
    if (pocketed8) {
      const legal = !foul && prevRemaining === 0 && s.groups[me] !== null;
      s.over = true;
      s.winner = legal ? me : opp;
      out.reason = legal ? 'derrubou a 8 no final' : foul ? `falta e a 8 caiu (${foul.toLowerCase()})` : 'derrubou a 8 antes da hora';
      out.message = legal ? 'Venceu com a 8!' : 'A 8 caiu fora de hora';
    } else if (foul) {
      s.turn = opp;
      s.inHand = 'any';
      out.message = foul;
      // falta: o infrator devolve à mesa uma das bolas que já fez
      // (quem já fez todas as suas e joga na 8 não devolve bola: errar a preta só passa a vez com bola na mão)
      const gm = s.groups[me];
      if (gm && prevRemaining > 0) {
        for (let i = s.tray.length - 1; i >= 0; i--) {
          const id = s.tray[i]!;
          if (id > 0 && id !== 8 && groupOf(s.mode, id) === gm) {
            s.tray.splice(i, 1);
            respot(s.balls, id);
            out.respotted.push(id);
            out.message = `${foul}. Devolve a bola ${id}`;
            break;
          }
        }
      }
    } else {
      const g = s.groups[me];
      const own = g ? sunk.filter((id) => groupOf(s.mode, id) === g) : sunk;
      const theirs = g ? sunk.filter((id) => groupOf(s.mode, id) !== g) : [];
      s.inHand = 'none';
      if (own.length > 0) {
        out.again = true;
        out.message = own.length > 1 ? `${own.length} bolas!` : 'Boa tacada!';
      } else {
        s.turn = opp;
        if (theirs.length > 0) out.message = 'Derrubou bola do adversário';
      }
    }
    // placar = bolas do grupo já na caçapa
    for (const p of [0, 1]) {
      const g = s.groups[p];
      s.score[p] = g ? s.tray.filter((id) => groupOf(s.mode, id) === g).length : 0;
    }
  }

  if (cueGone && !s.over) {
    // branca na mão: na quebra, atrás da linha da cabeça
    const spot = { x: HEAD_X, y: 0 };
    const cue = s.balls.find((b) => b.id === 0)!;
    cue.on = true;
    cue.x = spot.x;
    cue.y = spot.y;
    s.inHand = wasBreak ? 'head' : 'any';
    const np = nearestFree({ ...s, inHand: s.inHand }, spot.x, spot.y);
    cue.x = np.x;
    cue.y = np.y;
  }
  if (!out.message && foul) out.message = foul;
  if (s.over) {
    out.over = true;
    out.winner = s.winner;
  }
  return { state: s, out };
}
