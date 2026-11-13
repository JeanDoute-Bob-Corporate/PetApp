import type { HitRect } from '../platform/bridge';
import type { IconName } from './iconNames';
import { ICON_NAMES } from './iconNames';

/** Construction DOM concise : `h('div.cls', { attr }, ...enfants)`. */
export function h<K extends keyof HTMLElementTagNameMap>(
  spec: K | `${K}.${string}`,
  attrs: Record<string, string | boolean> = {},
  ...children: Array<Node | string | null | undefined>
): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = spec.split('.') as [K, ...string[]];
  const el = document.createElement(tag);
  if (classes.length > 0) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue;
    el.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children) if (child != null) el.append(child);
  return el;
}

/** Icône inline (doublon minimal de kit.icon pour éviter une dépendance circulaire). */
function glyph(name: IconName): HTMLElement {
  const el = h('i.ico', { 'aria-hidden': 'true' });
  el.style.setProperty('--i', String(ICON_NAMES.indexOf(name)));
  return el;
}

/**
 * Fenêtre flottante « Byte OS » : barre de titre déplaçable, bouton fermer, zone
 * interactive publiée au hit-test uniquement quand elle est ouverte.
 */
export class Panel {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  protected readonly header: HTMLElement;
  protected readonly titleEl: HTMLElement;
  private rect: HitRect | null = null;
  private readonly onToggle: (open: boolean) => void;

  constructor(stage: HTMLElement, title: string, onToggle: (open: boolean) => void = () => undefined, titleIcon?: IconName) {
    this.onToggle = onToggle;
    const close = h('button.win-close', { type: 'button', 'aria-label': 'Fermer', title: 'Fermer' }, glyph('close'));
    this.titleEl = h('h2', {}, title);
    this.header = h('header.win-bar', {}, titleIcon ? glyph(titleIcon) : null, this.titleEl, h('span.win-fill'), close);
    this.body = h('div.win-body');
    this.el = h('section.win', { role: 'dialog', 'aria-label': title, hidden: true }, this.header, this.body);
    stage.append(this.el);

    close.addEventListener('click', () => this.close());
    this.makeDraggable(this.header);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** Ouvre centré sur `center` (px CSS), sauf s'il a déjà été placé. */
  open(center: { x: number; y: number }): void {
    if (this.isOpen) return;
    this.el.hidden = false;
    if (!this.el.dataset['placed']) {
      const r = this.el.getBoundingClientRect();
      this.moveTo(center.x - r.width / 2, center.y - r.height / 2);
    } else {
      this.keepInView();
    }
    this.measure();
    this.onToggle(true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.el.hidden = true;
    this.rect = null;
    this.onToggle(false);
  }

  toggle(center: { x: number; y: number }): void {
    if (this.isOpen) this.close();
    else this.open(center);
  }

  hitRect(): HitRect | null {
    return this.isOpen ? this.rect : null;
  }

  /** À rappeler si le contenu change de taille. */
  measure(): void {
    if (!this.isOpen) return;
    const r = this.el.getBoundingClientRect();
    this.rect = { x: r.x, y: r.y, w: r.width, h: r.height };
  }

  protected keepInView(): void {
    this.moveTo(this.el.offsetLeft, this.el.offsetTop);
  }

  private moveTo(x: number, y: number): void {
    const maxX = window.innerWidth - this.el.offsetWidth - 8;
    const maxY = window.innerHeight - this.el.offsetHeight - 8;
    this.el.style.left = `${Math.round(Math.max(8, Math.min(x, maxX)))}px`;
    this.el.style.top = `${Math.round(Math.max(8, Math.min(y, maxY)))}px`;
  }

  private makeDraggable(handle: HTMLElement): void {
    let start: { x: number; y: number; left: number; top: number } | null = null;
    handle.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      handle.setPointerCapture(e.pointerId);
      start = { x: e.clientX, y: e.clientY, left: this.el.offsetLeft, top: this.el.offsetTop };
    });
    handle.addEventListener('pointermove', (e) => {
      if (!start) return;
      this.moveTo(start.left + e.clientX - start.x, start.top + e.clientY - start.y);
      this.el.dataset['placed'] = '1';
      this.measure();
    });
    const end = (): void => {
      start = null;
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }
}

export interface TabSpec {
  id: string;
  icon: IconName;
  label: string;
}

/**
 * La Console : une seule fenêtre à onglets qui regroupe toutes les rubriques
 * (fiche, jouets, apparence, salon, réglages). Une rubrique est une `Section`.
 */
export class Console extends Panel {
  private readonly tabBar: HTMLElement;
  private readonly tabs = new Map<Section, HTMLButtonElement>();
  private readonly labels = new Map<Section, string>();
  private current: Section | null = null;
  private readonly name: () => string;

