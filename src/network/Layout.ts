/**
 * Placement des écrans d'un salon : une file horizontale, de gauche à droite, sans trou.
 * Deux écrans voisins dans la file sont reliés par leurs bords (droite de A ↔ gauche de
 * B). Le sol de chacun reste le sien : on ne relie jamais un écran au-dessus d'un autre.
 * Module pur (sans dépendance), testé par `node --test`.
 */

export type Side = 'left' | 'right' | 'top' | 'bottom';
export interface Cell {
  col: number;
  row: number;
}
/** Position de chaque joueur (par identifiant) : `col` = rang dans la file, `row` = 0. */
export type Placement = Record<string, Cell>;

/** Longueur maximale de la file (= nombre maximal de joueurs). */
export const LINE_MAX = 8;
export const OPPOSITE: Record<Side, Side> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };

/** Identifiants dans l'ordre de la file, de gauche à droite. */
export function order(layout: Placement): string[] {
  return Object.entries(layout)
    .sort((a, b) => a[1].col - b[1].col)
    .map(([id]) => id);
}

/** Reconstruit une file compacte (rangs 0, 1, 2…) à partir d'un ordre. */
function fromOrder(ids: readonly string[]): Placement {
  const out: Placement = {};
  ids.forEach((id, col) => (out[id] = { col, row: 0 }));
  return out;
}

/** Voisins gauche et droite d'un joueur (absent = bord non relié). */
export function neighbors(layout: Placement, id: string): Partial<Record<Side, string>> {
  const line = order(layout);
  const i = line.indexOf(id);
  const out: Partial<Record<Side, string>> = {};
  if (i < 0) return out;
  if (i > 0) out.left = line[i - 1]!;
  if (i < line.length - 1) out.right = line[i + 1]!;
  return out;
}

/** Ajoute un joueur au bout (à droite) de la file. */
export function placeNew(layout: Placement, id: string): Placement {
  if (layout[id]) return layout;
  const line = order(layout);
  if (line.length >= LINE_MAX) return layout;
  return fromOrder([...line, id]);
}

/** Déplace un joueur à un rang de la file (les autres se décalent) ; null si impossible. */
export function moveTo(layout: Placement, id: string, index: number): Placement | null {
  const line = order(layout);
  const from = line.indexOf(id);
  if (from < 0 || !Number.isInteger(index) || index < 0 || index >= line.length) return null;
  if (from === index) return layout;
  line.splice(from, 1);
  line.splice(index, 0, id);
  return fromOrder(line);
}

/** Retire un joueur ; la file se resserre (ses deux voisins deviennent reliés). */
export function remove(layout: Placement, id: string): Placement {
  return fromOrder(order(layout).filter((x) => x !== id));
}

/** Valide un placement reçu du réseau : une file compacte contenant exactement ces joueurs. */
export function sanitize(raw: unknown, ids: readonly string[]): Placement | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Placement = {};
  const seen = new Set<number>();
  for (const id of ids) {
    const c = (raw as Record<string, unknown>)[id] as Partial<Cell> | undefined;
    if (!c || !Number.isInteger(c.col) || c.row !== 0) return null;
    const col = c.col!;
    if (col < 0 || col >= ids.length || seen.has(col)) return null;
    seen.add(col);
    out[id] = { col, row: 0 };
  }
  return out;
}

/**
 * Position d'arrivée sur l'écran voisin : même hauteur relative, juste à l'intérieur du
 * bord opposé. `t` va de 0 (haut) à 1 (bas).
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
