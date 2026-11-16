/**
 * « Braise » : petite créature ronde orange corail, une flammèche sur la tête,
 * dessinée procéduralement en RGBA brut (32×32). Personnage original.
 *
 * Même grammaire de poses que le robot (`FrameSpec` de robotPainter.ts) : toutes les
 * animations de Byte (byteAnimations.ts) s'appliquent telles quelles. Vue de face,
 * regard tourné vers la droite ; vue de profil (`side`) agrippée à un mur à droite.
 */
import { FRAME, type Arm, type FrameSpec, type SidePose } from './robotPainter.ts';

type Rgba = readonly [number, number, number, number];

const OUTLINE: Rgba = [74, 38, 30, 255];
const BODY: Rgba = [240, 128, 92, 255];
const SHADE: Rgba = [204, 92, 62, 255];
const BELLY: Rgba = [255, 214, 186, 255];
const LIGHT: Rgba = [255, 236, 220, 255];
const EYE: Rgba = [44, 24, 22, 255];
const GLINT: Rgba = [255, 255, 255, 255];
const CHEEK: Rgba = [255, 150, 160, 255];
const MOUTH_IN: Rgba = [150, 50, 50, 255];
const FLAME: Rgba = [255, 196, 70, 255];
const FLAME_CORE: Rgba = [255, 240, 160, 255];
const COOKIE: Rgba = [214, 160, 90, 255];
const CHIP: Rgba = [110, 70, 40, 255];
const BALL: Rgba = [90, 170, 255, 255];
const ZZZ: Rgba = [120, 170, 255, 255];
const HURT_BODY: Rgba = [255, 170, 160, 255];
const HURT_SHADE: Rgba = [226, 120, 110, 255];
const SICK_BODY: Rgba = [196, 214, 140, 255];
const SICK_SHADE: Rgba = [150, 172, 100, 255];
const PUKE: Rgba = [140, 200, 70, 255];
const PUKE_DARK: Rgba = [90, 150, 40, 255];

function canvas() {
  const px = new Uint8ClampedArray(FRAME * FRAME * 4);
  const fill = (x: number, y: number, w: number, h: number, c: Rgba): void => {
    for (let j = Math.max(0, y); j < Math.min(FRAME, y + h); j++) {
      for (let i = Math.max(0, x); i < Math.min(FRAME, x + w); i++) {
        const o = (j * FRAME + i) * 4;
        px[o] = c[0];
        px[o + 1] = c[1];
        px[o + 2] = c[2];
        px[o + 3] = c[3];
      }
    }
  };
  const dot = (x: number, y: number, c: Rgba): void => fill(x, y, 1, 1, c);
  return { px, fill, dot };
}

function recolor(px: Uint8ClampedArray, body: Rgba, shade: Rgba): void {
  for (let o = 0; o < px.length; o += 4) {
    const r = px[o], g = px[o + 1], b = px[o + 2];
    const swap = r === BODY[0] && g === BODY[1] && b === BODY[2] ? body : r === SHADE[0] && g === SHADE[1] && b === SHADE[2] ? shade : null;
    if (swap) {
      px[o] = swap[0];
      px[o + 1] = swap[1];
      px[o + 2] = swap[2];
    }
  }
}

/** Flammèche : `sway` la penche à gauche ou à droite. */
function flame(fill: (x: number, y: number, w: number, h: number, c: Rgba) => void, x: number, y: number, sway: number): void {
  fill(x + 1 + sway, y, 2, 1, OUTLINE);
  fill(x + sway, y + 1, 4, 1, OUTLINE);
  fill(x, y + 2, 5, 3, OUTLINE);
  fill(x + 1 + sway, y + 1, 2, 1, FLAME);
  fill(x + 1, y + 2, 3, 2, FLAME);
  fill(x + 2, y + 3, 1, 1, FLAME_CORE);
}

