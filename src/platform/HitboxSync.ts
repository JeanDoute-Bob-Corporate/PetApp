import type { HitRect } from './bridge';

/**
 * Publie les zones interactives vers le thread de hit-test Rust.
 * - dédupliqué : rien n'est envoyé si les rectangles (arrondis au pixel) sont inchangés ;
 * - throttlé : au plus un envoi par `minIntervalMs`, le dernier état gagne.
 * Un compagnon immobile ne génère donc aucun trafic IPC.
 */
export class HitboxSync {
  private readonly send: (rects: HitRect[]) => Promise<void>;
  private readonly minIntervalMs: number;
  private lastKey = '';
  private pending: HitRect[] | null = null;
  private timer: number | undefined;
  private lastSentAt = -Infinity;

  constructor(send: (rects: HitRect[]) => Promise<void>, minIntervalMs = 33) {
    this.send = send;
    this.minIntervalMs = minIntervalMs;
  }

  update(rects: HitRect[]): void {
    const key = rects
      .map((r) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`)
      .join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.pending = rects;
    if (this.timer !== undefined) return;

    const wait = Math.max(0, this.lastSentAt + this.minIntervalMs - performance.now());
    this.timer = window.setTimeout(this.flush, wait);
  }

  private readonly flush = (): void => {
    this.timer = undefined;
    const rects = this.pending;
    if (!rects) return;
    this.pending = null;
    this.lastSentAt = performance.now();
    this.send(rects).catch((err: unknown) => console.warn('[hitbox] envoi impossible', err));
  };
}
