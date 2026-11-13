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
  /** Couleur d'accent de l'interface (« #rrggbb ») ; sinon tirée de la planche. */
  accentColor?: string;
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
  /** Sons du pack (id → données .ogg/.wav), joués par les événements `sound`. */
  sounds: Record<string, ArrayBuffer>;
}

/** Lecture d'un fichier du pack, quelle que soit sa source (URL ou backend). */
export type PackReader = (file: string) => Promise<ArrayBuffer>;

export function loadPack(baseUrl: string): Promise<CompanionPack> {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return loadPackWith(async (file) => {
    const res = await fetch(`${base}${file}`);
    if (!res.ok) throw new Error(`${file} : HTTP ${res.status}`);
    return res.arrayBuffer();
  });
}

export async function loadPackWith(read: PackReader): Promise<CompanionPack> {
  const json = async <T>(file: string): Promise<T> => JSON.parse(new TextDecoder().decode(await read(file))) as T;
  const [manifest, animFile] = await Promise.all([
    json<CompanionManifest>('manifest.json'),
    json<{ animations: Record<string, AnimationDef> }>('animations.json'),
  ]);

  // `load` plutôt que `decode()` : decode() reste en attente tant que la page est
  // invisible (overlay masqué au démarrage), ce qui bloquerait l'initialisation.
  const url = URL.createObjectURL(new Blob([await read(manifest.sprite.file)], { type: 'image/png' }));
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`${manifest.sprite.file} : image illisible`));
    image.src = url;
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

  // Sons : facultatifs ; un fichier illisible est simplement ignoré.
  const sounds: Record<string, ArrayBuffer> = {};
  await Promise.all(
    Object.entries(manifest.sounds ?? {}).map(async ([id, file]) => {
      try {
        sounds[id] = await read(file);
      } catch {
        /* son absent (pack d'un visiteur, par exemple) */
      }
    }),
  );
  return { manifest, animations: animFile.animations, image, sounds };
}