export function paintFrame(spec: FrameSpec) {
  if (spec.side) return paintSide(spec.side, spec.bob ?? 0, spec.eyes === 'blink');
  const { px, fill, dot } = canvas();

  const bob = spec.bob ?? 0;
  const lean = spec.lean ?? 0;
  const look = spec.look ?? 0;

  // --- Pattes (ne suivent ni la respiration ni l'inclinaison) ---------------------
  const leg = (x: number, y: number, h: number): void => {
    fill(x, y, 4, h, OUTLINE);
    if (h > 2) fill(x + 1, y, 2, h - 1, SHADE);
  };
  const foot = (x: number, y: number): void => {
    fill(x, y, 5, 2, OUTLINE);
    fill(x + 1, y, 3, 1, SHADE);
  };
  switch (spec.legs ?? 'stand') {
    case 'stand':
      leg(11, 27, 3); leg(17, 27, 3);
      foot(10, 30); foot(17, 30);
      break;
    case 'stepA':
      leg(11, 26, 3); foot(9, 29);
      leg(18, 27, 3); foot(18, 30);
      break;
    case 'stepB':
      leg(10, 27, 3); foot(9, 30);
      leg(17, 26, 3); foot(18, 29);
      break;
    case 'crouch':
      fill(11, 28, 4, 2, OUTLINE); fill(17, 28, 4, 2, OUTLINE);
      foot(9, 30); foot(18, 30);
      break;
    case 'tuck':
      fill(11, 26, 4, 2, OUTLINE); fill(17, 26, 4, 2, OUTLINE);
      foot(10, 28); foot(17, 28);
      break;
    case 'sit':
      fill(9, 29, 6, 3, OUTLINE); fill(10, 30, 4, 1, SHADE);
      fill(17, 29, 6, 3, OUTLINE); fill(18, 30, 4, 1, SHADE);
      break;
    case 'dangle0':
    case 'dangle1': {
      const s = spec.legs === 'dangle1' ? 1 : 0;
      leg(11 - s, 27, 3); leg(17 + s, 27, 3);
      foot(10 - s, 30); foot(17 + s, 30);
      break;
    }
    case 'spread':
      leg(10, 27, 3); foot(8, 30);
      leg(18, 27, 3); foot(19, 30);
      break;
  }

  const ux = (x: number): number => x + lean;
  const uy = (y: number): number => y + bob;

  // --- Corps rond (tête et corps ne font qu'un) -------------------------------------
  // Silhouette arrondie : rangées [y, x début, largeur].
  const outline: Array<[number, number, number]> = [
    [8, 11, 10], [9, 9, 14], [10, 8, 16], [26, 8, 16], [27, 10, 12],
  ];
  fill(ux(7), uy(11), 18, 15, OUTLINE);
  for (const [y, x, w] of outline) fill(ux(x), uy(y), w, 1, OUTLINE);
  // Intérieur.
  fill(ux(11), uy(9), 10, 1, BODY);
  fill(ux(9), uy(10), 14, 1, BODY);
  fill(ux(8), uy(11), 16, 15, BODY);
  fill(ux(9), uy(26), 14, 1, SHADE);
  fill(ux(8), uy(23), 16, 3, SHADE);
  // Ventre clair.
  fill(ux(12), uy(19), 8, 6, BELLY);
  fill(ux(11), uy(20), 10, 4, BELLY);
  // Reflet.
  fill(ux(10), uy(11), 2, 1, LIGHT);
  dot(ux(9), uy(12), LIGHT);

  // --- Bras : coordonnées du bras droit, le gauche par symétrie -----------------------
  const arm = (kind: Arm, side: 1 | -1): void => {
    const rects: Array<[number, number, number, number, Rgba]> = [];
    switch (kind) {
      case 'down':
        rects.push([23, 18, 3, 6, OUTLINE], [24, 19, 1, 4, BODY]);
        break;
      case 'back':
        rects.push([23, 16, 3, 5, OUTLINE], [24, 17, 1, 3, BODY]);
        break;
      case 'up':
        rects.push([24, 9, 3, 9, OUTLINE], [25, 10, 1, 7, BODY]);
        break;
      case 'out':
        rects.push([23, 17, 8, 3, OUTLINE], [24, 18, 6, 1, BODY]);
        break;
      case 'forward':
        rects.push([23, 18, 7, 3, OUTLINE], [24, 19, 5, 1, BODY], [28, 17, 3, 5, OUTLINE], [29, 18, 1, 3, BODY]);
        break;
      case 'wave':
        rects.push(
          [23, 15, 3, 4, OUTLINE], [25, 11, 3, 5, OUTLINE], [26, 6, 5, 5, OUTLINE],
          [24, 16, 1, 2, BODY], [26, 12, 1, 3, BODY], [27, 7, 3, 3, BODY],
        );
        break;
      case 'hold':
        rects.push([22, 18, 3, 5, OUTLINE], [17, 20, 7, 3, OUTLINE], [23, 19, 1, 3, BODY], [18, 21, 5, 1, BODY]);
        break;
      case 'cross':
        rects.push([22, 18, 3, 4, OUTLINE], [11, 20, 13, 3, OUTLINE], [12, 21, 11, 1, BODY]);
        break;
      case 'point':
        rects.push([23, 18, 3, 4, OUTLINE], [25, 20, 3, 3, OUTLINE], [27, 22, 3, 3, OUTLINE], [29, 24, 3, 3, OUTLINE],
          [24, 19, 1, 2, BODY], [26, 21, 1, 1, BODY], [28, 23, 1, 1, BODY], [30, 25, 1, 1, BODY]);
        break;
      case 'reach':
        rects.push([24, 0, 3, 19, OUTLINE], [25, 1, 1, 17, BODY]);
        break;
    }
    for (const [x, y, w, h, c] of rects) {
      const rx = side === 1 ? x : FRAME - x - w;
      fill(ux(rx), uy(y), w, h, c);
    }
  };
  arm(spec.armL ?? 'down', -1);
  arm(spec.armR ?? 'down', 1);

  // --- Visage -----------------------------------------------------------------------
  const ex = (x: number): number => ux(x) + look;
  const ey = (y: number): number => uy(y);
  const pair = (draw: (x: number) => void): void => {
    draw(11);
    draw(19);
  };
  switch (spec.eyes ?? 'open') {
    case 'open':
      pair((x) => {
        fill(ex(x), ey(13), 2, 3, EYE);
        dot(ex(x), ey(13), GLINT);
      });
      break;
    case 'blink':
      pair((x) => fill(ex(x), ey(15), 2, 1, EYE));
      break;
    case 'closed':
      pair((x) => {
        fill(ex(x), ey(15), 2, 1, EYE);
        dot(ex(x) - 1, ey(14), EYE);
        dot(ex(x) + 2, ey(14), EYE);
      });
      break;
    case 'wide':
      pair((x) => {
        fill(ex(x) - 1, ey(12), 3, 4, EYE);
        dot(ex(x) - 1, ey(12), GLINT);
      });
      break;
    case 'happy':
      pair((x) => {
        dot(ex(x) - 1, ey(15), EYE);
        fill(ex(x), ey(14), 2, 1, EYE);
        dot(ex(x) + 2, ey(15), EYE);
      });
      break;
    case 'squint':
      dot(ex(11), ey(13), EYE); dot(ex(12), ey(14), EYE); dot(ex(11), ey(15), EYE);
      dot(ex(20), ey(13), EYE); dot(ex(19), ey(14), EYE); dot(ex(20), ey(15), EYE);
      break;
    case 'sad':
      pair((x) => fill(ex(x), ey(14), 2, 2, EYE));
      dot(ex(12), ey(12), EYE); dot(ex(19), ey(12), EYE);
      break;
    case 'angry':
      pair((x) => fill(ex(x), ey(14), 2, 2, EYE));
      dot(ex(10), ey(12), EYE); dot(ex(11), ey(12), EYE); dot(ex(12), ey(13), EYE);
      dot(ex(21), ey(12), EYE); dot(ex(20), ey(12), EYE); dot(ex(19), ey(13), EYE);
      break;
    case 'spiral':
      pair((x) => {
        fill(ex(x) - 1, ey(12), 3, 1, EYE);
        dot(ex(x) + 1, ey(13), EYE);
        fill(ex(x) - 1, ey(14), 3, 1, EYE);
        dot(ex(x) - 1, ey(13), EYE);
      });
      break;
    case 'dead':
      pair((x) => {
        dot(ex(x) - 1, ey(12), EYE); dot(ex(x) + 1, ey(12), EYE);
        dot(ex(x), ey(13), EYE);
        dot(ex(x) - 1, ey(14), EYE); dot(ex(x) + 1, ey(14), EYE);
      });
      break;
  }

  // Joues roses.
  if (spec.eyes !== 'dead' && !spec.sick) {
    fill(ex(9), ey(17), 2, 1, CHEEK);
    fill(ex(21), ey(17), 2, 1, CHEEK);
  }

  // Bouche.
  switch (spec.mouth ?? 'flat') {
    case 'flat':
      fill(ex(15), ey(17), 2, 1, EYE);
      break;
    case 'smile':
      fill(ex(15), ey(18), 2, 1, EYE); dot(ex(14), ey(17), EYE); dot(ex(17), ey(17), EYE);
      break;
    case 'frown':
      fill(ex(15), ey(17), 2, 1, EYE); dot(ex(14), ey(18), EYE); dot(ex(17), ey(18), EYE);
      break;
    case 'o':
      fill(ex(15), ey(17), 2, 2, EYE);
      break;
    case 'wavy':
      dot(ex(13), ey(18), EYE); dot(ex(14), ey(17), EYE); dot(ex(15), ey(18), EYE);
      dot(ex(16), ey(17), EYE); dot(ex(17), ey(18), EYE); dot(ex(18), ey(17), EYE);
      break;
    case 'yawn':
      fill(ex(14), ey(16), 4, 4, EYE);
      fill(ex(15), ey(17), 2, 2, MOUTH_IN);
      break;
    case 'none':
      break;
  }

  // Flammèche sur la tête (remplace l'antenne du robot).
  flame(fill, ux(13), uy(3), Math.max(-1, Math.min(1, spec.antenna ?? 0)));

  // --- Accessoires --------------------------------------------------------------------
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
      fill(propX + 1, propY + 1, 3, 3, BALL);
      dot(propX + 1, propY + 1, GLINT);
      break;
    case 'none':
      break;
  }

  if (spec.zzz) {
    const zy = spec.zzz === 2 ? 1 : 4;
    fill(27, zy, 3, 1, ZZZ); dot(28, zy + 1, ZZZ); fill(27, zy + 2, 3, 1, ZZZ);
  }

  if (spec.vomit) {
    fill(ux(20), uy(18), 3, 2, PUKE);
    fill(ux(22), uy(19), 2, 3, PUKE);
    if (spec.vomit > 1) {
      fill(ux(24), uy(20), 2, 4, PUKE);
      fill(26, 24, 2, 5, PUKE);
      fill(24, 29, 7, 2, PUKE);
      fill(25, 30, 5, 1, PUKE_DARK);
      fill(26, 22, 1, 2, PUKE_DARK);
    }
  }

  if (spec.sick) recolor(px, SICK_BODY, SICK_SHADE);
  if (spec.hurt) recolor(px, HURT_BODY, HURT_SHADE);
  return px;
}

