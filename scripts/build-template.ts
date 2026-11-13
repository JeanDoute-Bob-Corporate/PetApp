/**
 * Génère examples/template/ : un pack de départ à copier et à redessiner.
 *   - manifest.json    : champs commentés dans docs/GUIDE_PACK_COMPANION.md ;
 *   - animations.json  : la même disposition que Byte (38 lignes) ;
 *   - spritesheet.png  : gabarit — chaque case utilisée est grisée, avec la hitbox
 *     (cadre rouge), le point « pieds » (vert) et la bulle (bleu). Les cases vides ne
 *     servent à rien.
 *
 * Le dossier est un pack valide tel quel : `npm run pack -- examples/template`.
 * Usage : npm run template
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './lib/png.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'examples/template');
mkdirSync(OUT, { recursive: true });

const FW = 32;
const FH = 32;
const source = JSON.parse(readFileSync(resolve(ROOT, 'public/companions/default/animations.json'), 'utf8')) as {
  animations: Record<string, { row: number; startColumn?: number; frameCount: number }>;
};
const anims = source.animations;
const rows = Math.max(...Object.values(anims).map((a) => a.row)) + 1;
const cols = Math.max(...Object.values(anims).map((a) => (a.startColumn ?? 0) + a.frameCount));

const manifest = {
  formatVersion: 1,
  id: 'dev.monpseudo.moncompagnon',
  name: 'Mon compagnon',
  author: 'Mon pseudo',
  version: '1.0.0',
  description: 'Une phrase qui présente le compagnon.',
  license: 'CC-BY-4.0',
  accentColor: '#ffb347',
  tags: ['exemple'],
  sprite: { file: 'spritesheet.png', frameWidth: FW, frameHeight: FH, scale: 3, facing: 'right' },
  hitbox: { x: 6, y: 4, width: 20, height: 28 },
  anchorPoints: {
    feet: { x: 16, y: 32 },
    bubble: { x: 16, y: 2 },
    head: { x: 16, y: 10 },
    handLeft: { x: 8, y: 22 },
    handRight: { x: 24, y: 22 },
  },
  baseStats: { strength: 5, agility: 5, endurance: 5, technique: 5 },
  personalityWeights: { playful: 1, lazy: 1, curious: 1, social: 1, brave: 1, glutton: 1, mischievous: 1 },
};

// --- Gabarit de planche ---------------------------------------------------------------
const W = cols * FW;
const H = rows * FH;
const px = new Uint8Array(W * H * 4);
const set = (x: number, y: number, c: readonly number[]): void => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  px.set(c, (y * W + x) * 4);
};
const used = new Set<string>();
for (const a of Object.values(anims)) {
  for (let i = 0; i < a.frameCount; i++) used.add(`${(a.startColumn ?? 0) + i},${a.row}`);
}
for (const key of used) {
  const [cx, cy] = key.split(',').map(Number) as [number, number];
  const ox = cx * FW;
  const oy = cy * FH;
  const tint = cy % 2 === 0 ? [214, 218, 228, 255] : [196, 202, 216, 255];
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) set(ox + x, oy + y, tint);
  // Bord de case
  for (let i = 0; i < FW; i++) {
    set(ox + i, oy, [150, 156, 172, 255]);
    set(ox + i, oy + FH - 1, [150, 156, 172, 255]);
  }
  for (let i = 0; i < FH; i++) {
    set(ox, oy + i, [150, 156, 172, 255]);
    set(ox + FW - 1, oy + i, [150, 156, 172, 255]);
  }
  // Hitbox (rouge)
  const hb = manifest.hitbox;
  for (let i = 0; i < hb.width; i++) {
    set(ox + hb.x + i, oy + hb.y, [235, 80, 90, 255]);
    set(ox + hb.x + i, oy + hb.y + hb.height - 1, [235, 80, 90, 255]);
  }
  for (let i = 0; i < hb.height; i++) {
    set(ox + hb.x, oy + hb.y + i, [235, 80, 90, 255]);
    set(ox + hb.x + hb.width - 1, oy + hb.y + i, [235, 80, 90, 255]);
  }
  // Pieds (vert, sur la dernière ligne) et bulle (bleu)
  const f = manifest.anchorPoints.feet;
  for (let i = -2; i <= 1; i++) set(ox + f.x + i, oy + FH - 2, [40, 190, 110, 255]);
  const b = manifest.anchorPoints.bubble;
  for (let i = -1; i <= 0; i++) for (let j = 0; j < 2; j++) set(ox + b.x + i, oy + b.y + j, [70, 140, 240, 255]);
}

const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
writeFileSync(resolve(OUT, 'manifest.json'), json(manifest));
writeFileSync(resolve(OUT, 'animations.json'), json({ formatVersion: 1, animations: anims }));
writeFileSync(resolve(OUT, 'spritesheet.png'), encodePng(px, W, H));
console.log(`Modèle écrit dans ${OUT} (planche ${W}×${H}, ${cols} colonnes × ${rows} lignes)`);
