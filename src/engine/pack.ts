/**
 * Chargement d'un pack de compagnon (manifest.json + animations.json + spritesheet).
 * Vérifications légères ici ; la validation complète (schéma, ZIP, sécurité) se fait
 * côté Rust à l'importation d'un fichier .companion (étape 4).
 */

export interface Point {
  x: number;
  y: number;
}

export interface CompanionManifest {
  formatVersion: 1;
  id: string;
  name: string;
  author: string;
  version: string;
  sprite: {
    file: string;
    frameWidth: number;
    frameHeight: number;
    scale?: number;
    facing?: 'left' | 'right';
  };
  hitbox: { x: number; y: number; width: number; height: number };
  anchorPoints: Record<string, Point> & { feet: Point; bubble: Point };
  baseStats: { strength: number; agility: number; endurance: number; technique: number };
  personalityWeights: Partial<Record<string, number>>;
  sounds?: Record<string, string>;
}

export type AnimEventType = 'sound' | 'particle' | 'hit' | 'footstep' | 'emote' | 'custom';

export interface AnimEvent {
  frame: number;
  type: AnimEventType;
  id?: string;
  anchor?: string;
  offset?: Point;
}

export interface AnimationDef {
  row: number;
  startColumn?: number;
  frameCount: number;
  fps: number;
  loop: boolean;
  frameDurations?: number[];
  next?: string;
  events?: AnimEvent[];
}

export const REQUIRED_ANIMATIONS = [
  'idle', 'walk', 'run', 'jump', 'fall', 'climb', 'sit_window', 'grab_edge', 'sleep',
  'eat', 'play', 'train', 'dragged', 'attack_light', 'attack_heavy', 'hurt', 'victory', 'defeat',
] as const;

export type AnimationName = (typeof REQUIRED_ANIMATIONS)[number];

export interface CompanionPack {
  manifest: CompanionManifest;
  animations: Record<string, AnimationDef>;
  image: HTMLImageElement;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function loadPack(baseUrl: string): Promise<CompanionPack> {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const [manifest, animFile] = await Promise.all([
    fetchJson<CompanionManifest>(`${base}manifest.json`),
    fetchJson<{ animations: Record<string, AnimationDef> }>(`${base}animations.json`),
  ]);

  // `load` plutôt que `decode()` : decode() reste en attente tant que la page est
  // invisible (overlay masqué au démarrage), ce qui bloquerait l'initialisation.
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`${manifest.sprite.file} : image illisible`));
    image.src = `${base}${manifest.sprite.file}`;
  });

  const { frameWidth, frameHeight } = manifest.sprite;
  const cols = Math.floor(image.naturalWidth / frameWidth);
  const rows = Math.floor(image.naturalHeight / frameHeight);
  const errors: string[] = [];
  for (const name of REQUIRED_ANIMATIONS) {
    const def = animFile.animations[name];
    if (!def) {
      errors.push(`animation « ${name} » manquante`);
      continue;
    }
    if (def.row >= rows) errors.push(`${name} : ligne ${def.row} hors de la planche (${rows} lignes)`);
    if ((def.startColumn ?? 0) + def.frameCount > cols) {
      errors.push(`${name} : ${def.frameCount} frames dépassent la largeur (${cols} colonnes)`);
    }
  }
  if (errors.length > 0) throw new Error(`Pack « ${manifest.id} » invalide :\n- ${errors.join('\n- ')}`);

  return { manifest, animations: animFile.animations, image };
}
