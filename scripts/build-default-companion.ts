/**
 * Génère le pack du compagnon par défaut « Byte » dans public/companions/default/ :
 *   - spritesheet.png  (une ligne par animation, cases de 32×32)
 *   - animations.json  (rows / frameCount / fps / loop / events, cohérents par construction)
 * Le manifest.json est maintenu à la main dans le même dossier.
 *
 * Usage : npm run companion   (Node ≥ 23.6, types TypeScript supprimés nativement)
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodePng } from './lib/png.ts';
import { FRAME, paintFrame, type FrameSpec } from './lib/robotPainter.ts';

interface AnimEvent {
  frame: number;
  type: 'sound' | 'particle' | 'hit' | 'footstep' | 'emote' | 'custom';
  id?: string;
  anchor?: string;
}

interface AnimSource {
  fps: number;
  loop: boolean;
  next?: string;
  frameDurations?: number[];
  events?: AnimEvent[];
  frames: FrameSpec[];
}

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/companions/default');

// L'ordre des clés fixe l'ordre des lignes dans la planche.
const ANIMATIONS: Record<string, AnimSource> = {
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
  climb: {
    fps: 8,
    loop: true,
    frames: [
      { armL: 'up', armR: 'out', legs: 'stepA', look: 1 },
      { armL: 'up', armR: 'up', legs: 'stand', look: 1, bob: -1 },
      { armL: 'out', armR: 'up', legs: 'stepB', look: 1 },
      { armL: 'up', armR: 'up', legs: 'stand', look: 1, bob: -1 },
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
};

const names = Object.keys(ANIMATIONS);
const columns = Math.max(...Object.values(ANIMATIONS).map((a) => a.frames.length));
const width = columns * FRAME;
const height = names.length * FRAME;
const sheet = new Uint8Array(width * height * 4);

const animations: Record<string, Omit<AnimSource, 'frames'> & { row: number; frameCount: number }> = {};

names.forEach((name, row) => {
  const src = ANIMATIONS[name]!;
  if (src.frameDurations && src.frameDurations.length !== src.frames.length) {
    throw new Error(`${name} : frameDurations doit contenir ${src.frames.length} valeurs`);
  }
  src.frames.forEach((spec, col) => {
    const frame = paintFrame(spec);
    for (let y = 0; y < FRAME; y++) {
      const from = y * FRAME * 4;
      const to = ((row * FRAME + y) * width + col * FRAME) * 4;
      sheet.set(frame.subarray(from, from + FRAME * 4), to);
    }
  });
  const { frames, ...rest } = src;
  animations[name] = { row, frameCount: frames.length, ...rest };
});

writeFileSync(resolve(OUT_DIR, 'spritesheet.png'), encodePng(sheet, width, height));
writeFileSync(
  resolve(OUT_DIR, 'animations.json'),
  `${JSON.stringify({ $schema: '../../../schemas/companion-animations.schema.json', formatVersion: 1, animations }, null, 2)}\n`,
);
console.log(`Planche ${width}×${height} (${names.length} animations) écrite dans ${OUT_DIR}`);
