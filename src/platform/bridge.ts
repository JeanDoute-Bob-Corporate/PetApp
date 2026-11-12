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
}

export interface Settings {
  schemaVersion: number;
  performanceProfile: PerformanceProfileId;
  behaviors: BehaviorToggles;
  visible: boolean;
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
    },
    visible: true,
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
} as const;
