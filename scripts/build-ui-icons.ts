/**
 * Génère public/ui/icons.png (icônes de l'interface). Avec `--preview <fichier>`,
 * écrit aussi un aperçu agrandi ×8 sur fond sombre pour vérifier le dessin.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paintIconSheet } from './lib/iconArt.ts';
import { encodePng } from './lib/png.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/ui/icons.png');
const { rgba, width, height } = paintIconSheet();
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, encodePng(rgba, width, height));
console.log(`Icônes : ${width / height} écrites dans ${out}`);

const previewAt = process.argv.indexOf('--preview');
if (previewAt > 0 && process.argv[previewAt + 1]) {
  const s = 8;
  const pad = 4;
  const pw = width * s + (width / height + 1) * pad;
  const ph = height * s + pad * 2;
  const p = new Uint8Array(pw * ph * 4);
  for (let i = 0; i < pw * ph; i++) p.set([20, 30, 34, 255], i * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (rgba[o + 3] === 0) continue;
      const cell = Math.floor(x / height);
      for (let j = 0; j < s; j++) {
        for (let i = 0; i < s; i++) {
          const px = pad + cell * pad + x * s + i;
          const py = pad + y * s + j;
          p.set(rgba.subarray(o, o + 4), (py * pw + px) * 4);
        }
      }
    }
  }
  writeFileSync(process.argv[previewAt + 1]!, encodePng(p, pw, ph));
}
