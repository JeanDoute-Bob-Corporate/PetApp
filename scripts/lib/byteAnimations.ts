/**
 * Table des animations du robot « Byte » et rendu d'une planche complète.
 * Partagée par le pack par défaut et les packs d'exemple (recolorés).
 */
import { encodePng } from './png.ts';
import { FRAME, paintFrame, type FrameSpec } from './robotPainter.ts';

export interface AnimEvent {
  frame: number;
  type: 'sound' | 'particle' | 'hit' | 'footstep' | 'emote' | 'custom';
  id?: string;
  anchor?: string;
}

export interface AnimSource {
  fps: number;
  loop: boolean;
  next?: string;
  frameDurations?: number[];
  events?: AnimEvent[];
  frames: FrameSpec[];
}

// L'ordre des clés fixe l'ordre des lignes dans la planche.
export const ANIMATIONS: Record<string, AnimSource> = {
  idle: {
    fps: 4,
    loop: true,
    // Respiration lente puis un clignement bref : un cycle de 3,5 s.
    frameDurations: [450, 450, 450, 450, 1500, 120],
    frames: [{}, { bob: 1 }, {}, { bob: 1 }, {}, { eyes: 'blink' }],
  },
  walk: {
    fps: 8,
    loop: true,
    events: [{ frame: 0, type: 'footstep' }, { frame: 2, type: 'footstep' }],
    frames: [
      { legs: 'stepA', look: 1, armL: 'back' },
      { legs: 'stand', look: 1, bob: 1 },
      { legs: 'stepB', look: 1, armR: 'back' },
      { legs: 'stand', look: 1, bob: 1 },
    ],
  },
  run: {
    fps: 12,
    loop: true,
    events: [{ frame: 0, type: 'footstep' }, { frame: 2, type: 'footstep' }],
    frames: [
      { legs: 'stepA', lean: 1, look: 1, mouth: 'o', armL: 'out', armR: 'back' },
      { legs: 'tuck', lean: 1, look: 1, mouth: 'o', bob: -1 },
      { legs: 'stepB', lean: 1, look: 1, mouth: 'o', armL: 'back', armR: 'out' },
      { legs: 'tuck', lean: 1, look: 1, mouth: 'o', bob: -1 },
    ],
  },
  jump: {
    fps: 12,
    loop: false,
    next: 'fall',
    frames: [
      { legs: 'crouch', bob: 2, armL: 'back', armR: 'back', eyes: 'squint', mouth: 'flat' },
      { legs: 'stand', bob: -1, armL: 'up', armR: 'up', mouth: 'o' },
      { legs: 'tuck', armL: 'up', armR: 'up', mouth: 'smile', antenna: -1 },
      { legs: 'tuck', armL: 'out', armR: 'out', mouth: 'smile' },
    ],
  },
  fall: {
    fps: 8,
    loop: true,
    frames: [
      { legs: 'dangle0', armL: 'up', armR: 'up', eyes: 'wide', mouth: 'o', antenna: 1 },
      { legs: 'dangle1', armL: 'up', armR: 'up', eyes: 'wide', mouth: 'o', antenna: -1 },
    ],
  },
  // Escalade vue de profil, agrippé à un mur à droite (le moteur retourne le sprite
  // pour un mur à gauche) : main après main, jambes en opposition.
  climb: {
    fps: 6,
    loop: true,
    frames: [
      { side: { frontArm: 'high', backArm: 'low', frontLeg: 'down', backLeg: 'up' } },
      { side: { frontArm: 'high', backArm: 'low', frontLeg: 'down', backLeg: 'up' }, bob: -1 },
      { side: { frontArm: 'low', backArm: 'high', frontLeg: 'up', backLeg: 'down' } },
      { side: { frontArm: 'low', backArm: 'high', frontLeg: 'up', backLeg: 'down' }, bob: -1 },
    ],
  },
  sit_window: {
    fps: 3,
    loop: true,
    frameDurations: [800, 800, 600, 120],
    frames: [
      { legs: 'sit', bob: 3, mouth: 'smile' },
      { legs: 'sit', bob: 3, mouth: 'smile', look: 1 },
      { legs: 'sit', bob: 3, mouth: 'smile', look: -1 },
      { legs: 'sit', bob: 3, mouth: 'smile', eyes: 'blink' },
    ],
  },
  grab_edge: {
    fps: 6,
    loop: true,
    frames: [
      { armL: 'up', armR: 'up', legs: 'dangle0', eyes: 'wide', mouth: 'frown' },
      { armL: 'up', armR: 'up', legs: 'dangle1', eyes: 'wide', mouth: 'frown' },
      { armL: 'up', armR: 'up', legs: 'dangle0', eyes: 'squint', mouth: 'frown' },
    ],
  },
  sleep: {
    fps: 2,
    loop: true,
    events: [{ frame: 0, type: 'particle', id: 'zzz', anchor: 'head' }],
    frames: [
      { legs: 'sit', bob: 3, eyes: 'closed', mouth: 'none' },
      { legs: 'sit', bob: 4, eyes: 'closed', mouth: 'none', zzz: 1 },
      { legs: 'sit', bob: 4, eyes: 'closed', mouth: 'o', zzz: 2 },
      { legs: 'sit', bob: 3, eyes: 'closed', mouth: 'none' },
    ],
  },
  eat: {
    fps: 6,
    loop: false,
    next: 'idle',
    frames: [
      { armR: 'up', prop: 'cookie', propX: 25, propY: 9, eyes: 'happy', mouth: 'o' },
      { armR: 'back', prop: 'cookie', propX: 20, propY: 13, mouth: 'o' },
      { armR: 'back', prop: 'bite', propX: 20, propY: 13, eyes: 'happy', mouth: 'flat' },
      { eyes: 'happy', mouth: 'smile' },
    ],
  },
  play: {
    fps: 10,
    loop: true,
    frames: [
      { armL: 'out', armR: 'down', prop: 'ball', propX: 1, propY: 15, eyes: 'happy', mouth: 'smile', look: -1 },
      { armL: 'up', prop: 'ball', propX: 4, propY: 7, eyes: 'happy', mouth: 'o', look: -1 },
      { armL: 'up', armR: 'up', prop: 'ball', propX: 13, propY: 1, eyes: 'happy', mouth: 'o' },
      { armR: 'up', prop: 'ball', propX: 23, propY: 7, eyes: 'happy', mouth: 'o', look: 1 },
      { armL: 'down', armR: 'out', prop: 'ball', propX: 26, propY: 15, eyes: 'happy', mouth: 'smile', look: 1 },
      { armL: 'out', armR: 'out', prop: 'ball', propX: 13, propY: 22, eyes: 'open', mouth: 'smile' },
    ],
  },
  train: {
    fps: 12,
    loop: true,
    events: [{ frame: 3, type: 'particle', id: 'impact', anchor: 'handRight' }],
    frames: [
      { legs: 'spread', look: 1, mouth: 'flat' },
      { legs: 'spread', armR: 'back', look: 1, eyes: 'squint', mouth: 'flat', lean: -1 },
      { legs: 'spread', armR: 'forward', look: 1, eyes: 'squint', mouth: 'o', lean: 1 },
      { legs: 'spread', armR: 'forward', look: 1, eyes: 'squint', mouth: 'o', lean: 1 },
      { legs: 'spread', armL: 'back', look: 1, mouth: 'flat' },
      { legs: 'spread', armL: 'back', armR: 'back', look: 1, mouth: 'smile', bob: 1 },
    ],
  },
  dragged: {
    fps: 10,
    loop: true,
    frames: [
      { legs: 'dangle0', armL: 'up', armR: 'up', eyes: 'squint', mouth: 'o' },
      { legs: 'dangle1', armL: 'up', armR: 'up', eyes: 'squint', mouth: 'o', antenna: 1 },
      { legs: 'dangle0', armL: 'up', armR: 'up', eyes: 'squint', mouth: 'o' },
      { legs: 'dangle1', armL: 'up', armR: 'up', eyes: 'squint', mouth: 'o', antenna: -1 },
    ],
  },
  attack_light: {
    fps: 14,
    loop: false,
    next: 'idle',
    events: [{ frame: 2, type: 'hit' }],
    frames: [
      { armR: 'back', look: 1, eyes: 'squint', lean: -1 },
      { armR: 'forward', look: 1, eyes: 'squint', mouth: 'o' },
      { armR: 'forward', look: 1, eyes: 'squint', mouth: 'o', lean: 1 },
      { look: 1 },
    ],
  },
  attack_heavy: {
    fps: 12,
    loop: false,
    next: 'idle',
    frameDurations: [120, 80, 80, 60, 140, 120],
    events: [
      { frame: 4, type: 'hit' },
      { frame: 4, type: 'particle', id: 'impact', anchor: 'handRight' },
    ],
    frames: [
      { legs: 'crouch', bob: 2, armR: 'back', armL: 'back', look: 1, eyes: 'squint' },
      { legs: 'crouch', bob: 2, armR: 'back', look: 1, eyes: 'squint', lean: -1 },
      { legs: 'spread', armR: 'back', look: 1, eyes: 'squint', lean: -1, mouth: 'o' },
      { legs: 'spread', armR: 'forward', look: 1, eyes: 'squint', lean: 1, mouth: 'o' },
      { legs: 'spread', armR: 'forward', armL: 'back', look: 1, eyes: 'squint', lean: 2, mouth: 'o' },
      { legs: 'stand', look: 1, mouth: 'flat' },
    ],
  },
  hurt: {
    fps: 10,
    loop: false,
    next: 'idle',
    frames: [
      { hurt: true, eyes: 'wide', mouth: 'o', lean: -1, armL: 'out', armR: 'out' },
      { hurt: true, eyes: 'squint', mouth: 'frown', lean: -1 },
      { eyes: 'sad', mouth: 'frown' },
    ],
  },
  victory: {
    fps: 8,
    loop: true,
    events: [{ frame: 2, type: 'emote', id: 'star' }],
    frames: [
      { legs: 'spread', armL: 'up', armR: 'up', eyes: 'happy', mouth: 'smile' },
      { legs: 'tuck', bob: -1, armL: 'up', armR: 'up', eyes: 'happy', mouth: 'o', antenna: 1 },
      { legs: 'spread', armL: 'up', armR: 'up', eyes: 'happy', mouth: 'smile' },
      { legs: 'spread', armL: 'up', armR: 'out', eyes: 'happy', mouth: 'smile', look: 1 },
      { legs: 'tuck', bob: -1, armL: 'up', armR: 'up', eyes: 'happy', mouth: 'o', antenna: -1 },
      { legs: 'spread', armL: 'out', armR: 'up', eyes: 'happy', mouth: 'smile', look: -1 },
    ],
  },
  defeat: {
    fps: 6,
    loop: false,
    frames: [
      { eyes: 'sad', mouth: 'frown', lean: -1 },
      { eyes: 'sad', mouth: 'frown', bob: 1 },
      { eyes: 'dead', mouth: 'frown', bob: 2, armL: 'out', armR: 'out' },
      { eyes: 'dead', mouth: 'none', bob: 3, legs: 'sit', armL: 'out', armR: 'out' },
    ],
  },

  // --- États optionnels (micro-animations de l'étape 3) ----------------------------
  // Pause agrippé au mur (il regarde autour de lui, cligne des yeux).
  wall_hang: {
    fps: 2,
    loop: true,
    frameDurations: [900, 900, 140],
    frames: [
      { side: { frontArm: 'high', backArm: 'high', frontLeg: 'up', backLeg: 'down' } },
      { side: { frontArm: 'high', backArm: 'high', frontLeg: 'up', backLeg: 'down' }, bob: 1 },
      { side: { frontArm: 'high', backArm: 'high', frontLeg: 'up', backLeg: 'down' }, bob: 1, eyes: 'blink' },
    ],
  },
  // Suspendu au plafond façon Tarzan : une main après l'autre, les jambes balancent.
  hang_ceiling: {
    fps: 5,
    loop: true,
    frames: [
      { armL: 'reach', armR: 'up', bob: 3, legs: 'dangle0', eyes: 'happy', mouth: 'smile', antenna: -1 },
      { armL: 'reach', armR: 'reach', bob: 3, legs: 'dangle1', eyes: 'happy', mouth: 'o' },
      { armL: 'up', armR: 'reach', bob: 3, legs: 'dangle0', eyes: 'happy', mouth: 'smile', antenna: 1 },
      { armL: 'reach', armR: 'reach', bob: 3, legs: 'dangle1', eyes: 'happy', mouth: 'o' },
    ],
  },
  // Secoué trop fort : tournis puis vomi.
  dizzy: {
    fps: 4,
    loop: true,
    frames: [
      { eyes: 'spiral', mouth: 'wavy', sick: true, lean: -1, antenna: 1 },
      { eyes: 'spiral', mouth: 'wavy', sick: true, lean: 1, antenna: -1, bob: 1 },
    ],
  },
  vomit: {
    fps: 4,
    loop: false,
    next: 'idle',
    frameDurations: [350, 250, 600, 700],
    frames: [
      { sick: true, eyes: 'squint', mouth: 'wavy', lean: 1, bob: 1, look: 1 },
      { sick: true, eyes: 'closed', mouth: 'o', lean: 2, bob: 2, look: 1, vomit: 1 },
      { sick: true, eyes: 'closed', mouth: 'o', lean: 2, bob: 2, look: 1, vomit: 2 },
      { sick: true, eyes: 'sad', mouth: 'flat', bob: 1 },
    ],
  },
  // Mécontent : bras croisés, sourcils froncés, il tape du pied.
  grumpy: {
    fps: 4,
    loop: true,
    frames: [
      { armL: 'cross', armR: 'cross', eyes: 'angry', mouth: 'frown', look: -1 },
      { armL: 'cross', armR: 'cross', eyes: 'angry', mouth: 'frown', look: -1, legs: 'stepA' },
      { armL: 'cross', armR: 'cross', eyes: 'angry', mouth: 'frown', look: -1 },
      { armL: 'cross', armR: 'cross', eyes: 'angry', mouth: 'frown', look: -1, legs: 'stepA', antenna: 1 },
    ],
  },
  // Porter un objet (icône, fichier) dans ses bras.
  carry: {
    fps: 8,
    loop: true,
    frames: [
      { armL: 'hold', armR: 'hold', legs: 'stepA', look: 1, mouth: 'smile' },
      { armL: 'hold', armR: 'hold', legs: 'stand', look: 1, bob: 1, mouth: 'smile' },
      { armL: 'hold', armR: 'hold', legs: 'stepB', look: 1, mouth: 'smile' },
      { armL: 'hold', armR: 'hold', legs: 'stand', look: 1, bob: 1, mouth: 'smile' },
    ],
  },
  carry_idle: {
    fps: 2,
    loop: true,
    frames: [
      { armL: 'hold', armR: 'hold', look: 1, mouth: 'smile' },
      { armL: 'hold', armR: 'hold', look: 1, mouth: 'smile', bob: 1 },
    ],
  },
  // Clic sur l'écran avec l'index.
  poke: {
    fps: 6,
    loop: false,
    next: 'idle',
    frameDurations: [220, 140, 320, 200],
    events: [{ frame: 1, type: 'hit' }],
    frames: [
      { armR: 'back', look: 1, eyes: 'squint', mouth: 'smile' },
      { armR: 'point', look: 1, lean: 1, mouth: 'o' },
      { armR: 'point', look: 1, lean: 1, eyes: 'happy', mouth: 'smile' },
      { look: 1, eyes: 'happy', mouth: 'smile' },
    ],
  },
  // Lancer (boule de papier) par-dessus l'épaule.
  throw: {
    fps: 6,
    loop: false,
    next: 'idle',
    frameDurations: [220, 160, 160, 320],
    events: [{ frame: 2, type: 'hit' }],
    frames: [
      { armR: 'back', armL: 'out', lean: -1, look: 1, eyes: 'squint' },
      { armR: 'wave', armL: 'out', lean: -1, look: 1, mouth: 'o' },
      { armR: 'forward', lean: 1, look: 1, mouth: 'o' },
      { look: 1, mouth: 'smile' },
    ],
  },
  // Tire sur le côté d'une fenêtre (penché en arrière, les deux mains agrippées).
  pull: {
    fps: 4,
    loop: true,
    frames: [
      { lean: -2, armR: 'forward', armL: 'hold', legs: 'spread', eyes: 'squint', mouth: 'frown', look: 1 },
      { lean: -1, armR: 'forward', armL: 'hold', legs: 'stepB', eyes: 'squint', mouth: 'o', look: 1 },
    ],
  },
  // Coucou de la main : apparition, et quand il réclame de l'attention.
  wave: {
    fps: 6,
    loop: true,
    frames: [
      { armR: 'wave', eyes: 'happy', mouth: 'smile', look: 1 },
      { armR: 'up', eyes: 'happy', mouth: 'o', look: 1, antenna: 1 },
      { armR: 'wave', eyes: 'happy', mouth: 'smile', look: 1 },
      { armR: 'up', eyes: 'open', mouth: 'smile', look: 1, bob: 1, antenna: -1 },
    ],
  },
  // Absents d'un pack tiers, ils sont remplacés par `idle` sans erreur.
  yawn: {
    fps: 4,
    loop: false,
    next: 'idle',
    frameDurations: [200, 550, 550, 200],
    frames: [
      { eyes: 'blink' },
      { eyes: 'closed', mouth: 'yawn', bob: -1, armL: 'out' },
      { eyes: 'closed', mouth: 'yawn', bob: -1, armL: 'out' },
      { eyes: 'blink', mouth: 'flat' },
    ],
  },
  stretch: {
    fps: 4,
    loop: false,
    next: 'idle',
    frameDurations: [250, 650, 450, 250],
    frames: [
      { armL: 'out', armR: 'out' },
      { armL: 'up', armR: 'up', bob: -1, eyes: 'closed', mouth: 'o' },
      { armL: 'up', armR: 'up', bob: -1, eyes: 'happy', mouth: 'smile' },
      {},
    ],
  },
  look: {
    fps: 3,
    loop: true,
    frames: [{ look: -1 }, { look: -1 }, {}, { look: 1 }, { look: 1, eyes: 'blink' }, {}],
  },
  sulk: {
    fps: 1,
    loop: true,
    frameDurations: [900, 900],
    frames: [
      { eyes: 'sad', mouth: 'frown', look: -1, bob: 1 },
      { eyes: 'sad', mouth: 'frown', look: -1, bob: 2 },
    ],
  },
  push: {
    fps: 4,
    loop: true,
    frames: [
      { lean: 1, armR: 'forward', armL: 'back', legs: 'stepA', eyes: 'squint', mouth: 'frown', look: 1 },
      { lean: 2, armR: 'forward', armL: 'back', legs: 'stepB', eyes: 'squint', mouth: 'o', look: 1 },
    ],
  },
  trip: {
    fps: 6,
    loop: false,
    next: 'idle',
    frameDurations: [120, 160, 550, 300],
    frames: [
      { lean: 1, eyes: 'wide', mouth: 'o', armL: 'out', armR: 'out', legs: 'stepA' },
      { lean: 3, bob: 2, eyes: 'wide', mouth: 'o', armL: 'up', armR: 'up', legs: 'tuck' },
      { legs: 'sit', bob: 3, eyes: 'squint', mouth: 'frown' },
      { eyes: 'sad', mouth: 'flat' },
    ],
  },
  type: {
    fps: 6,
    loop: true,
    frames: [
      { legs: 'sit', bob: 3, armR: 'out', look: 1, mouth: 'flat' },
      { legs: 'sit', bob: 3, armR: 'down', armL: 'out', look: 1, mouth: 'flat' },
      { legs: 'sit', bob: 3, armR: 'out', look: 1, mouth: 'smile' },
      { legs: 'sit', bob: 3, armR: 'down', armL: 'out', look: 1, eyes: 'blink', mouth: 'flat' },
    ],
  },
  pet: {
    fps: 4,
    loop: true,
    frames: [
      { eyes: 'happy', mouth: 'smile', bob: 1, antenna: -1 },
      { eyes: 'happy', mouth: 'smile', antenna: 1 },
    ],
  },
  scared: {
    fps: 6,
    loop: false,
    next: 'idle',
    frameDurations: [150, 250, 500],
    frames: [
      { eyes: 'wide', mouth: 'o', armL: 'up', armR: 'up', legs: 'spread', lean: -1 },
      { eyes: 'wide', mouth: 'o', armL: 'up', armR: 'up', legs: 'tuck', lean: -2, bob: -1 },
      { eyes: 'wide', mouth: 'frown', legs: 'spread', lean: -1 },
    ],
  },
};

