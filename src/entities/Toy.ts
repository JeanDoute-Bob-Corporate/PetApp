import type { Activity, LoopSystem } from '../engine/GameLoop';
import { Body, type BodyOptions } from '../engine/Physics';
import { SpriteLayer } from '../engine/SpriteLayer';
import type { World } from '../engine/World';
import type { HitRect } from '../platform/bridge';
import type { FoodKind, PlacedToy, ToyKind } from './CompanionStats';

/**
 * Jouets persistants, notes en boule de papier (persistées), et objets éphémères
 * (aliments posés, bugs à attraper, fichier porté par le compagnon).
 */
export type ItemKind = ToyKind | 'food' | 'bug' | 'note' | 'file';

/** Objets dont plusieurs exemplaires peuvent coexister. */
const MULTIPLE: ReadonlySet<ItemKind> = new Set(['food', 'bug', 'note', 'file']);

export interface ToyAtlas {
  image: HTMLImageElement;
  cell: number;
  sprites: Record<string, number>;
}

export async function loadToyAtlas(baseUrl = '/toys/'): Promise<ToyAtlas> {
  const res = await fetch(`${baseUrl}toys.json`);
  if (!res.ok) throw new Error(`toys.json : HTTP ${res.status}`);
  const meta = (await res.json()) as { cell: number; sprites: Record<string, number> };
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('toys.png illisible'));
    image.src = `${baseUrl}toys.png`;
  });
  return { image, cell: meta.cell, sprites: meta.sprites };
}

interface KindDef {
  /** Demi-largeur et hauteur visibles, en pixels du sprite (case 24×24). */
  halfWidth: number;
  height: number;
  body?: BodyOptions;
}

const KINDS: Record<ItemKind, KindDef> = {
  ball: {
    halfWidth: 7.5,
    height: 15,
    body: { groundFriction: 1.2, bounceThreshold: 120, bounceRestitution: 0.55, wallRestitution: 0.7 },
  },
  bag: { halfWidth: 7, height: 23 },
  terminal: { halfWidth: 11, height: 19 },
  bowl: { halfWidth: 9, height: 8 },
  food: { halfWidth: 6, height: 13 },
  bug: { halfWidth: 5, height: 7 },
  note: {
    halfWidth: 6.5,
    height: 13,
    body: { groundFriction: 3, bounceThreshold: 160, bounceRestitution: 0.35, wallRestitution: 0.5 },
  },
  file: { halfWidth: 6, height: 18 },
};

export const TOY_LABELS: Record<ToyKind, string> = {
  ball: 'Balle rebondissante',
  bag: 'Sac de frappe',
  terminal: 'Terminal de code',
  bowl: 'Gamelle',
};

const SCALE = 2;
const DRAG_THRESHOLD = 6;
const BUG_SPEED = 45;
const BUG_LIFETIME = 120;

let nextId = 1;

export interface ToyHooks {
  /** L'objet a franchi un bord relié : il part chez le voisin. */
  onCross?(toy: Toy, side: import('../engine/World').Side): void;
  onDragStateChanged(dragging: boolean): void;
  requestWake(): void;
  onChanged(): void;
  /** Double-clic sur une boule de papier : on lit la note. */
  onOpenNote(toy: Toy): void;
}

export class Toy {
  readonly id = nextId++;
  readonly kind: ItemKind;
  food: FoodKind | null;
  /** Texte d'une note (boule de papier). */
  text = '';
  /** Nom d'un fichier porté. */
  label = '';
  /** Tenu par le compagnon : pas de physique, position imposée chaque frame. */
  held = false;
  /** Joueur à qui appartient l'objet (`''` : à nous). */
  owner = '';
  readonly body: Body;
  private readonly layer: SpriteLayer;
  private readonly atlas: ToyAtlas;
  private readonly world: World;
  private readonly hooks: ToyHooks;

  private angle = 0;
  private angularVelocity = 0;
  private dragging = false;
  private pressed: { x: number; y: number; ox: number; oy: number } | null = null;
  private samples: Array<{ t: number; x: number; y: number }> = [];
  private drawn = '';
  private time = 0;
  private bugDir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
  removed = false;

