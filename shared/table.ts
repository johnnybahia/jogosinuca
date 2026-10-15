/**
 * Geometria da mesa (metros). Proporções tiradas do modelo 3D fornecido (campo de 1200 x 622 unidades
 * com bolas de 37,86 de diâmetro), em escala de bola de 57,15 mm. Plano da física: x = comprimento, y = largura
 * (no 3D, y da física vira z). Origem no centro da mesa.
 */
export const BALL_R = 0.028575;
export const BALL_D = BALL_R * 2;
export const BALL_MASS = 0.17;
const K = BALL_R / 18.93;

/** Meio comprimento e meia largura do campo (linha do nariz da tabela). */
export const HL = 600.3 * K;
export const HW = 310.85 * K;

/** Altura do feltro no 3D (a mesa de verdade fica a ~78 cm do chão). */
export const FELT_Y = 0.78;
/** Altura do topo da tabela acima do feltro (63,5% do diâmetro da bola). */
export const CUSHION_H = 0.635 * BALL_D;

/** Abertura das caçapas medida na ponta das tabelas. */
export const CORNER_G = 0.078;
export const SIDE_G = 45.7 * K;
export const KNUCKLE_R = 0.0048;
/** Raio do buraco da caçapa na madeira e no pano (só visual). */
export const POCKET_HOLE_R = 0.062;
/** Profundidade da tabela (do nariz ao fundo) e largura da madeira por fora dela. */
export const CUSHION_D = 0.04;
export const RAIL_W = 0.085;

export interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** normal unitária apontando para dentro do campo */
  nx: number;
  ny: number;
}
export interface Knuckle {
  x: number;
  y: number;
}
export interface Pocket {
  /** centro do buraco (para o 3D) */
  x: number;
  y: number;
  r: number;
  /** boca: pontas das tabelas que a emolduram e normal que aponta para fora da mesa */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  nx: number;
  ny: number;
  side: boolean;
}

const seg = (x1: number, y1: number, x2: number, y2: number, nx: number, ny: number): Seg => ({ x1, y1, x2, y2, nx, ny });

const LONG_X1 = SIDE_G;
const LONG_X2 = HL - CORNER_G;
const SHORT_Y = HW - CORNER_G;

/** 6 tabelas retas: 4 nas laterais compridas (duas por lado) e 2 nas cabeceiras. */
export const SEGS: Seg[] = [
  seg(LONG_X1, HW, LONG_X2, HW, 0, -1),
  seg(-LONG_X2, HW, -LONG_X1, HW, 0, -1),
  seg(LONG_X1, -HW, LONG_X2, -HW, 0, 1),
  seg(-LONG_X2, -HW, -LONG_X1, -HW, 0, 1),
  seg(HL, -SHORT_Y, HL, SHORT_Y, -1, 0),
  seg(-HL, -SHORT_Y, -HL, SHORT_Y, 1, 0),
];

export const KNUCKLES: Knuckle[] = [
  { x: LONG_X1, y: HW },
  { x: -LONG_X1, y: HW },
  { x: LONG_X1, y: -HW },
  { x: -LONG_X1, y: -HW },
  { x: LONG_X2, y: HW },
  { x: -LONG_X2, y: HW },
  { x: LONG_X2, y: -HW },
  { x: -LONG_X2, y: -HW },
  { x: HL, y: SHORT_Y },
  { x: HL, y: -SHORT_Y },
  { x: -HL, y: SHORT_Y },
  { x: -HL, y: -SHORT_Y },
];

const corner = (sx: number, sy: number): Pocket => {
  const ax = sx * LONG_X2;
  const ay = sy * HW;
  const bx = sx * HL;
  const by = sy * SHORT_Y;
  const inv = Math.SQRT1_2;
  return { x: sx * (HL - 0.004), y: sy * (HW - 0.004), r: POCKET_HOLE_R, ax, ay, bx, by, nx: sx * inv, ny: sy * inv, side: false };
};
const side = (sy: number): Pocket => ({ x: 0, y: sy * (HW + 0.025), r: POCKET_HOLE_R, ax: -SIDE_G, ay: sy * HW, bx: SIDE_G, by: sy * HW, nx: 0, ny: sy, side: true });

/** 0..5: cantos (-x,-y) (+x,-y) (-x,+y) (+x,+y) e meios (-y) (+y). */
export const POCKETS: Pocket[] = [corner(-1, -1), corner(1, -1), corner(-1, 1), corner(1, 1), side(-1), side(1)];

/** Casa da bola branca (saída) e marca do pé do triângulo. */
export const HEAD_X = -HL / 2;
export const FOOT_X = HL / 2;
