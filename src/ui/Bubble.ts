import type { Activity, LoopSystem } from '../engine/GameLoop';

type Anchor = () => { x: number; y: number };

/** Bulle de dialogue qui suit une ancre (la tête du compagnon) puis s'efface. */
export class Bubble implements LoopSystem {
  private readonly el: HTMLDivElement;
  private readonly anchor: Anchor;
  private remaining = 0;
  private lastTransform = '';

  constructor(stage: HTMLElement, anchor: Anchor) {
    this.anchor = anchor;
    this.el = document.createElement('div');
    this.el.className = 'bubble';
    this.el.setAttribute('role', 'status');
    stage.append(this.el);
  }

  say(text: string, seconds = 3): void {
    this.el.textContent = text;
    this.el.classList.add('visible');
    this.remaining = seconds;
  }

  update(dt: number): void {
    if (this.remaining <= 0) return;
    this.remaining -= dt;
    if (this.remaining <= 0) this.el.classList.remove('visible');
  }

  render(): void {
    if (this.remaining <= 0) return;
    const { x, y } = this.anchor();
    const transform = `translate3d(${Math.round(x)}px, ${Math.round(y - 10)}px, 0) translate(-50%, -100%)`;
    if (transform === this.lastTransform) return;
    this.lastTransform = transform;
    this.el.style.transform = transform;
  }

  destroy(): void {
    this.el.remove();
  }

  activity(): Activity {
    return this.remaining > 0 ? 'idle' : 'dormant';
  }
}