  constructor(
    stage: HTMLElement,
    atlas: ToyAtlas,
    world: World,
    hooks: ToyHooks,
    kind: ItemKind,
    x: number,
    y: number,
    food: FoodKind | null = null,
  ) {
    this.kind = kind;
    this.food = food;
    this.atlas = atlas;
    this.world = world;
    this.hooks = hooks;
    this.layer = new SpriteLayer(stage, atlas.cell, atlas.cell, SCALE);
    this.layer.canvas.classList.add('toy');
    const def = KINDS[kind];
    const s = this.layer.scale;
    this.body = new Body(x, y, def.halfWidth * s, def.height * s, def.body);
    // Seul un lancer (souris, note, arrivée d'un autre écran) traverse un bord relié.
    this.body.crossLinks = false;
    this.bindPointer();
  }

  get x(): number {
    return this.body.x;
  }

  get y(): number {
    return this.body.y;
  }

  get halfWidth(): number {
    return this.body.halfWidth;
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  get isEdible(): boolean {
    return (this.kind === 'food' && this.food !== null) || (this.kind === 'bowl' && this.food !== null);
  }

  // --- Interactions avec le compagnon ---------------------------------------------

  kick(vx: number, vy: number): void {
    this.body.launch(vx, vy);
    this.hooks.requestWake();
  }

  /** Coup dans le sac de frappe : il oscille. */
  hit(direction: 1 | -1): void {
    this.angularVelocity += 90 * direction;
    this.hooks.requestWake();
  }

  fill(food: FoodKind): void {
    this.food = food;
    this.hooks.onChanged();
  }

  /** Mange le contenu ; renvoie l'aliment consommé. */
  consume(): FoodKind | null {
    const food = this.food;
    this.food = null;
    if (this.kind === 'food') this.removed = true;
    this.hooks.onChanged();
    return food;
  }

  squash(): void {
    this.removed = true;
  }

  // --- Boucle -------------------------------------------------------------------

  update(dt: number): void {
    this.time += dt;
    if (this.kind === 'bug' && this.time > BUG_LIFETIME) this.removed = true;
    if (this.dragging || this.held) return;

    if (this.kind === 'bug' && this.body.grounded) {
      this.body.driven = true;
      this.body.vx = this.bugDir * BUG_SPEED;
      const ahead = this.body.x + this.bugDir * this.body.halfWidth;
      if (!this.world.supportAt(ahead, this.body.y) || Math.random() < dt * 0.3) {
        this.bugDir = this.bugDir === 1 ? -1 : 1;
      }
    }
    const res = this.body.step(this.world, dt);
    if (this.body.grounded) this.body.crossLinks = false;
    if (res.hitWall !== 0 && this.kind === 'bug') this.bugDir = res.hitWall === 1 ? -1 : 1;

    if (this.kind === 'bag') {
      // Ressort amorti : le sac revient à la verticale.
      this.angularVelocity += (-this.angle * 60 - this.angularVelocity * 6) * dt;
      this.angle += this.angularVelocity * dt;
      if (Math.abs(this.angle) < 0.05 && Math.abs(this.angularVelocity) < 0.5) {
        this.angle = 0;
        this.angularVelocity = 0;
      }
    }
  }

  render(): void {
    const sprite = this.spriteName();
    if (sprite !== this.drawn) {
      const col = this.atlas.sprites[sprite] ?? 0;
      const c = this.atlas.cell;
      this.layer.drawFrame(this.atlas.image, col * c, 0, c, c, this.kind === 'bug' && this.bugDir === -1);
      this.drawn = sprite;
    }
    const s = this.layer.scale;
    const c = this.atlas.cell;
    this.layer.setPosition(this.body.x - (c / 2) * s, this.body.y - c * s, this.angle);
  }

  activity(): Activity {
    if (this.held) return 'dormant'; // le compagnon qui le porte cadence déjà la boucle
    const moving = this.dragging || !this.body.grounded || Math.abs(this.body.vx) > 5 || this.angularVelocity !== 0;
    if (moving || this.kind === 'bug') return 'active';
    // Le terminal clignote doucement : la cadence idle suffit.
    return this.kind === 'terminal' ? 'idle' : 'dormant';
  }

  hitRect(): HitRect {
    const b = this.body;
    return { x: b.x - b.halfWidth, y: b.y - b.height, w: b.halfWidth * 2, h: b.height };
  }

  destroy(): void {
    this.layer.destroy();
  }

  private spriteName(): string {
    switch (this.kind) {
      case 'note':
      case 'file':
        return this.kind;
      case 'terminal':
        return Math.floor(this.time * 1.5) % 2 === 0 ? 'terminal0' : 'terminal1';
      case 'bowl':
        return this.food ? 'bowl_full' : 'bowl_empty';
      case 'food':
        return this.food ?? 'cookie';
      case 'bug':
        return Math.floor(this.time * 8) % 2 === 0 ? 'bug0' : 'bug1';
      default:
        return this.kind;
    }
  }

  private bindPointer(): void {
    const el = this.layer.canvas;
    if (this.kind === 'note') {
      el.title = 'Double-clic pour lire la note';
      el.addEventListener('dblclick', () => {
        if (!this.held && !this.removed) this.hooks.onOpenNote(this);
      });
    }
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.held) return;
      el.setPointerCapture(e.pointerId);
      this.pressed = { x: e.clientX, y: e.clientY, ox: this.body.x - e.clientX, oy: this.body.y - e.clientY };
      this.samples = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }];
      this.hooks.onDragStateChanged(true);
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.pressed;
      if (!p) return;
      if (!this.dragging && Math.hypot(e.clientX - p.x, e.clientY - p.y) > DRAG_THRESHOLD) {
        this.dragging = true;
        this.body.ground = null;
        el.classList.add('dragging');
      }
      if (!this.dragging) return;
      const b = this.world.bounds;
      this.body.x = Math.min(Math.max(e.clientX + p.ox, b.left + this.body.halfWidth), b.right - this.body.halfWidth);
      this.body.y = Math.min(Math.max(e.clientY + p.oy, b.top + this.body.height), b.bottom);
      this.samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
      if (this.samples.length > 6) this.samples.shift();
      this.hooks.requestWake();
    });
    const release = (e: PointerEvent): void => {
      if (!this.pressed) return;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      this.pressed = null;
      el.classList.remove('dragging');
      if (this.dragging) {
        this.dragging = false;
        const first = this.samples[0];
        const last = this.samples[this.samples.length - 1];
        const span = first && last ? (last.t - first.t) / 1000 : 0;
        const v = (d: number): number => (span > 0.01 ? Math.max(-1400, Math.min(1400, d / span)) : 0);
        this.body.launch(first && last ? v(last.x - first.x) : 0, first && last ? v(last.y - first.y) : 0);
        this.body.crossLinks = true;
        this.hooks.onChanged();
      } else if (this.kind === 'ball') {
        // Simple clic sur la balle : petite pichenette.
        this.kick((Math.random() - 0.5) * 500, -500);
      }
      this.hooks.onDragStateChanged(false);
      this.hooks.requestWake();
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
  }
}

