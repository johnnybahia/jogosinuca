/**
 * Regras da sinuca (jogo de bolas numeradas, 2 jogadores).
 *  - par_impar: sinuca brasileira com 8 — um jogador fica com as pares, o outro com as ímpares, a 8 por último.
 *  - lisas_listradas: bola 8 internacional (1–7 lisas, 9–15 listradas).
 *  - bola61: quem fizer 61 pontos primeiro (valor = número da bola). Tem que tocar primeiro na menor da mesa.
 *  - guerra: jogo de bar. 7 bolas azuis contra 7 vermelhas coladas nas tabelas longas; vence quem limpar o lado do adversário.
 *    Tem que tocar primeiro numa bola do adversário; derrubar bola sua (fogo amigo) fica contra você; branca na caçapa = bola na mão.
 */
import type { BallPos } from './physics';
import { Sim } from './physics';
import { BALL_D, BALL_R, FOOT_X, HEAD_X, HL, HW } from './table';

export type Mode = 'par_impar' | 'lisas_listradas' | 'bola61' | 'guerra';
export type Group = 'even' | 'odd' | 'solid' | 'stripe' | 'red' | 'blue';
/** 'choice' (Guerra): quem recebeu a falta ainda vai escolher entre bola na mão e ressuscitar uma bola sua. */
export type InHand = 'none' | 'any' | 'head' | 'choice';

