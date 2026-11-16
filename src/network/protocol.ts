/**
 * Messages d'un salon (une ligne JSON chacun). L'hôte relaie les messages entre joueurs
 * et y inscrit l'expéditeur réel (`from`) : un joueur ne peut pas se faire passer pour
 * un autre. Tout ce qui arrive est validé et borné : les pairs ne sont pas fiables.
 */
import { NOTE_MAX_LENGTH } from '../entities/CompanionStats';
import type { Placement, Side } from './Layout';

/** 3 : salon en file horizontale (gauche ↔ droite). */
export const PROTOCOL_VERSION = 3;
export const MAX_PLAYERS = 8;
export const PLAYER_COLORS = ['#4dfcb0', '#ff6b6b', '#5a96e6', '#ffc65c', '#c38bff', '#ff9fd0', '#7ee0ff', '#b6e36b'];

export interface Player {
  id: string;
  name: string;
  color: string;
}

/** Apparence transmise : fichiers du pack (JSON en texte, planche PNG en base64). */
export interface PackPayload {
  manifest: string;
  animations: string;
  sheet: string;
}

/** Objets qui peuvent passer d'un écran à l'autre. */
export type TravelKind = 'ball' | 'bag' | 'terminal' | 'bowl' | 'food' | 'note';
const TRAVEL_KINDS: readonly TravelKind[] = ['ball', 'bag', 'terminal', 'bowl', 'food', 'note'];
const FOODS = ['kibble', 'cookie', 'apple', 'coffee'] as const;

export type Traveller =
  | {
      kind: 'companion';
      owner: string;
      ownerName: string;
      facing: 1 | -1;
      /** Sauvegarde du compagnon (validée par CompanionStats.restore à l'arrivée). */
      stats: unknown;
      pack: PackPayload;
      /** Secoué juste avant de partir : il arrive la tête qui tourne. */
      queasy?: boolean;
    }
  | { kind: 'toy'; owner: string; toy: TravelKind; food: (typeof FOODS)[number] | null; text: string };

/** Bord de sortie chez l'expéditeur, ou `home` : retour à la maison (rappel). */
export type Exit = Side | 'home';

export type Message =
  | { type: 'join'; v: number; id: string; name: string }
  | { type: 'room'; hostId: string; players: Player[]; layout: unknown }
  | { type: 'transfer'; to: string; from?: string; item: Traveller; exit: Exit; t: number; vx: number; vy: number }
  | { type: 'recall'; to: '*'; from?: string; owner: string }
  | { type: 'sync'; to: string; from?: string; owner: string; stats: unknown }
  | { type: 'notice'; to: string; from?: string; text: string };

/** Identifiant de joueur : 16 caractères hexadécimaux. */
const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{16}$/.test(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);
const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null;
const SIDES: readonly Exit[] = ['left', 'right', 'top', 'bottom', 'home'];
const MAX_SPEED = 3000;

function parsePack(v: unknown): PackPayload | null {
  if (!isObj(v)) return null;
  const manifest = str(v['manifest'], 64_000);
  const animations = str(v['animations'], 256_000);
  const sheet = str(v['sheet'], 3_500_000);
  if (!manifest || !animations || !sheet || !/^[A-Za-z0-9+/=]+$/.test(sheet)) return null;
  return { manifest, animations, sheet };
}

function parseTraveller(v: unknown): Traveller | null {
  if (!isObj(v) || !isId(v['owner'])) return null;
  if (v['kind'] === 'companion') {
    const ownerName = str(v['ownerName'], 32);
    const pack = parsePack(v['pack']);
    if (!ownerName || !pack || !isObj(v['stats'])) return null;
    return {
      kind: 'companion',
      owner: v['owner'],
      ownerName,
      facing: v['facing'] === -1 ? -1 : 1,
      stats: v['stats'],
      pack,
      queasy: v['queasy'] === true,
    };
  }
  if (v['kind'] === 'toy') {
    const toy = v['toy'];
    if (!TRAVEL_KINDS.includes(toy as TravelKind)) return null;
    const food = FOODS.includes(v['food'] as (typeof FOODS)[number]) ? (v['food'] as (typeof FOODS)[number]) : null;
    const text = str(v['text'] ?? '', NOTE_MAX_LENGTH) ?? '';
    return { kind: 'toy', owner: v['owner'], toy: toy as TravelKind, food, text };
  }
  return null;
}

export function parseMessage(text: string): Message | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(raw)) return null;
  const from = isId(raw['from']) ? raw['from'] : undefined;
  const withFrom = <T extends Message>(m: T): T => (from ? { ...m, from } : m);
  switch (raw['type']) {
    case 'join': {
      const name = str(raw['name'], 32);
      if (!isId(raw['id']) || !name?.trim()) return null;
      return { type: 'join', v: num(raw['v'], 0, 99) ?? 0, id: raw['id'], name };
    }
    case 'room': {
      if (!isId(raw['hostId']) || !Array.isArray(raw['players']) || raw['players'].length > MAX_PLAYERS) return null;
      const players: Player[] = [];
      for (const p of raw['players']) {
        if (!isObj(p) || !isId(p['id'])) return null;
        const name = str(p['name'], 32);
        const color = PLAYER_COLORS.includes(p['color'] as string) ? (p['color'] as string) : PLAYER_COLORS[0]!;
        if (!name) return null;
        players.push({ id: p['id'], name, color });
      }
      return { type: 'room', hostId: raw['hostId'], players, layout: raw['layout'] };
    }
    case 'transfer': {
      const item = parseTraveller(raw['item']);
      const exit = raw['exit'];
      const t = num(raw['t'], 0, 1);
      const vx = num(raw['vx'], -MAX_SPEED, MAX_SPEED);
      const vy = num(raw['vy'], -MAX_SPEED, MAX_SPEED);
      if (!isId(raw['to']) || !item || !SIDES.includes(exit as Exit) || t === null || vx === null || vy === null) return null;
      return withFrom({ type: 'transfer' as const, to: raw['to'], item, exit: exit as Exit, t, vx, vy });
    }
    case 'recall':
      return isId(raw['owner']) ? withFrom({ type: 'recall' as const, to: '*' as const, owner: raw['owner'] }) : null;
    case 'sync':
      return isId(raw['to']) && isId(raw['owner']) && isObj(raw['stats'])
        ? withFrom({ type: 'sync' as const, to: raw['to'], owner: raw['owner'], stats: raw['stats'] })
        : null;
    case 'notice': {
      const t = str(raw['text'], 200);
      return isId(raw['to']) && t ? withFrom({ type: 'notice' as const, to: raw['to'], text: t }) : null;
    }
    default:
      return null;
  }
}

/** Placement reçu dans un message `room`. */
export type RoomLayout = Placement;

export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fromBase64(text: string): ArrayBuffer {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
