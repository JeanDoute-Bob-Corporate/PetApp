/**
 * Génère src-tauri/icons/app-icon.png (1024×1024) à partir du sprite du robot,
 * agrandi au plus proche voisin. `npm run icons` enchaîne ensuite `tauri icon` qui
 * produit toutes les tailles (.ico, .icns, PNG) attendues par tauri.conf.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodePng } from './lib/png.ts';
import { FRAME, paintFrame } from './lib/robotPainter.ts';

const SCALE = 32;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src-tauri/icons/app-icon.png');

const sprite = paintFrame({ mouth: 'smile' });
const size = FRAME * SCALE;
const out = new Uint8Array(size * size * 4);
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const src = (Math.floor(y / SCALE) * FRAME + Math.floor(x / SCALE)) * 4;
    out.set(sprite.subarray(src, src + 4), (y * size + x) * 4);
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, encodePng(out, size, size));
console.log(`Icône écrite : ${OUT} (${size}×${size})`);