/** Gestionnaire de tous les objets posés sur le bureau. */
export class ToyBox implements LoopSystem {
  readonly items: Toy[] = [];
  private readonly stage: HTMLElement;
  private readonly atlas: ToyAtlas;
  private readonly world: World;
  private readonly hooks: ToyHooks;
  private changeListeners = new Set<() => void>();
  /** Apparition spontanée de bugs (une toutes les 6 à 15 min). */
  private nextBugIn = 360 + Math.random() * 540;
  bugsEnabled = true;

  constructor(stage: HTMLElement, atlas: ToyAtlas, world: World, hooks: Omit<ToyHooks, 'onChanged'>) {
    this.stage = stage;
    this.atlas = atlas;
    this.world = world;
    this.hooks = { ...hooks, onChanged: () => this.changed() };
  }

  /** Branche la traversée des bords (fournie par le multijoueur). */
  setCrossHandler(handler: (toy: Toy, side: import('../engine/World').Side) => void): void {
    this.hooks.onCross = handler;
  }

  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  has(kind: ItemKind): boolean {
    return this.items.some((t) => t.kind === kind && !t.removed);
  }

  /** Jouet présent sur cet écran (le nôtre d'abord, sinon celui d'un visiteur). */
  find(kind: ItemKind): Toy | undefined {
    return (
      this.items.find((t) => t.kind === kind && !t.removed && t.owner === '') ??
      this.items.find((t) => t.kind === kind && !t.removed)
    );
  }

  /** Nos jouets uniquement (gestion du coffre). */
  hasOwn(kind: ItemKind): boolean {
    return this.items.some((t) => t.kind === kind && !t.removed && t.owner === '');
  }

