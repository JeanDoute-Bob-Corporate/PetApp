/**
 * Augmente la version partout d'un coup (package.json, package-lock.json,
 * tauri.conf.json, Cargo.toml, Cargo.lock).
 *
 *   npm run bump            → 0.1.1 → 0.1.2  (correctif)
 *   npm run bump -- minor   → 0.1.1 → 0.2.0  (nouveautés)
 *   npm run bump -- 1.0.0   → version exacte
 *
 * Il suffit ensuite de commiter et pousser sur main : GitHub publie la mise à jour.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const path = (p: string): string => join(root, p);
const conf = JSON.parse(readFileSync(path('src-tauri/tauri.conf.json'), 'utf8')) as { version: string };
const current = conf.version;
const arg = process.argv[2] ?? 'patch';

const parts = current.split('.').map(Number);
if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) throw new Error(`Version actuelle illisible : ${current}`);
const [maj, min, pat] = parts as [number, number, number];
const next =
  arg === 'patch' ? `${maj}.${min}.${pat + 1}`
  : arg === 'minor' ? `${maj}.${min + 1}.0`
  : arg === 'major' ? `${maj + 1}.0.0`
  : /^\d+\.\d+\.\d+$/.test(arg) ? arg
  : null;
if (!next) {
  console.error('Usage : npm run bump [-- patch|minor|major|x.y.z]');
  process.exit(2);
}
const newer = next.split('.').map(Number).reduce((acc, n, i) => (acc !== 0 ? acc : n - parts[i]!), 0) > 0;
if (!newer) {
  console.error(`✗ ${next} n'est pas plus grand que ${current} : les applications ne la proposeraient pas.`);
  process.exit(1);
}

const edit = (file: string, from: RegExp, to: string): void => {
  const text = readFileSync(path(file), 'utf8');
  if (!from.test(text)) throw new Error(`${file} : version introuvable`);
  writeFileSync(path(file), text.replace(from, to));
};
// Le premier "version" des fichiers JSON est celui de l'application.
edit('package.json', /"version": "[^"]+"/, `"version": "${next}"`);
edit('src-tauri/tauri.conf.json', /"version": "[^"]+"/, `"version": "${next}"`);
edit('src-tauri/Cargo.toml', /^version = "[^"]+"/m, `version = "${next}"`);
edit('src-tauri/Cargo.lock', /(name = "desktop-companion"\nversion = )"[^"]+"/, `$1"${next}"`);
// package-lock.json : la racine et l'entrée du paquet "" portent la version.
const lockPath = path('package-lock.json');
const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as { version?: string; packages?: Record<string, { version?: string }> };
lock.version = next;
if (lock.packages?.['']) lock.packages[''].version = next;
writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

console.log(`✓ Version ${current} → ${next}. Commite et pousse sur main : la mise à jour sera publiée automatiquement.`);