/** Recoloration pixel à pixel : [r, g, b] d'origine → [r, g, b] de remplacement. */
export type Palette = Array<[readonly [number, number, number], readonly [number, number, number]]>;

/**
 * Peint toutes les animations sur une planche (une ligne chacune) et produit le
 * contenu d'animations.json correspondant.
 */
export function renderSheet(
  palette: Palette = [],
  painter: (spec: FrameSpec) => Uint8ClampedArray = paintFrame,
): { png: Buffer; animations: Record<string, unknown> } {
  const names = Object.keys(ANIMATIONS);
  const columns = Math.max(...Object.values(ANIMATIONS).map((a) => a.frames.length));
  const width = columns * FRAME;
  const height = names.length * FRAME;
  const sheet = new Uint8Array(width * height * 4);
  const animations: Record<string, unknown> = {};

  names.forEach((name, row) => {
    const src = ANIMATIONS[name]!;
    if (src.frameDurations && src.frameDurations.length !== src.frames.length) {
      throw new Error(`${name} : frameDurations doit contenir ${src.frames.length} valeurs`);
    }
    src.frames.forEach((spec, col) => {
      const frame = painter(spec);
      for (let o = 0; o < frame.length; o += 4) {
        for (const [from, to] of palette) {
          if (frame[o] === from[0] && frame[o + 1] === from[1] && frame[o + 2] === from[2]) {
            frame[o] = to[0];
            frame[o + 1] = to[1];
            frame[o + 2] = to[2];
            break;
          }
        }
      }
      for (let y = 0; y < FRAME; y++) {
        const from = y * FRAME * 4;
        const to = ((row * FRAME + y) * width + col * FRAME) * 4;
        sheet.set(frame.subarray(from, from + FRAME * 4), to);
      }
    });
    const { frames, ...rest } = src;
    animations[name] = { row, frameCount: frames.length, ...rest };
  });
  return { png: encodePng(sheet, width, height), animations };
}