  /** Aliment le plus proche (gamelle pleine ou aliment posé), hors objets tenus à la souris. */
  nearestFood(x: number): Toy | undefined {
    let best: Toy | undefined;
    for (const t of this.items) {
      if (t.removed || !t.isEdible || t.isDragging) continue;
      if (!best || Math.abs(t.x - x) < Math.abs(best.x - x)) best = t;
    }
    return best;
  }

  /** Pose un objet en (x, y) — il tombe ensuite avec la physique. */
  spawn(kind: ItemKind, x: number, y: number, food: FoodKind | null = null, owner = ''): Toy {
    // Un seul exemplaire de chaque jouet par joueur (ceux des visiteurs ne comptent pas).
    if (!MULTIPLE.has(kind)) this.items.find((t) => t.kind === kind && t.owner === owner && !t.removed)?.squash();
    const toy = new Toy(this.stage, this.atlas, this.world, this.hooks, kind, x, y, food);
    toy.owner = owner;
    this.items.push(toy);
    this.changed();
    this.hooks.requestWake();
    return toy;
  }

  remove(kind: ItemKind): void {
    const toy = this.items.find((t) => t.kind === kind && !t.removed && t.owner === '');
    if (toy) toy.removed = true;
    this.cleanup();
  }

  onWorldChanged(): void {
    for (const t of this.items) t.body.reattach(this.world);
  }

  serialize(): PlacedToy[] {
    return this.items
      .filter(
        (t): t is Toy & { kind: PlacedToy['kind'] } =>
          !t.removed && !t.held && t.owner === '' && t.kind !== 'food' && t.kind !== 'bug' && t.kind !== 'file',
      )
      .map((t) => ({
        kind: t.kind,
        x: Math.round(t.x),
        y: Math.round(t.y),
        food: t.kind === 'bowl' ? t.food : null,
        ...(t.kind === 'note' ? { text: t.text } : {}),
      }));
  }

  restore(placed: readonly PlacedToy[]): void {
    for (const p of placed) {
      const b = this.world.bounds;
      const x = Math.min(Math.max(p.x, b.left + 40), b.right - 40);
      // Réapparition un peu au-dessus : la physique les repose sur la bonne surface.
      const toy = this.spawn(p.kind, x, Math.min(p.y, b.bottom) - 30, p.food ?? null);
      if (p.kind === 'note') toy.text = p.text ?? '';
    }
  }

  hitRects(): HitRect[] {
    return this.items.filter((t) => !t.removed && !t.held).map((t) => t.hitRect());
  }

  update(dt: number): void {
    for (const t of this.items) {
      t.update(dt);
      if (t.removed || t.held || t.isDragging || t.kind === 'bug' || t.kind === 'file') continue;
      const side = this.world.exitSide(t.body);
      if (side && this.hooks.onCross) this.hooks.onCross(t, side);
    }
    this.cleanup();

    if (this.bugsEnabled && !this.has('bug')) {
      this.nextBugIn -= dt;
      if (this.nextBugIn <= 0) {
        this.nextBugIn = 360 + Math.random() * 540;
        this.spawnBug();
      }
    }
  }

  spawnBug(): void {
    const floor = this.world.floors[Math.floor(Math.random() * this.world.floors.length)];
    if (!floor) return;
    const x = floor.x1 + 60 + Math.random() * Math.max(0, floor.x2 - floor.x1 - 120);
    this.spawn('bug', x, floor.y - 20);
  }

  render(): void {
    for (const t of this.items) t.render();
  }

  activity(): Activity {
    let level: Activity = 'dormant';
    for (const t of this.items) {
      const a = t.activity();
      if (a === 'active') return 'active';
      if (a === 'idle') level = 'idle';
    }
    // Le compte à rebours des bugs ne justifie pas de réveiller la boucle : il avance
    // pendant les ticks idle du compagnon, qui ne s'endort jamais complètement.
    return level;
  }

  private cleanup(): void {
    let removed = false;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const t = this.items[i]!;
      if (t.removed) {
        t.destroy();
        this.items.splice(i, 1);
        removed = true;
      }
    }
    if (removed) this.changed();
  }

  private changed(): void {
    for (const l of this.changeListeners) l();
  }
}
