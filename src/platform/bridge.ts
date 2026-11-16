/**
 * Façade typée vers le backend Rust. Hors de Tauri (simple `vite` dans un navigateur),
 * les appels retombent sur des valeurs par défaut pour pouvoir itérer sur le rendu.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type PerformanceProfileId = 'eco' | 'balanced' | 'high';

export interface ProfileParams {
  targetFps: number;
  idleFps: number;
  trackerHz: number;
  particles: boolean;
  shadows: boolean;
  pauseOnFullscreen: boolean;
}

export interface BehaviorToggles {
  climbWindows: boolean;
  sitOnWindows: boolean;
  mouseInteractions: boolean;
  sounds: boolean;
  dndFullscreen: boolean;
  mischiefWindows: boolean;
  mischiefIcons: boolean;
  mischiefClicks: boolean;
  /** Lueur colorée et nom du voisin sur les bords reliés (multijoueur). */
  edgeMarkers: boolean;
}

/** Icône du bureau (rectangle en px CSS de l'overlay). */
export interface DesktopIcon {
  index: number;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FileDrop {
  /** Noms des fichiers déposés (le dépôt HTML5 ne donne pas leur chemin). */
  names: string[];
  /** Contenu des fichiers (pour importer un pack .companion). */
  files: File[];
  /** Position du dépôt en px CSS. */
  x: number;
  y: number;
}

export interface Settings {
  schemaVersion: number;
  performanceProfile: PerformanceProfileId;
  behaviors: BehaviorToggles;
  visible: boolean;
  /** Pack d'apparence appliqué (null = compagnon par défaut). */
  activePack: string | null;
}

export interface PackInfo {
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
  builtin: boolean;
}

/** Salon annoncé sur le réseau local. */
export interface RoomInfo {
  id: string;
  name: string;
  address: string;
  players: number;
}

export interface P2pStatus {
  hosting: boolean;
  browsing: boolean;
  /** Code de session à partager (salon ouvert uniquement). */
  code: string | null;
  connections: number;
}

export interface SettingsPayload {
  settings: Settings;
  profile: ProfileParams;
}

/** Rectangle interactif en pixels CSS, relatif à l'overlay. */
export interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CursorPosition {
  x: number;
  y: number;
  /** Le curseur est à moins de 400 px d'une zone interactive. */
  near: boolean;
}

export type TrayAction = 'feed' | 'toys' | 'multiplayer' | 'settings';

/** Rectangle en pixels CSS relatifs à l'overlay (calculé par window_tracker.rs). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MonitorArea {
  bounds: Rect;
  /** Écran moins la barre des tâches. */
  work: Rect;
  primary: boolean;
}

export interface TrackedWindow {
  id: number;
  rect: Rect;
  /** Portions visibles du bord supérieur `[x1, x2]`. */
  topSpans: Array<[number, number]>;
  foreground: boolean;
  maximized: boolean;
}

export interface WorldSnapshot {
  monitors: MonitorArea[];
  /** Du haut vers le bas de la pile Z. */
  windows: TrackedWindow[];
}

export const isTauri = '__TAURI_INTERNALS__' in window;

const BROWSER_FALLBACK: SettingsPayload = {
  settings: {
    schemaVersion: 1,
    performanceProfile: 'balanced',
    behaviors: {
      climbWindows: true,
      sitOnWindows: true,
      mouseInteractions: true,
      sounds: false,
      dndFullscreen: true,
      mischiefWindows: true,
      mischiefIcons: true,
      mischiefClicks: true,
      edgeMarkers: true,
    },
    visible: true,
    activePack: null,
  },
  profile: {
    targetFps: 30,
    idleFps: 10,
    trackerHz: 10,
    particles: true,
    shadows: false,
    pauseOnFullscreen: true,
  },
};

function call<T>(command: string, args: Record<string, unknown>, fallback: T): Promise<T> {
  return isTauri ? invoke<T>(command, args) : Promise.resolve(fallback);
}

function on<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(() => undefined);
  return listen<T>(event, (e) => handler(e.payload));
}