  /** `name` : nom du compagnon, affiché dans la barre de titre. */
  constructor(stage: HTMLElement, onToggle: (open: boolean) => void, name: () => string) {
    super(stage, 'Console', onToggle, 'console');
    this.name = name;
    this.el.classList.add('console');
    this.tabBar = h('nav.tabs', { role: 'tablist' });
    this.header.after(this.tabBar);
  }

  get active(): Section | null {
    return this.current;
  }

  register(section: Section, spec: TabSpec): void {
    const tab = h('button.tab', { type: 'button', role: 'tab', title: spec.label, 'aria-selected': 'false' }, glyph(spec.icon), h('span', {}, spec.label));
    tab.addEventListener('click', () => this.select(section));
    this.tabBar.append(tab);
    this.tabs.set(section, tab);
    this.labels.set(section, spec.label);
    section.root.dataset['tab'] = spec.id;
    section.root.hidden = true;
    this.body.append(section.root);
  }

  /** Ouvre la console sur une rubrique (ou bascule dessus si elle est déjà ouverte). */
  show(section: Section, center: { x: number; y: number }): void {
    if (this.isOpen) return this.select(section);
    this.activate(section);
    super.open(center);
    section.onShow();
    this.measure();
  }

  override open(center: { x: number; y: number }): void {
    const first = this.current ?? this.tabs.keys().next().value;
    if (first) this.show(first, center);
  }

  override close(): void {
    if (!this.isOpen) return;
    this.current?.onHide();
    super.close();
  }

  select(section: Section): void {
    if (section === this.current) return;
    this.current?.onHide();
    this.activate(section);
    section.onShow();
    this.keepInView();
    this.measure();
  }

  private activate(section: Section): void {
    if (this.current) this.current.root.hidden = true;
    this.current = section;
    section.root.hidden = false;
    for (const [s, tab] of this.tabs) tab.setAttribute('aria-selected', String(s === section));
    this.el.dataset['tab'] = section.root.dataset['tab'] ?? '';
    this.titleEl.textContent = `${this.name()} / ${this.labels.get(section) ?? ''}`.toUpperCase();
  }
}

/** Rubrique de la Console. Même API qu'une fenêtre : open/close/toggle/hitRect. */
export abstract class Section {
  readonly root: HTMLElement;
  /** Contenu de la rubrique. */
  readonly body: HTMLElement;
  protected readonly hub: Console;

  constructor(hub: Console, spec: TabSpec) {
    this.hub = hub;
    this.body = h('div.section-body');
    this.root = h('div.section', { role: 'tabpanel' }, this.body);
    hub.register(this, spec);
  }

  get isOpen(): boolean {
    return this.hub.isOpen && this.hub.active === this;
  }

  open(center: { x: number; y: number }): void {
    this.hub.show(this, center);
  }

  close(): void {
    if (this.isOpen) this.hub.close();
  }

  toggle(center: { x: number; y: number }): void {
    if (this.isOpen) this.close();
    else this.open(center);
  }

  hitRect(): HitRect | null {
    return this.isOpen ? this.hub.hitRect() : null;
  }

  measure(): void {
    this.hub.measure();
  }

  /** La rubrique devient visible. */
  onShow(): void {}
  /** La rubrique est masquée (autre onglet ou console fermée). */
  onHide(): void {}
}
