/**
 * Assemble un dossier en pack .companion et le pré-vérifie.
 *
 *   npm run pack -- <dossier> [fichier-de-sortie.companion]
 *
 * Le dossier contient manifest.json, animations.json, la planche PNG et, en option,
 * un sous-dossier sfx/. Les règles principales de l'importateur sont vérifiées ici
 * (mêmes messages) ; l'application reste l'arbitre final à l'import.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createZip } from './lib/zip.ts';

const REQUIRED = [
  'idle', 'walk', 'run', 'jump', 'fall', 'climb', 'sit_window', 'grab_edge', 'sleep', 'eat', 'play', 'train',
  'dragged', 'attack_light', 'attack_heavy', 'hurt', 'victory', 'defeat',
];
const TRAITS = ['playful', 'lazy', 'curious', 'social', 'brave', 'glutton', 'mischievous'];
const EVENTS = ['sound', 'particle', 'hit', 'footstep', 'emote', 'custom'];
const ALLOWED = ['.json', '.png', '.ogg', '.wav'];

const dir = process.argv[2];
if (!dir) {
  console.error('Usage : npm run pack -- <dossier> [sortie.companion]');
  process.exit(2);
}
const root = resolve(dir);
const out = resolve(process.argv[3] ?? `${root.replace(/[\\/]+$/, '')}.companion`);
const errors: string[] = [];
const warnings: string[] = [];
const err = (e: string): void => void errors.push(e);

// --- Fichiers -------------------------------------------------------------------------
const files = new Map<string, Buffer>();
function collect(sub: string): void {
  for (const name of readdirSync(join(root, sub))) {
    const rel = sub ? `${sub}/${name}` : name;
    const full = join(root, rel);
    if (statSync(full).isDirectory()) {
      collect(rel);
      continue;
    }
    if (name.startsWith('.') || name.toLowerCase() === 'readme.md' || name.toLowerCase().endsWith('.txt')) continue;
    const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
    if (!ALLOWED.includes(ext)) {
      warnings.push(`« ${rel} » ignoré (seuls .json, .png, .ogg, .wav vont dans le pack)`);
      continue;
    }
    files.set(rel, readFileSync(full));
  }
}
if (!existsSync(root)) {
  console.error(`Dossier introuvable : ${root}`);
  process.exit(2);
}
collect('');

const readJson = (name: string): Record<string, any> | null => {
  const data = files.get(name);
  if (!data) {
    err(`${name} manquant à la racine du dossier`);
    return null;
  }
  try {
    return JSON.parse(data.toString('utf8').replace(/^﻿/, '')) as Record<string, any>;
  } catch (e) {
    err(`${name} : JSON invalide (${(e as Error).message})`);
    return null;
  }
};
const m = readJson('manifest.json');
const a = readJson('animations.json');

// --- Manifeste ------------------------------------------------------------------------
const isInt = (v: unknown, min: number, max: number): boolean => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;
let fw = 0;
let fh = 0;
let cols = 0;
let rows = 0;
const sounds: Record<string, string> = (m?.['sounds'] as Record<string, string>) ?? {};
const anchors: Record<string, { x: number; y: number }> = (m?.['anchorPoints'] as Record<string, { x: number; y: number }>) ?? {};

if (m) {
  const known = ['$schema', 'formatVersion', 'id', 'name', 'author', 'version', 'description', 'license', 'minAppVersion', 'tags', 'accentColor', 'sprite', 'hitbox', 'anchorPoints', 'baseStats', 'personalityWeights', 'sounds'];
  for (const k of Object.keys(m)) if (!known.includes(k)) err(`manifest.json : champ inconnu « ${k} »`);
  for (const k of ['formatVersion', 'id', 'name', 'author', 'version', 'sprite', 'hitbox', 'anchorPoints', 'baseStats', 'personalityWeights']) {
    if (!(k in m)) err(`manifest.json : champ obligatoire « ${k} » manquant`);
  }
  if (m['formatVersion'] !== 1) err('manifest.json › formatVersion : attendu 1');
  const id = String(m['id'] ?? '');
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(id) || id.length > 64) err(`manifest.json › id : « ${id} » invalide (ex. « dev.auteur.nom », minuscules)`);
  if (id === 'dev.default.byte') err('manifest.json › id : réservé au compagnon par défaut');
  const name = String(m['name'] ?? '');
  if (!name.trim() || [...name].length > 32) err('manifest.json › name : 1 à 32 caractères');
  const author = String(m['author'] ?? '');
  if (!author.trim() || [...author].length > 64) err('manifest.json › author : 1 à 64 caractères');
  if (!semver.test(String(m['version'] ?? ''))) err(`manifest.json › version : « ${m['version']} » n'est pas au format 1.2.3`);
  if (m['description'] !== undefined && [...String(m['description'])].length > 280) err('manifest.json › description : 280 caractères maximum');
  if (m['accentColor'] !== undefined && !/^#[0-9a-fA-F]{6}$/.test(String(m['accentColor']))) err(`manifest.json › accentColor : « ${m['accentColor']} » doit être une couleur #rrggbb`);

  const s = (m['sprite'] ?? {}) as Record<string, unknown>;
  fw = Number(s['frameWidth']);
  fh = Number(s['frameHeight']);
  const file = String(s['file'] ?? '');
  if (!file.endsWith('.png') || file.includes('/')) err(`manifest.json › sprite.file : « ${file} » doit être un .png à la racine`);
  if (!isInt(fw, 8, 256) || !isInt(fh, 8, 256)) err('manifest.json › sprite.frameWidth/frameHeight : entre 8 et 256 px');
  if (s['scale'] !== undefined && !isInt(s['scale'], 1, 8)) err('manifest.json › sprite.scale : entre 1 et 8');
  if (s['facing'] !== undefined && s['facing'] !== 'left' && s['facing'] !== 'right') err('manifest.json › sprite.facing : « left » ou « right »');

  const h = (m['hitbox'] ?? {}) as Record<string, number>;
  if (!(h['width']! > 0 && h['height']! > 0 && h['x']! >= 0 && h['y']! >= 0 && h['x']! + h['width']! <= fw && h['y']! + h['height']! <= fh)) {
    err(`manifest.json › hitbox : doit tenir dans la case ${fw}×${fh}`);
  }
  for (const req of ['feet', 'bubble']) if (!anchors[req]) err(`manifest.json › anchorPoints.${req} : obligatoire`);
  for (const [n, p] of Object.entries(anchors)) {
    if (!(p.x >= 0 && p.y >= 0 && p.x <= fw && p.y <= fh)) err(`manifest.json › anchorPoints.${n} : (${p.x}, ${p.y}) hors de la case ${fw}×${fh}`);
  }
  const bs = (m['baseStats'] ?? {}) as Record<string, number>;
  for (const k of ['strength', 'agility', 'endurance', 'technique']) {
    if (!isInt(bs[k], 1, 20)) err(`manifest.json › baseStats.${k} : entre 1 et 20 (reçu ${bs[k]})`);
  }
  for (const [k, v] of Object.entries((m['personalityWeights'] ?? {}) as Record<string, number>)) {
    if (!TRAITS.includes(k)) err(`manifest.json › personalityWeights.${k} : trait inconnu`);
    else if (!(v >= 0 && v <= 3)) err(`manifest.json › personalityWeights.${k} : entre 0 et 3`);
  }
  for (const [k, path] of Object.entries(sounds)) {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(k)) err(`manifest.json › sounds.${k} : identifiant invalide (minuscules, chiffres, _)`);
    if (!/^sfx\/.+\.(ogg|wav)$/.test(path)) err(`manifest.json › sounds.${k} : « ${path} » doit être sfx/<nom>.ogg|.wav`);
    else if (!files.has(path)) err(`manifest.json › sounds.${k} : fichier « ${path} » absent du dossier`);
    else if (files.get(path)!.length > 512 * 1024) err(`« ${path} » est trop volumineux (maximum 512 Ko)`);
  }

  // --- Planche (dimensions lues dans l'en-tête PNG) ---
  const sheet = files.get(file);
  if (!sheet) err(`planche « ${file} » absente du dossier`);
  else if (sheet.length < 24 || sheet.readUInt32BE(0) !== 0x89504e47) err(`${file} : ce n'est pas un PNG`);
  else {
    const w = sheet.readUInt32BE(16);
    const hh = sheet.readUInt32BE(20);
    if (w > 2048 || hh > 2048) err(`${file} : planche trop grande (${w}×${hh}, maximum 2048×2048)`);
    if (fw > 0 && fh > 0 && (w % fw !== 0 || hh % fh !== 0)) err(`${file} : ${w}×${hh} n'est pas un multiple de la case ${fw}×${fh}`);
    cols = fw > 0 ? Math.floor(w / fw) : 0;
    rows = fh > 0 ? Math.floor(hh / fh) : 0;
  }
}

// --- Animations -------------------------------------------------------------------------
if (a) {
  if (a['formatVersion'] !== 1) err('animations.json › formatVersion : attendu 1');
  const anims = (a['animations'] ?? {}) as Record<string, Record<string, any>>;
  for (const r of REQUIRED) if (!anims[r]) err(`animations.json › état obligatoire « ${r} » manquant`);
  if (Object.keys(anims).length > 64) err('animations.json : 64 animations maximum');
  for (const [name, d] of Object.entries(anims)) {
    const at = `animations.json › ${name}`;
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(name)) err(`${at} : nom invalide (minuscules, chiffres, _)`);
    for (const k of Object.keys(d)) {
      if (!['row', 'startColumn', 'frameCount', 'fps', 'loop', 'frameDurations', 'next', 'events'].includes(k)) err(`${at} : champ inconnu « ${k} »`);
    }
    if (!isInt(d['row'], 0, 10_000)) err(`${at}.row : entier attendu`);
    if (typeof d['loop'] !== 'boolean') err(`${at}.loop : true ou false attendu`);
    const count = Number(d['frameCount']);
    if (!isInt(count, 1, 32)) err(`${at}.frameCount : entre 1 et 32`);
    if (!(d['fps'] > 0 && d['fps'] <= 30)) err(`${at}.fps : entre 0 (exclu) et 30`);
    if (rows > 0 && d['row'] >= rows) err(`${at}.row : ligne ${d['row']} hors de la planche (${rows} lignes)`);
    const start = Number(d['startColumn'] ?? 0);
    if (cols > 0 && start + count > cols) err(`${at} : ${count} frames depuis la colonne ${start} dépassent la largeur (${cols} colonnes)`);
    const durations = d['frameDurations'] as number[] | undefined;
    if (durations && durations.length !== count) err(`${at}.frameDurations : ${count} valeurs attendues (frameCount)`);
    if (durations?.some((ms) => !(ms >= 16 && ms <= 5000))) err(`${at}.frameDurations : chaque durée entre 16 et 5000 ms`);
    if (d['next'] !== undefined && !anims[d['next']]) err(`${at}.next : animation « ${d['next']} » inexistante`);
    ((d['events'] ?? []) as Array<Record<string, any>>).forEach((ev, i) => {
      const e = `${at}.events[${i}]`;
      if (!(ev['frame'] >= 0 && ev['frame'] < count)) err(`${e}.frame : ${ev['frame']} ≥ frameCount (${count})`);
      if (!EVENTS.includes(ev['type'])) err(`${e}.type : « ${ev['type']} » inconnu`);
      if (['sound', 'particle', 'emote', 'custom'].includes(ev['type']) && !ev['id']) err(`${e}.id : obligatoire pour le type « ${ev['type']} »`);
      if (ev['type'] === 'sound' && ev['id'] && !sounds[ev['id']]) err(`${e}.id : son « ${ev['id']} » absent de manifest.sounds`);
      if (ev['anchor'] && !anchors[ev['anchor']]) err(`${e}.anchor : point d'attache « ${ev['anchor']} » inexistant`);
    });
  }
  const optional = ['wave', 'wall_hang', 'hang_ceiling', 'dizzy', 'vomit', 'grumpy', 'carry', 'carry_idle', 'throw', 'pet', 'yawn', 'look', 'sulk', 'type'];
  const missing = optional.filter((n) => !anims[n]);
  if (missing.length > 0) warnings.push(`animations facultatives absentes (remplacées par idle) : ${missing.join(', ')}`);
}

// --- Archive ------------------------------------------------------------------------------
const total = [...files.values()].reduce((n, b) => n + b.length, 0);
if (files.size > 64) err(`trop de fichiers (${files.size}, maximum 64)`);
if (total > 10 * 1024 * 1024) err('pack trop volumineux (maximum 10 Mo)');

for (const w of warnings) console.log(`⚠ ${w}`);
if (errors.length > 0) {
  console.error(`\n✗ ${errors.length} erreur(s) — pack non créé :`);
  for (const e of errors) console.error(`  • ${e}`);
  process.exit(1);
}
const zip = createZip([...files.entries()].map(([name, data]) => ({ name, data: new Uint8Array(data) })));
writeFileSync(out, zip);
console.log(`\n✓ ${basename(out)} créé (${files.size} fichiers, ${Math.round(zip.length / 1024)} Ko).`);
console.log('  Glisse-le sur ton compagnon ou importe-le depuis Console › Look pour la vérification finale.');
