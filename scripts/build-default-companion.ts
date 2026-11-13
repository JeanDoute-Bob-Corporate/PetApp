/**
 * Génère le pack du compagnon par défaut « Byte » dans public/companions/default/ :
 *   - spritesheet.png  (une ligne par animation, cases de 32×32)
 *   - animations.json  (rows / frameCount / fps / loop / events, cohérents par construction)
 * ainsi que les sprites des jouets dans public/toys/. Le manifest.json est écrit à la main.
 *
 * Usage : npm run companion   (Node ≥ 23.6, types TypeScript supprimés nativement)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderSheet } from './lib/byteAnimations.ts';
import { encodePng } from './lib/png.ts';
import { paintToy, TOY_CELL, TOY_SPRITES } from './lib/toyPainter.ts';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/companions/default');

const { png, animations } = renderSheet();
writeFileSync(resolve(OUT_DIR, 'spritesheet.png'), png);
writeFileSync(
  resolve(OUT_DIR, 'animations.json'),
  `${JSON.stringify({ $schema: '../../../schemas/companion-animations.schema.json', formatVersion: 1, animations }, null, 2)}\n`,
);
console.log(`Planche : ${Object.keys(animations).length} animations écrites dans ${OUT_DIR}`);

// --- Jouets et aliments : une ligne de cases 24×24 + index des sprites ---------------
const TOYS_DIR = resolve(OUT_DIR, '../../toys');
mkdirSync(TOYS_DIR, { recursive: true });
const toyWidth = TOY_SPRITES.length * TOY_CELL;
const toySheet = new Uint8Array(toyWidth * TOY_CELL * 4);
TOY_SPRITES.forEach((sprite, col) => {
  const cell = paintToy(sprite);
  for (let y = 0; y < TOY_CELL; y++) {
    toySheet.set(cell.subarray(y * TOY_CELL * 4, (y + 1) * TOY_CELL * 4), (y * toyWidth + col * TOY_CELL) * 4);
  }
});
writeFileSync(resolve(TOYS_DIR, 'toys.png'), encodePng(toySheet, toyWidth, TOY_CELL));
writeFileSync(
  resolve(TOYS_DIR, 'toys.json'),
  `${JSON.stringify({ cell: TOY_CELL, sprites: Object.fromEntries(TOY_SPRITES.map((s, i) => [s, i])) }, null, 2)}\n`,
);
console.log(`Jouets : ${TOY_SPRITES.length} sprites écrits dans ${TOYS_DIR}`);
