/**
 * Placement des écrans d'un salon sur une grille. Deux écrans voisins dans la grille
 * sont reliés par leurs bords : à droite de A ↔ à gauche de B, en dessous de A ↔ au-dessus
 * de B. Module pur (sans dépendance), testé par `node --test`.
 */

export type Side = 'left' | 'right' | 'top' | 'bottom';
export interface Cell {
  col: number;
  row: number;
}
/** Position de chaque joueur (par identifiant). */
export type Placement = Record<string, Cell>;

export const GRID_COLS = 5;
export const GRID_ROWS = 3;
export const SIDES: readonly Side[] = ['left', 'right', 'top', 'bottom'];
export const OPPOSITE: Record<Side, Side> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
const STEP: Record<Side, Cell> = {
  left: { col: -1, row: 0 },
  right: { col: 1, row: 0 },
  top: { col: 0, row: -1 },
  bottom: { col: 0, row: 1 },
};

const inGrid = (c: Cell): boolean => c.col >= 0 && c.col < GRID_COLS && c.row >= 0 && c.row < GRID_ROWS;

function occupant(layout: Placement, cell: Cell): string | null {
  for (const [id, c] of Object.entries(layout)) if (c.col === cell.col && c.row === cell.row) return id;
  return null;
}

/** Voisin de chaque bord d'un joueur (absent = bord non relié). */
export function neighbors(layout: Placement, id: string): Partial<Record<Side, string>> {
  const me = layout[id];
  const out: Partial<Record<Side, string>> = {};
  if (!me) return out;
  for (const side of SIDES) {
    const other = occupant(layout, { col: me.col + STEP[side].col, row: me.row + STEP[side].row });
    if (other) out[side] = other;
  }
  return out;
}

/** Place un nouveau joueur : à droite du dernier écran de la ligne du milieu, sinon ailleurs. */
export function placeNew(layout: Placement, id: string): Placement {
  if (layout[id]) return layout;
  const next = { ...layout };
  const middle = Math.floor(GRID_ROWS / 2);
  const taken = Object.values(layout).filter((c) => c.row === middle);
  const startCol = taken.length === 0 ? Math.floor(GRID_COLS / 2) : Math.max(...taken.map((c) => c.col)) + 1;
  const candidates: Cell[] = [];
  for (let col = startCol; col < GRID_COLS; col++) candidates.push({ col, row: middle });
  for (let row = 0; row < GRID_ROWS; row++) for (let col = 0; col < GRID_COLS; col++) candidates.push({ col, row });
  const free = candidates.find((c) => inGrid(c) && !occupant(layout, c));
  if (free) next[id] = free;
  return next;
}

/** Déplace un joueur vers une case libre ; null si la case est prise ou hors grille. */
export function moveTo(layout: Placement, id: string, cell: Cell): Placement | null {
  if (!layout[id] || !inGrid(cell)) return null;
  const other = occupant(layout, cell);
  if (other && other !== id) return null;
  return { ...layout, [id]: { ...cell } };
}

export function remove(layout: Placement, id: string): Placement {
  const next = { ...layout };
  delete next[id];
  return next;
}

/** Valide un placement reçu du réseau (cases dans la grille, sans doublon, joueurs connus). */
export function sanitize(raw: unknown, ids: readonly string[]): Placement | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Placement = {};
  const seen = new Set<string>();
  for (const id of ids) {
    const c = (raw as Record<string, unknown>)[id] as Partial<Cell> | undefined;
    if (!c || !Number.isInteger(c.col) || !Number.isInteger(c.row)) return null;
    const cell = { col: c.col!, row: c.row! };
    const key = `${cell.col},${cell.row}`;
    if (!inGrid(cell) || seen.has(key)) return null;
    seen.add(key);
    out[id] = cell;
  }
  return out;
}

/**
 * Position d'arrivée sur l'écran voisin : même proportion le long du bord, juste à
 * l'intérieur du bord opposé. `t` va de 0 à 1 (haut→bas pour un bord vertical,
 * gauche→droite pour un bord horizontal).
 */
export function entryPoint(
  bounds: { left: number; top: number; right: number; bottom: number },
  entry: Side,
  t: number,
  half: number,
  height: number,
): { x: number; y: number } {
  const tt = Math.min(1, Math.max(0, t));
  const w = bounds.right - bounds.left;
  const h = bounds.bottom - bounds.top;
  switch (entry) {
    case 'left':
      return { x: bounds.left + half + 2, y: Math.max(bounds.top + height, bounds.top + tt * h) };
    case 'right':
      return { x: bounds.right - half - 2, y: Math.max(bounds.top + height, bounds.top + tt * h) };
    case 'top':
      return { x: bounds.left + tt * w, y: bounds.top + height + 2 };
    case 'bottom':
      return { x: bounds.left + tt * w, y: bounds.bottom - 2 };
  }
}
