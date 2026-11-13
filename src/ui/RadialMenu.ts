import type { HitRect } from '../platform/bridge';
import type { IconName } from './iconNames';
import { icon } from './kit';
import { h } from './Panel';

export interface RadialItem {
  icon: IconName;
  label: string;
  action(): void;
}

const RADIUS = 70;
const AUTO_CLOSE_MS = 8000;

/**
 * Menu radial d'interaction rapide (double-clic sur le compagnon) : des boutons en
 * cercle autour de lui, et le nom de l'action survolée en dessous. Se ferme au choix
 * d'une action, sur Échap, ou tout seul.
 */
export class RadialMenu {
  private readonly el: HTMLElement;
  private readonly label: HTMLElement;
  private readonly onToggle: (open: boolean) => void;
  private rect: HitRect | null = null;
  private timer: number | undefined;

  constructor(stage: HTMLElement, onToggle: (open: boolean) => void) {
    this.onToggle = onToggle;
    this.label = h('span.radial-label');
    this.el = h('nav.radial', { 'aria-label': 'Actions rapides', hidden: true });
    stage.append(this.el);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(center: { x: number; y: number }, items: RadialItem[]): void {
    this.el.replaceChildren(h('i.radial-ring'), this.label);
    this.label.textContent = '';
    items.forEach((item, i) => {
      const angle = -Math.PI / 2 + (i / items.length) * Math.PI * 2;
      const b = h('button.radial-item', { type: 'button', 'aria-label': item.label }, icon(item.icon, 2));
      b.style.setProperty('--tx', `${Math.round(Math.cos(angle) * RADIUS)}px`);
      b.style.setProperty('--ty', `${Math.round(Math.sin(angle) * RADIUS)}px`);
      b.style.animationDelay = `${i * 22}ms`;
      const show = (): void => {
        this.label.textContent = item.label;
      };
      b.addEventListener('pointerenter', show);
      b.addEventListener('focus', show);
      b.addEventListener('pointerleave', () => (this.label.textContent = ''));
      b.addEventListener('click', () => {
        this.close();
        item.action();
      });
      this.el.append(b);
    });

    // Garde le menu (et son étiquette) entièrement à l'écran.
    const margin = RADIUS + 30;
    const x = Math.min(Math.max(center.x, margin + 40), window.innerWidth - margin - 40);
    const y = Math.min(Math.max(center.y, margin), window.innerHeight - margin - 30);
    this.el.style.left = `${Math.round(x)}px`;
    this.el.style.top = `${Math.round(y)}px`;
    this.el.hidden = false;
    this.rect = { x: x - margin - 40, y: y - margin, w: (margin + 40) * 2, h: margin * 2 + 30 };

    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.close(), AUTO_CLOSE_MS);
    this.onToggle(true);
  }

  close(): void {
    if (!this.isOpen) return;
    window.clearTimeout(this.timer);
    this.el.hidden = true;
    this.rect = null;
    this.onToggle(false);
  }

  hitRect(): HitRect | null {
    return this.rect;
  }
}
