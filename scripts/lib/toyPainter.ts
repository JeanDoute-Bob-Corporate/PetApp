/**
 * Jouets et aliments pixel-art (cases de 24×24), dessinés procéduralement.
 * Module pur, exécuté directement par Node. Chaque sprite est posé sur le bas de sa
 * case (ligne 23) : l'ancre « pieds » d'un objet est donc (12, 24).
 */

export const TOY_CELL = 24;

export const TOY_SPRITES = [
  'ball',
  'bag',
  'terminal0',
  'terminal1',
  'bowl_empty',
  'bowl_full',
  'cookie',
  'apple',
  'coffee',
  'bug0',
  'bug1',
  'note',
  'file',
] as const;
export type ToySprite = (typeof TOY_SPRITES)[number];

type Rgba = readonly [number, number, number, number];

const OUT: Rgba = [27, 31, 42, 255];
const WHITE: Rgba = [255, 255, 255, 255];
const RED: Rgba = [235, 70, 80, 255];
const RED_DARK: Rgba = [170, 40, 55, 255];
const BAG: Rgba = [200, 64, 58, 255];
const BAG_LIGHT: Rgba = [240, 120, 110, 255];
const STRAP: Rgba = [90, 40, 40, 255];
const METAL: Rgba = [150, 160, 180, 255];
const SCREEN: Rgba = [16, 32, 48, 255];
const GREEN: Rgba = [77, 252, 176, 255];
const BODY: Rgba = [201, 211, 230, 255];
const BLUE: Rgba = [90, 150, 230, 255];
const BLUE_DARK: Rgba = [55, 100, 175, 255];
const KIBBLE: Rgba = [170, 110, 60, 255];
const KIBBLE_DARK: Rgba = [120, 70, 35, 255];
const COOKIE: Rgba = [214, 160, 90, 255];
const CHIP: Rgba = [110, 70, 40, 255];
const LEAF: Rgba = [80, 190, 90, 255];
const STEM: Rgba = [110, 75, 45, 255];
const COFFEE: Rgba = [110, 65, 35, 255];
const STEAM: Rgba = [210, 215, 225, 255];
const BUG: Rgba = [160, 90, 220, 255];
const PAPER: Rgba = [246, 244, 236, 255];
const PAPER_SHADE: Rgba = [205, 200, 186, 255];
const INK: Rgba = [110, 130, 170, 255];

