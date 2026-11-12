import type { World } from '../engine/World';
import type { WorldSnapshot } from '../platform/bridge';

/**
 * Visualisation du monde physique (mode debug uniquement : navigateur ou `?debug`).
 * Sols en bleu, plateformes en vert, contours des fenêtres en gris. Redessinée
 * seulement quand le monde change : aucun coût par frame.
 */
export class DebugOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(stage: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'debug-overlay';
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponible');
    this.ctx = ctx;
    stage.prepend(this.canvas);
  }

  draw(world: World, snapshot: WorldSnapshot): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
    const { ctx } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(120, 130, 150, 0.8)';
    ctx.fillStyle = 'rgba(120, 130, 150, 0.08)';
    for (const w of [...snapshot.windows].reverse()) {
      ctx.fillRect(w.rect.x, w.rect.y, w.rect.w, w.rect.h);
      ctx.strokeRect(w.rect.x + 0.5, w.rect.y + 0.5, w.rect.w - 1, w.rect.h - 1);
    }

    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(60, 140, 255, 0.9)';
    for (const f of world.floors) this.line(f.x1, f.x2, f.y);
    ctx.strokeStyle = 'rgba(40, 210, 120, 0.95)';
    for (const p of world.platforms) this.line(p.x1, p.x2, p.y);
  }

  private line(x1: number, x2: number, y: number): void {
    this.ctx.beginPath();
    this.ctx.moveTo(x1, y);
    this.ctx.lineTo(x2, y);
    this.ctx.stroke();
  }
}

/** Monde factice pour itérer dans un navigateur sans Tauri : un écran et trois fenêtres. */
export function fakeWorld(): WorldSnapshot {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const win = (id: number, x: number, y: number, w: number, h: number, spans: Array<[number, number]>) => ({
    id,
    rect: { x, y, w, h },
    topSpans: spans,
    foreground: id === 1,
    maximized: false,
  });
  const a = { x: W * 0.55, y: H * 0.42, w: W * 0.3, h: H * 0.35 };
  const b = { x: W * 0.12, y: H * 0.5, w: W * 0.35, h: H * 0.3 };
  const c = { x: W * 0.3, y: H * 0.3, w: W * 0.32, h: H * 0.25 };
  return {
    monitors: [{ bounds: { x: 0, y: 0, w: W, h: H }, work: { x: 0, y: 0, w: W, h: H - 48 }, primary: true }],
    windows: [
      win(1, a.x, a.y, a.w, a.h, [[a.x, a.x + a.w]]),
      win(2, c.x, c.y, c.w, c.h, [[c.x, c.x + c.w]]),
      // La fenêtre b est en partie masquée par c (au-dessus d'elle).
      win(3, b.x, b.y, b.w, b.h, [[b.x, c.x]]),
    ],
  };
}
