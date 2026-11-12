import type { TrackedWindow, WorldSnapshot } from '../platform/bridge';

/** Surface horizontale sur laquelle on peut se tenir (sol d'écran ou haut de fenêtre). */
export interface Segment {
  x1: number;
  x2: number;
  y: number;
  /** `null` pour le sol d'un écran (haut de la barre des tâches). */
  windowId: number | null;
}

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const SUPPORT_TOLERANCE = 2;

/**
 * Géométrie du bureau en px CSS : sols des écrans (zones de travail) et plateformes
 * formées par les bords supérieurs visibles des fenêtres.
 */
export class World {
  floors: Segment[] = [];
  platforms: Segment[] = [];
  bounds: Bounds = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  private windows = new Map<number, TrackedWindow>();
  private monitorTops: Array<{ x1: number; x2: number; top: number }> = [];
  /** Hauteur du compagnon : une plateforme sans cette place au-dessus est ignorée. */
  private headroom = 0;

  setHeadroom(height: number): void {
    this.headroom = height;
  }

  update(snapshot: WorldSnapshot): void {
    const monitors = snapshot.monitors;
    if (monitors.length === 0) return;

    this.floors = monitors.map((m) => ({
      x1: m.work.x,
      x2: m.work.x + m.work.w,
      y: m.work.y + m.work.h,
      windowId: null,
    }));
    this.monitorTops = monitors.map((m) => ({ x1: m.bounds.x, x2: m.bounds.x + m.bounds.w, top: m.bounds.y }));
    this.bounds = {
      left: Math.min(...monitors.map((m) => m.work.x)),
      top: Math.min(...monitors.map((m) => m.bounds.y)),
      right: Math.max(...monitors.map((m) => m.work.x + m.work.w)),
      bottom: Math.max(...monitors.map((m) => m.work.y + m.work.h)),
    };

    this.windows = new Map(snapshot.windows.map((w) => [w.id, w]));
    this.platforms = [];
    for (const win of snapshot.windows) {
      for (const [x1, x2] of win.topSpans) {
        const seg: Segment = { x1, x2, y: win.rect.y, windowId: win.id };
        if (this.isUsable(seg)) this.platforms.push(seg);
      }
    }
  }

  window(id: number): TrackedWindow | undefined {
    return this.windows.get(id);
  }

  /** Sol de l'écran situé sous `x` (null au-dessus d'un vide entre écrans). */
  floorAt(x: number): Segment | null {
    return this.floors.find((f) => x >= f.x1 && x <= f.x2) ?? null;
  }

  /** Surface qui soutient un point posé en (x, y), s'il y en a une. */
  supportAt(x: number, y: number, windowId?: number | null): Segment | null {
    for (const seg of this.all()) {
      if (windowId !== undefined && seg.windowId !== windowId) continue;
      if (x >= seg.x1 && x <= seg.x2 && Math.abs(seg.y - y) <= SUPPORT_TOLERANCE) return seg;
    }
    return null;
  }

  /** Première surface traversée en descendant de `fromY` à `toY` (plateformes à sens unique). */
  landing(x: number, fromY: number, toY: number): Segment | null {
    let best: Segment | null = null;
    for (const seg of this.all()) {
      if (x < seg.x1 || x > seg.x2) continue;
      if (fromY <= seg.y + 0.5 && toY >= seg.y && (!best || seg.y < best.y)) best = seg;
    }
    return best;
  }

  /** Surface la plus proche sous (x, y) : ombre portée et anticipation d'atterrissage. */
  surfaceBelow(x: number, y: number): Segment | null {
    let best: Segment | null = null;
    for (const seg of this.all()) {
      if (x < seg.x1 || x > seg.x2 || seg.y < y - 0.5) continue;
      if (!best || seg.y < best.y) best = seg;
    }
    return best;
  }

  private *all(): Iterable<Segment> {
    yield* this.platforms;
    yield* this.floors;
  }

  private isUsable(seg: Segment): boolean {
    const mid = (seg.x1 + seg.x2) / 2;
    const monitor = this.monitorTops.find((m) => mid >= m.x1 && mid <= m.x2);
    const floor = this.floorAt(mid);
    if (!monitor || !floor) return false;
    // La tête doit rester à l'écran, et la plateforme doit être au-dessus du sol.
    return seg.y - this.headroom >= monitor.top && seg.y < floor.y - 4;
  }
}