/**
 * De profil, tournée vers la droite, mains et pieds contre un mur au bord droit de la
 * case (x = 31). Membres « hauts » et « bas » alternés = grimpe main après main.
 */
function paintSide(pose: SidePose, bob: number, blink: boolean) {
  const { px, fill } = canvas();
  const segment = (x0: number, y0: number, x1: number, y1: number, pass: 'outline' | Rgba): void => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / steps);
      const y = Math.round(y0 + ((y1 - y0) * i) / steps);
      if (pass === 'outline') fill(x - 1, y - 1, 3, 3, OUTLINE);
      else fill(x, y, 1, 1, pass);
    }
  };
  const limb = (joints: Array<[number, number]>, color: Rgba): void => {
    const end = joints[joints.length - 1]!;
    for (let i = 1; i < joints.length; i++) segment(joints[i - 1]![0], joints[i - 1]![1], joints[i]![0], joints[i]![1], 'outline');
    fill(end[0] - 1, end[1] - 2, 4, 4, OUTLINE);
    for (let i = 1; i < joints.length; i++) segment(joints[i - 1]![0], joints[i - 1]![1], joints[i]![0], joints[i]![1], color);
    fill(end[0], end[1] - 1, 2, 2, color);
  };
  void limb;
  /** Petite main ronde qui touche le mur (x = 31). */
  const hand = (high: boolean, color: Rgba): void => {
    const y = (high ? 11 : 17) + bob;
    fill(26, y, 5, 4, OUTLINE);
    fill(27, y - 1, 3, 1, OUTLINE);
    fill(27, y + 1, 3, 2, color);
  };
  /** Petit pied posé contre le mur. */
  const foot = (up: boolean, color: Rgba): void => {
    const y = up ? 24 : 28;
    fill(23, y, 8, 4, OUTLINE);
    fill(24, y + 1, 6, 2, color);
  };

  hand(pose.backArm === 'high', SHADE);
  foot(pose.backLeg === 'up', SHADE);

  // Corps rond de profil, collé au mur.
  fill(12, 9 + bob, 14, 17, OUTLINE);
  fill(14, 8 + bob, 10, 1, OUTLINE);
  fill(14, 26 + bob, 10, 1, OUTLINE);
  fill(13, 10 + bob, 12, 15, BODY);
  fill(15, 9 + bob, 8, 1, BODY);
  fill(13, 22 + bob, 12, 3, SHADE);
  fill(20, 17 + bob, 5, 5, BELLY);
  fill(14, 11 + bob, 2, 1, LIGHT);
  // Œil et joue côté mur.
  if (blink) fill(21, 14 + bob, 2, 1, EYE);
  else {
    fill(21, 12 + bob, 2, 3, EYE);
    fill(21, 12 + bob, 1, 1, GLINT);
  }
  fill(22, 16 + bob, 2, 1, CHEEK);

  flame(fill, 15, 3 + bob, -1);

  hand(pose.frontArm === 'high', BODY);
  foot(pose.frontLeg === 'up', BODY);
  return px;
}
