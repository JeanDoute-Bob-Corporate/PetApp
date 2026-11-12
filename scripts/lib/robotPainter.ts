/**
 * Robot pixel-art « Byte », dessiné procéduralement en RGBA brut (32×32).
 *
 * Module pur (aucun import, syntaxe TypeScript effaçable) exécuté directement par Node.
 * Chaque frame est décrite par un `FrameSpec` : posture des bras/jambes, expression,
 * décalages, accessoires. Le sprite est dessiné de face, regard tourné vers la droite.
 */

export const FRAME = 32;

export type Eyes = 'open' | 'blink' | 'closed' | 'happy' | 'squint' | 'wide' | 'sad' | 'dead';
export type Mouth = 'flat' | 'smile' | 'o' | 'frown' | 'none';
export type Arm = 'down' | 'up' | 'out' | 'back' | 'forward';
export type Legs = 'stand' | 'stepA' | 'stepB' | 'crouch' | 'tuck' | 'sit' | 'dangle0' | 'dangle1' | 'spread';
export type Prop = 'none' | 'cookie' | 'bite' | 'ball';

export interface FrameSpec {
  /** Décalage vertical du haut du corps (respiration, accroupi, assis). */
  bob?: number;
  /** Décalage horizontal du haut du corps (course, coups). */
  lean?: number;
  eyes?: Eyes;
  /** Direction du regard : -1 gauche, 0 face, 1 droite. */
  look?: number;
  mouth?: Mouth;
  armL?: Arm;
  armR?: Arm;
  legs?: Legs;
  /** Décalage horizontal de l'ampoule de l'antenne. */
  antenna?: number;
  hurt?: boolean;
  prop?: Prop;
  propX?: number;
  propY?: number;
  /** Petit « z » de sommeil : 0 aucun, 1 bas, 2 haut. */
  zzz?: number;
}

type Rgba = readonly [number, number, number, number];

const OUTLINE: Rgba = [27, 31, 42, 255];
const BODY: Rgba = [201, 211, 230, 255];
const SHADE: Rgba = [142, 155, 181, 255];
const SCREEN: Rgba = [16, 32, 48, 255];
const GLARE: Rgba = [52, 84, 112, 255];
const EYE: Rgba = [77, 252, 176, 255];
const ACCENT: Rgba = [255, 107, 107, 255];
const LIGHT: Rgba = [255, 255, 255, 255];
const COOKIE: Rgba = [214, 160, 90, 255];
const CHIP: Rgba = [110, 70, 40, 255];
const ZZZ: Rgba = [120, 170, 255, 255];
const HURT_BODY: Rgba = [255, 168, 168, 255];
const HURT_SHADE: Rgba = [214, 110, 110, 255];

