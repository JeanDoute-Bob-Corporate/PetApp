/**
 * Prépare une version publiable avec mise à jour automatique.
 *
 *   npm run release -- "Ce qui change dans cette version"
 *
 * 1. Signe la construction avec la clé privée %USERPROFILE%\.tauri\desktop-companion.key
 *    (jamais dans le dépôt) et lance `tauri build`.
 * 2. Rassemble dans release/publier-<version>/ :
 *      - DesktopCompanion_<version>_x64-setup.exe  (installateur signé)
 *      - latest.json                               (lu par l'application pour se mettre à jour)
 * 3. Il reste à créer sur GitHub une « Release » nommée v<version> et à y déposer ces
 *    deux fichiers (voir docs/MISES_A_JOUR.md).
 *
 * Avant de lancer : augmenter la version dans package.json, src-tauri/tauri.conf.json
 * et src-tauri/Cargo.toml (les applications installées ne se mettent à jour que vers une
 * version plus grande).
 */
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'JeanDoute-Bob-Corporate/PetApp';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const conf = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8')) as { version: string; productName: string };
const version = conf.version;
const notes = process.argv.slice(2).join(' ').trim() || `Version ${version}`;

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
const cargo = readFileSync(join(root, 'src-tauri/Cargo.toml'), 'utf8').match(/^version = "([^"]+)"/m)?.[1];
if (pkg.version !== version || cargo !== version) {
  console.error(`✗ Versions différentes : package.json ${pkg.version}, tauri.conf.json ${version}, Cargo.toml ${cargo}.`);
  process.exit(1);
}

const keyPath = join(homedir(), '.tauri', 'desktop-companion.key');
if (!existsSync(keyPath)) {
  console.error(`✗ Clé de signature introuvable : ${keyPath}`);
  console.error('  Sans elle, les applications installées refuseront la mise à jour.');
  process.exit(1);
}

console.log(`→ Construction signée de la version ${version}…`);
execSync('npx tauri build', {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: readFileSync(keyPath, 'utf8'), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '' },
});

const bundle = join(root, 'src-tauri/target/release/bundle/nsis', `${conf.productName}_${version}_x64-setup.exe`);
const signature = `${bundle}.sig`;
if (!existsSync(bundle) || !existsSync(signature)) {
  console.error(`✗ Installateur ou signature introuvable : ${bundle}(.sig)`);
  process.exit(1);
}

// Nom sans espace : c'est le nom exact du fichier une fois déposé sur GitHub.
const asset = `DesktopCompanion_${version}_x64-setup.exe`;
const out = join(root, 'release', `publier-${version}`);
mkdirSync(out, { recursive: true });
copyFileSync(bundle, join(out, asset));

const platform = {
  signature: readFileSync(signature, 'utf8').trim(),
  url: `https://github.com/${REPO}/releases/download/v${version}/${asset}`,
};
const latest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: { 'windows-x86_64': platform, 'windows-x86_64-nsis': platform },
};
writeFileSync(join(out, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`);

console.log(`
✓ Prêt dans ${out}
  1. GitHub › ${REPO} › Releases › « Draft a new release »
  2. Tag : v${version}   (exactement, avec le « v »)
  3. Dépose les deux fichiers : ${asset} et latest.json
  4. Publie (« Set as the latest release » coché).
  Les applications installées proposeront la mise à jour dans les 6 h (ou tout de suite
  via Console › Réglages › Rechercher une mise à jour).`);