export const MODES: { id: Mode; name: string; short: string; desc: string }[] = [
  { id: 'par_impar', name: 'Par ou Ímpar', short: 'Pares x Ímpares', desc: 'Sinuca brasileira: um fica com as bolas pares, o outro com as ímpares. A 8 só no final.' },
  { id: 'lisas_listradas', name: 'Lisas x Listradas', short: 'Bola 8', desc: 'Bola 8 clássica: 1–7 lisas contra 9–15 listradas. A 8 só no final.' },
  { id: 'guerra', name: 'Sinuca de boteco valendo a 🍺', short: 'Azuis x Vermelhas', desc: 'Brincadeira de boteco: 7 bolas azuis contra 7 vermelhas coladas nas tabelas. Derrube as do adversário; as suas, nunca. Toque sempre primeiro numa bola dele.' },
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

export const isGroupMode = (m: Mode): boolean => m !== 'bola61' && m !== 'guerra';

export const groupOf = (mode: Mode, id: number): Group | null => {
  if (mode === 'guerra') return id >= 1 && id <= 7 ? 'blue' : id >= 8 && id <= 14 ? 'red' : null;
  if (id <= 0 || id === 8) return null;
  if (mode === 'par_impar') return id % 2 === 0 ? 'even' : 'odd';
  if (mode === 'lisas_listradas') return id < 8 ? 'solid' : 'stripe';
  return null;
};

export const groupName = (g: Group | null): string =>
  g === 'even' ? 'Pares' : g === 'odd' ? 'Ímpares' : g === 'solid' ? 'Lisas' : g === 'stripe' ? 'Listradas' : g === 'blue' ? 'Azuis' : g === 'red' ? 'Vermelhas' : '—';

export const otherGroup = (g: Group): Group => (g === 'even' ? 'odd' : g === 'odd' ? 'even' : g === 'solid' ? 'stripe' : g === 'stripe' ? 'solid' : g === 'blue' ? 'red' : 'blue');

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

/**
 * Guerra: com a mesa imaginada na vertical, uma cor ocupa a metade de cima e a outra a de baixo (azuis no fim x<0,
 * vermelhas no fim x>0). Cada cor: 3 coladas no fundo (tabela curta do seu fim) e 2 em cada tabela longa.
 * Ids 1–7 azuis, 8–14 vermelhas; a 15 não é usada.
 */
const GUERRA_LONG_X = [0.4, 0.8];
const GUERRA_FOOT_Y = [0, 0.25, -0.25];

export function guerraSlot(group: 'blue' | 'red', i: number): { x: number; y: number } {
  const d = group === 'blue' ? -1 : 1;
  const e = HW - BALL_R - 0.0004;
  if (i < 3) return { x: d * (HL - BALL_R - 0.0004), y: GUERRA_FOOT_Y[i]! };
  const k = i - 3;
  return { x: d * GUERRA_LONG_X[k >> 1]!, y: k & 1 ? -e : e };
}

export function guerraPositions(): BallPos[] {
  const out: BallPos[] = [{ id: 0, x: 0, y: 0, on: true }];
  for (let i = 0; i < 7; i++) {
    const bl = guerraSlot('blue', i);
    const rd = guerraSlot('red', i);
    out.push({ id: 1 + i, x: bl.x, y: bl.y, on: true });
    out.push({ id: 8 + i, x: rd.x, y: rd.y, on: true });
  }
  out.push({ id: 15, x: 0, y: 0, on: false });
  out.sort((a, b) => a.id - b.id);
  return out;
}

export function newMatch(mode: Mode, firstTurn = 0): MatchState {
  if (mode === 'guerra') {
    return { mode, balls: guerraPositions(), turn: firstTurn, groups: ['blue', 'red'], score: [0, 0], tray: [], inHand: 'none', breakShot: false, over: false, winner: -1, shotNo: 0 };
  }
  return { mode, balls: rackPositions(), turn: firstTurn, groups: [null, null], score: [0, 0], tray: [], inHand: 'none', breakShot: true, over: false, winner: -1, shotNo: 0 };
}

export const cloneState = (s: MatchState): MatchState => JSON.parse(JSON.stringify(s)) as MatchState;

/** Bolas do grupo (ou, na 61, todas) que ainda estão na mesa. */
export function remaining(s: MatchState, player: number): number {
  const g = s.groups[player];
  if (!g) return 99;
  if (s.mode === 'guerra') return s.balls.filter((b) => b.on && b.id > 0 && groupOf('guerra', b.id) === g).length;
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
  if (s.mode === 'guerra') {
    const mine = s.groups[s.turn];
    return !!mine && groupOf('guerra', id) === otherGroup(mine);
  }
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
  if (s.inHand === 'none' || s.inHand === 'choice') return false;
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

/** Guerra: bolas de `seat` que já saíram da mesa e podem ser ressuscitadas (a mais recente primeiro). */
export function revivable(s: MatchState, seat: number): number[] {
  const g = s.groups[seat];
  if (s.mode !== 'guerra' || !g) return [];
  return s.tray.filter((id) => groupOf('guerra', id) === g).reverse();
}

/** O que o jogador que recebe a falta ganha: escolha (se tiver bola para ressuscitar) ou bola na mão. */
export const foulHand = (s: MatchState): InHand => (s.mode === 'guerra' && revivable(s, s.turn).length > 0 ? 'choice' : 'any');

/** Guerra: aplica a escolha de quem recebeu a falta. 'revive' recoloca uma bola sua na tabela do seu lado; senão bola na mão. */
export function applyPenalty(s: MatchState, choice: 'hand' | 'revive'): { revived: number | null } {
  if (s.inHand !== 'choice') return { revived: null };
  const list = revivable(s, s.turn);
  if (choice !== 'revive' || list.length === 0) {
    s.inHand = 'any';
    return { revived: null };
  }
  const id = list[0]!;
  const ball = s.balls.find((b) => b.id === id)!;
  const grp = groupOf('guerra', id) as 'blue' | 'red';
  const idx = id - (grp === 'blue' ? 1 : 8);
  const side = grp === 'blue' ? 1 : -1;
  const yy = side * (HW - BALL_R - 0.0004);
  const cands: { x: number; y: number }[] = [guerraSlot(grp, idx)];
  for (let i = 0; i < 7; i++) cands.push(guerraSlot(grp, i));
  for (let i = 0; i <= 40; i++) cands.push({ x: (grp === 'blue' ? -1 : 1) * (0.25 + (i * (HL - 0.5)) / 40), y: yy });
  for (const c of cands) {
    if (free(s.balls, c.x, c.y, id)) {
      ball.x = c.x;
      ball.y = c.y;
      ball.on = true;
      break;
    }
  }
  s.tray = s.tray.filter((t) => t !== id);
  s.inHand = 'none';
  return { revived: id };
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
    foul = s.mode === 'guerra' ? 'Tocou primeiro numa bola sua' : s.mode === 'bola61' ? `Tinha que tocar na bola ${lowestOnTable(prev.balls)}` : first === 8 && prevRemaining !== 0 ? 'Tocou na 8 antes da hora' : 'Tocou primeiro numa bola do adversário';
  }

  const out: ShotOutcome = { foul, message: '', again: false, potted: objPotted.slice(), respotted: [], over: false, winner: -1 };

  // bola da cabeça: 8 na quebra volta para a mesa
  if (wasBreak && objPotted.includes(8) && isGroupMode(s.mode)) {
    respot(s.balls, 8);
    out.respotted.push(8);
    out.potted = out.potted.filter((id) => id !== 8);
    objPotted.splice(objPotted.indexOf(8), 1);
  }

  if (s.mode === 'guerra') {
    const mineG = s.groups[me]!;
    const oppG = s.groups[opp]!;
    const mineP = objPotted.filter((id) => groupOf('guerra', id) === mineG);
    const oppP = objPotted.filter((id) => groupOf('guerra', id) === oppG);
    s.tray.push(...objPotted);
    s.inHand = 'none';
    const left = (g: Group): number => s.balls.filter((b) => b.on && b.id > 0 && groupOf('guerra', b.id) === g).length;
    const myLeft = left(mineG);
    const oppLeft = left(oppG);
    s.score[me] = 7 - oppLeft;
    s.score[opp] = 7 - myLeft;
    if (foul) {
      s.turn = opp;
      s.inHand = foulHand(s);
      out.message = mineP.length ? `${foul}. Fogo amigo` : foul;
    } else if (oppP.length > 0 && mineP.length === 0) {
      out.again = true;
      out.message = oppP.length > 1 ? `${oppP.length} bolas do adversário!` : 'Bola do adversário!';
    } else {
      s.turn = opp;
      if (mineP.length) out.message = 'Fogo amigo: bola sua na caçapa';
    }
    // quem ficar sem bolas perde (inclusive por fogo amigo)
    if (myLeft === 0) {
      s.over = true;
      s.winner = opp;
      out.reason = 'ficou sem bolas';
      out.message = '';
    } else if (oppLeft === 0) {
      s.over = true;
      s.winner = me;
      out.reason = 'limpou o lado do adversário';
      out.message = '';
    }
  } else if (s.mode === 'bola61') {
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
    if (s.inHand !== 'choice') s.inHand = wasBreak ? 'head' : 'any';
    const np = nearestFree({ ...s, inHand: s.inHand === 'choice' ? 'any' : s.inHand }, spot.x, spot.y);
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