export function paintFrame(spec: FrameSpec) {
  const size = FRAME;
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

  const bob = spec.bob ?? 0;
  const lean = spec.lean ?? 0;
  const look = spec.look ?? 0;
  const armL = spec.armL ?? 'down';
  const armR = spec.armR ?? 'down';

  // --- Jambes (ne suivent ni la respiration ni l'inclinaison) ---------------------
  const leg = (x: number, y: number, h: number): void => {
    fill(x, y, 4, h, OUTLINE);
    if (h > 2) fill(x + 1, y, 2, h - 1, SHADE);
  };
  switch (spec.legs ?? 'stand') {
    case 'stand':
      leg(11, 27, 3); leg(17, 27, 3);
      fill(10, 30, 5, 2, OUTLINE); fill(17, 30, 5, 2, OUTLINE);
      break;
    case 'stepA':
      leg(11, 26, 3); fill(9, 29, 5, 2, OUTLINE);
      leg(18, 27, 3); fill(18, 30, 5, 2, OUTLINE);
      break;
    case 'stepB':
      leg(10, 27, 3); fill(9, 30, 5, 2, OUTLINE);
      leg(17, 26, 3); fill(18, 29, 5, 2, OUTLINE);
      break;
    case 'crouch':
      fill(11, 28, 4, 2, OUTLINE); fill(17, 28, 4, 2, OUTLINE);
      fill(9, 30, 6, 2, OUTLINE); fill(17, 30, 6, 2, OUTLINE);
      break;
    case 'tuck':
      fill(11, 26, 4, 2, OUTLINE); fill(17, 26, 4, 2, OUTLINE);
      fill(10, 28, 5, 2, OUTLINE); fill(17, 28, 5, 2, OUTLINE);
      break;
    case 'sit':
      fill(10, 29, 5, 3, OUTLINE); fill(11, 30, 3, 1, SHADE);
      fill(17, 29, 5, 3, OUTLINE); fill(18, 30, 3, 1, SHADE);
      break;
    case 'dangle0':
    case 'dangle1': {
      const s = spec.legs === 'dangle1' ? 1 : 0;
      leg(11 - s, 27, 3); leg(17 + s, 27, 3);
      fill(10 - s, 30, 5, 2, OUTLINE); fill(17 + s, 30, 5, 2, OUTLINE);
      break;
    }
    case 'spread':
      leg(10, 27, 3); fill(8, 30, 5, 2, OUTLINE);
      leg(18, 27, 3); fill(19, 30, 5, 2, OUTLINE);
      break;
  }

  // --- Haut du corps ---------------------------------------------------------------
  const ux = (x: number): number => x + lean;
  const uy = (y: number): number => y + bob;

  // Corps.
  fill(ux(9), uy(20), 14, 7, OUTLINE);
  fill(ux(10), uy(21), 12, 5, BODY);
  fill(ux(10), uy(25), 12, 1, SHADE);
  fill(ux(15), uy(22), 2, 2, ACCENT);
  dot(ux(15), uy(22), LIGHT);

  // Bras : coordonnées du bras droit, le gauche est obtenu par symétrie.
  const arm = (kind: Arm, side: 1 | -1): void => {
    const rects: Array<[number, number, number, number, Rgba]> = [];
    switch (kind) {
      case 'down':
        rects.push([23, 21, 3, 5, OUTLINE], [24, 22, 1, 3, BODY]);
        break;
      case 'back':
        rects.push([23, 19, 3, 5, OUTLINE], [24, 20, 1, 3, BODY]);
        break;
      case 'up':
        rects.push([26, 13, 3, 8, OUTLINE], [27, 14, 1, 6, BODY]);
        break;
      case 'out':
        rects.push([24, 20, 7, 3, OUTLINE], [25, 21, 5, 1, BODY]);
        break;
      case 'forward':
        rects.push([24, 21, 6, 3, OUTLINE], [25, 22, 4, 1, BODY], [29, 20, 3, 5, OUTLINE], [30, 21, 1, 3, BODY]);
        break;
    }
    for (const [x, y, w, h, c] of rects) {
      const rx = side === 1 ? x : FRAME - x - w;
      fill(ux(rx), uy(y), w, h, c);
    }
  };
  arm(armL, -1);
  arm(armR, 1);

  // Boulons latéraux (cachés par un bras levé).
  if (armL !== 'up') fill(ux(4), uy(11), 2, 4, OUTLINE);
  if (armR !== 'up') fill(ux(26), uy(11), 2, 4, OUTLINE);

  // Tête et écran.
  fill(ux(6), uy(6), 20, 14, OUTLINE);
  fill(ux(7), uy(7), 18, 12, BODY);
  fill(ux(7), uy(17), 18, 2, SHADE);
  fill(ux(8), uy(8), 2, 1, LIGHT);
  fill(ux(9), uy(9), 14, 7, SCREEN);
  dot(ux(10), uy(10), GLARE);

  // Yeux (L à x=12, R à x=18, ligne de base y=11).
  const ex = (x: number): number => ux(x) + look;
  const ey = (y: number): number => uy(y);
  const pair = (draw: (x: number) => void): void => {
    draw(12);
    draw(18);
  };
  switch (spec.eyes ?? 'open') {
    case 'open':
      pair((x) => fill(ex(x), ey(11), 2, 2, EYE));
      break;
    case 'blink':
      pair((x) => fill(ex(x), ey(12), 2, 1, EYE));
      break;
    case 'closed':
      pair((x) => fill(ex(x), ey(13), 2, 1, EYE));
      break;
    case 'wide':
      pair((x) => fill(ex(x), ey(10), 2, 3, EYE));
      break;
    case 'happy':
      pair((x) => {
        dot(ex(x) - 1, ey(12), EYE);
        dot(ex(x), ey(11), EYE);
        dot(ex(x) + 1, ey(11), EYE);
        dot(ex(x) + 2, ey(12), EYE);
      });
      break;
    case 'squint':
      dot(ex(12), ey(11), EYE); dot(ex(13), ey(12), EYE); dot(ex(12), ey(13), EYE);
      dot(ex(19), ey(11), EYE); dot(ex(18), ey(12), EYE); dot(ex(19), ey(13), EYE);
      break;
    case 'sad':
      fill(ex(12), ey(12), 2, 1, EYE); dot(ex(13), ey(11), EYE);
      fill(ex(18), ey(12), 2, 1, EYE); dot(ex(18), ey(11), EYE);
      break;
    case 'dead':
      pair((x) => {
        dot(ex(x) - 1, ey(10), EYE); dot(ex(x) + 1, ey(10), EYE);
        dot(ex(x), ey(11), EYE);
        dot(ex(x) - 1, ey(12), EYE); dot(ex(x) + 1, ey(12), EYE);
      });
      break;
  }

  // Bouche.
  switch (spec.mouth ?? 'flat') {
    case 'flat':
      fill(ex(14), ey(14), 4, 1, EYE);
      break;
    case 'smile':
      fill(ex(14), ey(14), 4, 1, EYE); dot(ex(13), ey(13), EYE); dot(ex(18), ey(13), EYE);
      break;
    case 'frown':
      fill(ex(14), ey(13), 4, 1, EYE); dot(ex(13), ey(14), EYE); dot(ex(18), ey(14), EYE);
      break;
    case 'o':
      fill(ex(15), ey(13), 2, 2, EYE);
      break;
    case 'none':
      break;
  }

  // Antenne.
  const tip = spec.antenna ?? 0;
  fill(ux(15), uy(3), 2, 3, OUTLINE);
  fill(ux(14) + tip, uy(0), 4, 3, OUTLINE);
  fill(ux(15) + tip, uy(1), 2, 1, ACCENT);

  // Accessoires (devant tout le reste).
  const propX = spec.propX ?? 25;
  const propY = spec.propY ?? 16;
  switch (spec.prop ?? 'none') {
    case 'cookie':
      fill(propX, propY, 5, 5, OUTLINE); fill(propX + 1, propY + 1, 3, 3, COOKIE); dot(propX + 2, propY + 2, CHIP);
      break;
    case 'bite':
      fill(propX, propY + 1, 4, 4, OUTLINE); fill(propX + 1, propY + 2, 2, 2, COOKIE);
      break;
    case 'ball':
      fill(propX + 1, propY, 3, 1, OUTLINE);
      fill(propX, propY + 1, 5, 3, OUTLINE);
      fill(propX + 1, propY + 4, 3, 1, OUTLINE);
      fill(propX + 1, propY + 1, 3, 3, ACCENT);
      dot(propX + 1, propY + 1, LIGHT);
      break;
    case 'none':
      break;
  }

  if (spec.zzz) {
    const zy = spec.zzz === 2 ? 1 : 4;
    fill(27, zy, 3, 1, ZZZ); dot(28, zy + 1, ZZZ); fill(27, zy + 2, 3, 1, ZZZ);
  }

  if (spec.hurt) {
    for (let o = 0; o < px.length; o += 4) {
      const r = px[o], g = px[o + 1], b = px[o + 2];
      const swap = r === BODY[0] && g === BODY[1] && b === BODY[2] ? HURT_BODY
        : r === SHADE[0] && g === SHADE[1] && b === SHADE[2] ? HURT_SHADE : null;
      if (swap) {
        px[o] = swap[0];
        px[o + 1] = swap[1];
        px[o + 2] = swap[2];
      }
    }
  }

  return px;
}