export const backend = {
  getSettings: () => call<SettingsPayload>('get_settings', {}, BROWSER_FALLBACK),
  updateSettings: (settings: Settings) =>
    call<SettingsPayload>('update_settings', { settings }, { ...BROWSER_FALLBACK, settings }),
  setHitboxes: (rects: HitRect[]) => call<void>('set_hitboxes', { rects }, undefined),
  setPointerCapture: (active: boolean) => call<void>('set_pointer_capture', { active }, undefined),
  setCursorTracking: (enabled: boolean) => call<void>('set_cursor_tracking', { enabled }, undefined),
  getWorld: () => call<WorldSnapshot | null>('get_world', {}, null),
  loadCompanion: () => call<unknown>('load_companion', {}, null),
  saveCompanion: (data: unknown) => call<void>('save_companion', { data }, undefined),
  getAutostart: () => call<boolean>('get_autostart', {}, false),
  setAutostart: (enabled: boolean) => call<boolean>('set_autostart', { enabled }, enabled),
  nudgeWindow: (id: number, edge: 'left' | 'right', dx: number) => call<number>('nudge_window', { id, edge, dx }, 0),
  desktopIcons: () => call<DesktopIcon[]>('desktop_icons', {}, []),
  moveDesktopIcon: (index: number, x: number, y: number) => call<void>('move_desktop_icon', { index, x, y }, undefined),
  desktopIconForName: (name: string) => call<number | null>('desktop_icon_for_name', { name }, null),
  pokeScreen: (x: number, y: number) => call<boolean>('poke_screen', { x, y }, false),
  setKeyboardFocus: (enabled: boolean) => call<void>('set_keyboard_focus', { enabled }, undefined),
  listPacks: () => call<PackInfo[]>('list_packs', {}, []),
  p2pStatus: () => call<P2pStatus>('p2p_status', {}, { hosting: false, browsing: false, code: null, connections: 0 }),
  p2pHost: (open: boolean, name: string, players: number) =>
    call<P2pStatus>('p2p_host', { open, name, players }, { hosting: open, browsing: false, code: null, connections: 0 }),
  p2pBrowse: (on: boolean) => call<P2pStatus>('p2p_browse', { on }, { hosting: false, browsing: on, code: null, connections: 0 }),
  /** Rejoint un salon (identifiant découvert ou code) ; renvoie l'identifiant de connexion. */
  p2pConnect: (target: string): Promise<number> =>
    isTauri ? invoke<number>('p2p_connect', { target }) : Promise.reject(new Error('Multijoueur disponible dans l’application uniquement.')),
  p2pSend: (conn: number, message: string) => call<void>('p2p_send', { conn, message }, undefined),
  /** Ferme une connexion, ou toutes avec `null`. */
  p2pClose: (conn: number | null) => call<void>('p2p_close', { conn }, undefined),
  deletePack: (id: string) => call<void>('delete_pack', { id }, undefined),
  /** Fichier d'un pack installé, en binaire. */
  packFile: (id: string, file: string): Promise<ArrayBuffer> =>
    isTauri ? invoke<ArrayBuffer>('pack_file', { id, file }) : Promise.reject(new Error('hors Tauri')),
  /** Import : l'archive est envoyée telle quelle (corps binaire, pas de JSON). Rejette avec la liste des erreurs. */
  importCompanion: (bytes: Uint8Array): Promise<PackInfo> =>
    isTauri ? invoke<PackInfo>('import_companion', bytes) : Promise.reject(['Import disponible dans l’application uniquement.']),
} as const;

export const events = {
  onSettingsChanged: (handler: (payload: SettingsPayload) => void) =>
    on<SettingsPayload>('settings-changed', handler),
  onTrayAction: (handler: (action: TrayAction) => void) => on<TrayAction>('tray-action', handler),
  onVisibilityChanged: (handler: (visible: boolean) => void) =>
    on<boolean>('visibility-changed', handler),
  onCursorMoved: (handler: (cursor: CursorPosition) => void) =>
    on<CursorPosition>('cursor-moved', handler),
  onWorldChanged: (handler: (world: WorldSnapshot) => void) => on<WorldSnapshot>('world-changed', handler),
  onRooms: (handler: (rooms: RoomInfo[]) => void) => on<RoomInfo[]>('p2p-rooms', handler),
  onPeerConnected: (handler: (info: { conn: number; address: string; initiator: boolean }) => void) =>
    on<{ conn: number; address: string; initiator: boolean }>('p2p-connected', handler),
  onPeerMessage: (handler: (msg: { conn: number; text: string }) => void) =>
    on<{ conn: number; text: string }>('p2p-message', handler),
  onPeerDisconnected: (handler: (info: { conn: number }) => void) => on<{ conn: number }>('p2p-disconnected', handler),
  /** Émis juste avant de quitter : dernière chance de sauvegarder. */
  onFlushSave: (handler: () => void) => on<null>('flush-save', handler),
  onAutostartChanged: (handler: (enabled: boolean) => void) => on<boolean>('autostart-changed', handler),
  /**
   * Fichiers glissés depuis l'explorateur. `accepts(x, y)` décide où le dépôt est
   * permis (au-dessus du compagnon) : ailleurs, le curseur reste « interdit ».
   * `onHover` signale qu'un fichier survole une zone acceptée.
   */
  onFileDrop: (
    handler: (drop: FileDrop) => void,
    accepts: (x: number, y: number) => boolean,
    onHover: () => void,
  ): Promise<UnlistenFn> => {
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const over = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // jamais de navigation vers le fichier
      const ok = accepts(e.clientX, e.clientY);
      if (e.dataTransfer) e.dataTransfer.dropEffect = ok ? 'copy' : 'none';
      if (ok) onHover();
    };
    const drop = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (!accepts(e.clientX, e.clientY)) return;
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length > 0) handler({ names: files.map((f) => f.name), files, x: e.clientX, y: e.clientY });
    };
    document.addEventListener('dragenter', over);
    document.addEventListener('dragover', over);
    document.addEventListener('drop', drop);
    return Promise.resolve(() => {
      document.removeEventListener('dragenter', over);
      document.removeEventListener('dragover', over);
      document.removeEventListener('drop', drop);
    });
  },
} as const;
