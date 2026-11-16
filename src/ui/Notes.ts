import { NOTE_MAX_LENGTH } from '../entities/CompanionStats';
import type { HitRect } from '../platform/bridge';
import { button } from './kit';
import { h, Panel } from './Panel';

/**
 * Écriture d'une note. L'overlay ne prend jamais le focus clavier, sauf pendant cette
 * saisie : `onKeyboard(true/false)` l'active et le rend aussitôt.
 */
export class NotePanel extends Panel {
  private readonly input: HTMLTextAreaElement;
  private readonly counter: HTMLElement;
  private readonly onKeyboard: (enabled: boolean) => void;

  constructor(
    stage: HTMLElement,
    onSubmit: (text: string) => void,
    onKeyboard: (enabled: boolean) => void,
    onToggle: (open: boolean) => void,
  ) {
    super(stage, 'Petit mot', onToggle, 'note');
    this.el.classList.add('note-win');
    this.onKeyboard = onKeyboard;
    this.input = h('textarea.note-input', {
      maxlength: String(NOTE_MAX_LENGTH),
      rows: '3',
      placeholder: 'Un petit mot…',
      'aria-label': 'Texte de la note',
    });
    this.counter = h('span.note-counter');

    const submit = (): void => {
      const text = this.input.value.trim();
      if (!text) {
        this.input.focus();
        return;
      }
      this.input.value = '';
      this.updateCounter();
      this.close();
      onSubmit(text);
    };
    const send = button('Viser', submit, { icon: 'note', title: 'Il en fait une boule de papier et la lance où tu vises' });
    const cancel = button('Annuler', () => this.close(), { kind: 'ghost' });
    this.input.addEventListener('input', () => this.updateCounter());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        this.close();
      }
    });

    this.body.append(
      this.input,
      h('div.row', {}, this.counter, h('div.row-actions', {}, cancel, send)),
    );
    this.updateCounter();
  }

  override open(center: { x: number; y: number }): void {
    super.open(center);
    this.onKeyboard(true);
    window.setTimeout(() => this.input.focus(), 50);
  }

  override close(): void {
    if (!this.isOpen) return;
    this.onKeyboard(false);
    super.close();
  }

  private updateCounter(): void {
    this.counter.textContent = `${this.input.value.length}/${NOTE_MAX_LENGTH}`;
  }
}

/**
 * Mode visée : toute la surface de l'overlay capte la souris le temps de viser.
 * Une flèche part du compagnon vers le curseur ; clic gauche = lancer, clic droit ou
 * Échap = annuler. La force dépend de la distance.
 */
export class Aimer {
  private readonly layer: HTMLElement;
  private readonly line: SVGLineElement;
  private readonly hint: HTMLElement;
  private active = false;
  private origin: () => { x: number; y: number } = () => ({ x: 0, y: 0 });
  private onThrow: (vx: number, vy: number) => void = () => undefined;
  private onEnd: () => void = () => undefined;

  constructor(stage: HTMLElement) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'aim-svg');
    this.line = document.createElementNS(ns, 'line');
    svg.append(this.line);
    this.hint = h('div.aim-hint', {}, 'Clic : lancer · clic droit : annuler');
    this.layer = h('div.aim-layer', { hidden: true }, this.hint);
    this.layer.prepend(svg);
    stage.append(this.layer);

    this.layer.addEventListener('pointermove', (e) => this.track(e.clientX, e.clientY));
    this.layer.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      if (e.button === 2) return this.stop();
      if (e.button !== 0) return;
      const o = this.origin();
      const dx = e.clientX - o.x;
      const dy = e.clientY - o.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const speed = Math.min(1500, Math.max(320, dist * 2.2));
      // Un peu de hauteur en plus : la boule décrit une jolie parabole.
      this.onThrow((dx / dist) * speed, (dy / dist) * speed - 180);
      this.stop();
    });
    this.layer.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.stop();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.stop();
    });
  }

  get isActive(): boolean {
    return this.active;
  }

  start(origin: () => { x: number; y: number }, onThrow: (vx: number, vy: number) => void, onEnd: () => void): void {
    this.origin = origin;
    this.onThrow = onThrow;
    this.onEnd = onEnd;
    this.active = true;
    this.layer.hidden = false;
    const o = origin();
    this.track(o.x + 120, o.y - 120);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.layer.hidden = true;
    this.onEnd();
  }

  /** Toute la fenêtre est interactive pendant la visée. */
  hitRect(): HitRect | null {
    return this.active ? { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight } : null;
  }

  private track(x: number, y: number): void {
    const o = this.origin();
    this.line.setAttribute('x1', String(o.x));
    this.line.setAttribute('y1', String(o.y));
    this.line.setAttribute('x2', String(x));
    this.line.setAttribute('y2', String(y));
    this.hint.style.transform = `translate(${Math.round(x + 16)}px, ${Math.round(y + 16)}px)`;
  }
}

/** Petit papier qui affiche le texte d'une note ouverte, puis s'efface en fondu. */
export function showNotePopup(stage: HTMLElement, text: string, x: number, y: number): void {
  const el = h('div.note-popup', { role: 'status' }, text);
  const ms = Math.min(12_000, 3500 + text.length * 60);
  el.style.setProperty('--life', `${ms}ms`);
  stage.append(el);
  const r = el.getBoundingClientRect();
  const left = Math.min(Math.max(8, x - r.width / 2), window.innerWidth - r.width - 8);
  const top = Math.min(Math.max(8, y - r.height - 10), window.innerHeight - r.height - 8);
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  el.addEventListener('animationend', () => el.remove(), { once: true });
  // Sans animation (réglage Windows), animationend ne vient jamais.
  window.setTimeout(() => el.remove(), ms + 200);
}
