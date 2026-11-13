/**
 * Packs .companion d'exemple, pour tester l'importateur :
 *   - examples/byte-sakura.companion  : pack valide (robot rose, plus joueur et plus agile) ;
 *   - examples/pack-invalide.companion : pack volontairement cassé (chaque règle de
 *     validation importante y est enfreinte au moins une fois).
 *
 * Usage : npm run examples
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderSheet, type Palette } from './lib/byteAnimations.ts';
import { createZip } from './lib/zip.ts';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../examples');
mkdirSync(OUT, { recursive: true });
const json = (value: unknown): Uint8Array => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

const SAKURA: Palette = [
  [[201, 211, 230], [250, 196, 214]], // corps
  [[142, 155, 181], [214, 140, 168]], // ombre
  [[77, 252, 176], [255, 236, 120]], // yeux et écran
  [[255, 107, 107], [120, 200, 255]], // accents
  [[16, 32, 48], [60, 24, 48]], // écran
];

const sakura = renderSheet(SAKURA);
const sakuraManifest = {
  formatVersion: 1,
  id: 'dev.exemple.sakura',
  name: 'Sakura',
  author: 'Desktop Companion (exemple)',
  version: '1.0.0',
  description: 'Variante rose de Byte : plus joueuse et plus agile, un peu moins forte.',
  license: 'MIT',
  accentColor: '#ff8fbf',
  sprite: { file: 'spritesheet.png', frameWidth: 32, frameHeight: 32, scale: 3, facing: 'right' },
  hitbox: { x: 3, y: 0, width: 26, height: 32 },
  anchorPoints: {
    feet: { x: 16, y: 32 },
    bubble: { x: 16, y: 0 },
    head: { x: 16, y: 12 },
    handLeft: { x: 7, y: 24 },
    handRight: { x: 25, y: 24 },
  },
  baseStats: { strength: 4, agility: 8, endurance: 5, technique: 6 },
  personalityWeights: { playful: 1.8, lazy: 0.7, curious: 1.2, social: 1.6, brave: 0.8, glutton: 1.1, mischievous: 1.4 },
};
writeFileSync(
  resolve(OUT, 'byte-sakura.companion'),
  createZip([
    { name: 'manifest.json', data: json(sakuraManifest) },
    { name: 'animations.json', data: json({ formatVersion: 1, animations: sakura.animations }) },
    { name: 'spritesheet.png', data: sakura.png },
  ]),
);

// Pack invalide : plusieurs erreurs, que l'importateur doit toutes lister.
const broken = structuredClone(sakura.animations) as Record<string, Record<string, unknown>>;
delete broken['defeat']; // état obligatoire manquant
broken['walk']!['row'] = 99; // ligne hors de la planche
broken['jump']!['next'] = 'voler'; // enchaînement vers une animation inexistante
broken['run']!['events'] = [{ frame: 12, type: 'sound', id: 'boing' }]; // frame et son inconnus
writeFileSync(
  resolve(OUT, 'pack-invalide.companion'),
  createZip([
    {
      name: 'manifest.json',
      data: json({
        ...sakuraManifest,
        id: 'Mon Pack !', // identifiant invalide
        version: '1.0', // pas SemVer
        baseStats: { strength: 99, agility: 8, endurance: 5, technique: 6 }, // hors bornes
        hitbox: { x: 3, y: 0, width: 40, height: 32 }, // déborde de la case
      }),
    },
    { name: 'animations.json', data: json({ formatVersion: 1, animations: broken }) },
    { name: 'spritesheet.png', data: sakura.png },
    { name: '../../evil.json', data: json({}) }, // chemin interdit
  ]),
);
console.log(`Exemples écrits dans ${OUT}`);