export function paintToy(sprite: ToySprite) {
  const size = TOY_CELL;
  const px = new Uint8ClampedArray(size * size * 4);
  const fill = (x: number, y: number, w: number, h: number, c: Rgba): void => {
    for (let j = Math.max(0, y); j < Math.min(size, y + h); j++) {
      for (let i = Math.max(0, x); i < Math.min(size, x + w); i++) {
        const o = (j * size + i) * 4;
        px[o] = c[0];
        px[o + 1] = c[1];
        px[o + 2] = c[2];
        px[o + 3] = c[3];
      }
    }
  };
  const dot = (x: number, y: number, c: Rgba): void => fill(x, y, 1, 1, c);
  const disc = (cx: number, cy: number, r: number, c: Rgba): void => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) dot(x, y, c);
      }
    }
  };
  const bowl = (): void => {
    fill(3, 16, 18, 2, OUT);
    fill(4, 18, 16, 3, OUT);
    fill(6, 21, 12, 3, OUT);
    fill(5, 18, 14, 2, BLUE);
    fill(7, 20, 10, 2, BLUE_DARK);
    fill(5, 18, 2, 1, WHITE);
  };

  switch (sprite) {
    case 'ball':
      disc(12, 16.5, 7.5, OUT);
      disc(12, 16.5, 6.5, RED);
      fill(6, 17, 13, 2, RED_DARK);
      disc(9.5, 13.5, 1.6, WHITE);
      break;
    case 'bag':
      fill(5, 21, 14, 3, OUT);
      fill(6, 22, 12, 1, METAL);
      fill(11, 19, 2, 2, OUT);
      fill(7, 1, 10, 19, OUT);
      fill(8, 2, 8, 17, BAG);
      fill(9, 3, 1, 14, BAG_LIGHT);
      fill(8, 6, 8, 1, STRAP);
      fill(8, 14, 8, 1, STRAP);
      break;
    case 'terminal0':
    case 'terminal1': {
      fill(3, 5, 18, 13, OUT);
      fill(4, 6, 16, 11, SCREEN);
      fill(5, 8, 6, 1, GREEN);
      fill(5, 10, 9, 1, GREEN);
      fill(5, 12, 4, 1, GREEN);
      if (sprite === 'terminal0') fill(10, 12, 2, 1, GREEN);
      else fill(5, 14, 7, 1, GREEN);
      fill(1, 18, 22, 4, OUT);
      fill(2, 19, 20, 2, BODY);
      for (let x = 4; x < 21; x += 3) dot(x, 19, METAL);
      fill(9, 22, 6, 2, OUT);
      break;
    }
    case 'bowl_empty':
      bowl();
      break;
    case 'bowl_full':
      for (let x = 5; x < 19; x += 2) {
        dot(x, 14 + (x % 4 === 1 ? 0 : 1), KIBBLE);
        dot(x + 1, 15, KIBBLE_DARK);
      }
      fill(5, 15, 14, 2, KIBBLE);
      dot(8, 16, KIBBLE_DARK);
      dot(13, 15, KIBBLE_DARK);
      bowl();
      fill(5, 16, 14, 1, KIBBLE);
      break;
    case 'cookie':
      disc(12, 18, 5.5, OUT);
      disc(12, 18, 4.5, COOKIE);
      dot(10, 16, CHIP);
      dot(14, 18, CHIP);
      dot(11, 20, CHIP);
      break;
    case 'apple':
      disc(12, 18, 5.5, OUT);
      disc(12, 18, 4.5, RED);
      dot(10, 16, WHITE);
      fill(12, 10, 1, 3, STEM);
      fill(13, 10, 3, 2, LEAF);
      break;
    case 'coffee':
      fill(7, 14, 10, 10, OUT);
      fill(8, 15, 8, 8, WHITE);
      fill(8, 15, 8, 2, COFFEE);
      fill(17, 16, 3, 5, OUT);
      fill(17, 17, 2, 3, [0, 0, 0, 0]);
      fill(18, 17, 1, 3, [0, 0, 0, 0]);
      fill(17, 17, 1, 3, OUT);
      dot(18, 17, [0, 0, 0, 0]);
      fill(10, 9, 1, 3, STEAM);
      fill(13, 8, 1, 3, STEAM);
      break;
    case 'note': {
      // Boule de papier froissée.
      disc(12, 17.5, 6.5, OUT);
      disc(12, 17.5, 5.5, PAPER);
      fill(8, 16, 4, 1, PAPER_SHADE);
      fill(12, 19, 4, 1, PAPER_SHADE);
      dot(10, 20, PAPER_SHADE);
      dot(14, 14, PAPER_SHADE);
      dot(15, 15, PAPER_SHADE);
      fill(9, 18, 2, 1, INK);
      dot(13, 16, INK);
      break;
    }
    case 'file':
      // Feuille de document, coin replié.
      fill(6, 6, 12, 18, OUT);
      fill(7, 7, 10, 16, PAPER);
      fill(14, 6, 4, 4, [0, 0, 0, 0]);
      fill(14, 7, 1, 3, OUT);
      fill(14, 9, 3, 1, OUT);
      fill(15, 7, 1, 2, PAPER_SHADE);
      fill(17, 10, 1, 1, OUT);
      for (let y = 12; y < 21; y += 2) fill(9, y, y === 20 ? 4 : 7, 1, INK);
      break;
    case 'bug0':
    case 'bug1': {
      const s = sprite === 'bug1' ? 1 : 0;
      fill(8, 17, 9, 5, OUT);
      fill(9, 18, 7, 3, BUG);
      dot(15, 18, WHITE);
      dot(17, 16, OUT);
      dot(18, 15, OUT);
      for (let i = 0; i < 3; i++) dot(9 + i * 3 + s, 22, OUT);
      dot(11, 18, [200, 140, 245, 255]);
      break;
    }
  }
  return px;
}
