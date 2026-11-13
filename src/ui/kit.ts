/**
 * Kit d'interface « Byte OS » : icônes pixel-art, boutons, interrupteurs, jauges
 * segmentées et pastilles. Tout est du DOM léger stylé par styles.css.
 */
import { ICON_NAMES, type IconName } from './iconNames';
import { h } from './Panel';

/** Icône de la planche public/ui/icons.png ; `scale` 1 = 16 px, 2 = 32 px. */
export function icon(name: IconName, scale: 1 | 2 = 1): HTMLElement {
  const el = h(`i.ico${scale === 2 ? '.x2' : ''}`, { 'aria-hidden': 'true' });
  el.style.setProperty('--i', String(ICON_NAMES.indexOf(name)));
  return el;
}

export type ButtonKind = 'primary' | 'ghost' | 'danger' | 'icon';

export interface ButtonOptions {
  icon?: IconName;
  kind?: ButtonKind;
  title?: string;
}

/** Bouton pixel « pressable ». Un bouton sans texte devient un bouton-icône carré. */
export function button(label: string, onClick: () => void, opts: ButtonOptions = {}): HTMLButtonElement {
  const kind = opts.kind ?? (label ? 'primary' : 'icon');
  const attrs: Record<string, string> = { type: 'button' };
  if (opts.title) attrs['title'] = opts.title;
  if (!label && opts.title) attrs['aria-label'] = opts.title;
  const el = h(`button.btn.btn-${kind}`, attrs, opts.icon ? icon(opts.icon) : null, label ? h('span', {}, label) : null);
  el.addEventListener('click', onClick);
  return el;
}

/** Interrupteur on/off avec libellé ; le détail éventuel passe en infobulle. */
export function toggle(label: string, onChange: (on: boolean) => void, hint?: string): { row: HTMLElement; input: HTMLInputElement } {
  const input = h('input', { type: 'checkbox', role: 'switch' });
  input.addEventListener('change', () => onChange(input.checked));
  const attrs: Record<string, string> = {};
  if (hint) attrs['title'] = hint;
  const row = h('label.switch', attrs, h('span.switch-label', {}, label), input, h('span.switch-track', { 'aria-hidden': 'true' }));
  return { row, input };
}

export interface Gauge {
  row: HTMLElement;
  set(value: number, text: string, alert?: boolean): void;
}

/** Jauge segmentée (0–100) façon écran à cristaux. */
export function gauge(label: string, tone: string, leading?: IconName, segments = 12): Gauge {
  const cells = Array.from({ length: segments }, () => h('i.seg'));
  const value = h('span.gauge-value');
  const track = h('span.gauge-track', {}, ...cells);
  const row = h(`div.gauge.tone-${tone}`, {}, leading ? icon(leading) : h('i.ico.none'), h('span.gauge-label', {}, label), track, value);
  return {
    row,
    set(v, text, alert = false) {
      const lit = Math.round((Math.max(0, Math.min(100, v)) / 100) * segments);
      cells.forEach((c, i) => c.classList.toggle('on', i < lit));
      row.classList.toggle('alert', alert);
      value.textContent = text;
    },
  };
}

/** Petite étiquette en capitales. */
export function chip(text: string, tone = ''): HTMLElement {
  return h(`span.chip${tone ? `.${tone}` : ''}`, {}, text);
}

/** Titre de rubrique : `// SOINS`. */
export function heading(text: string): HTMLElement {
  return h('h3.sec-title', {}, text);
}
