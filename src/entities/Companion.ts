import { createConsiderations, createStates } from '../ai/behaviors';
import { StateMachine } from '../ai/StateMachine';
import { UtilityAI } from '../ai/UtilityAI';
import type { Sfx, SfxName } from '../audio/Sfx';
import { Animator } from '../engine/Animator';
import type { Activity, LoopSystem } from '../engine/GameLoop';
import type { AnimEvent, CompanionPack } from '../engine/pack';
import { isParticleKind, type ParticleKind, type Particles } from '../engine/Particles';
import { ballisticVelocity, Body, type StepResult } from '../engine/Physics';
import { SpriteLayer } from '../engine/SpriteLayer';
import type { World } from '../engine/World';
import type { BehaviorToggles, DesktopIcon, HitRect, ProfileParams } from '../platform/bridge';
import type { CompanionStats } from './CompanionStats';
import type { Toy, ToyBox } from './Toy';

export type Trait = 'playful' | 'lazy' | 'curious' | 'social' | 'brave' | 'glutton' | 'mischievous';

/** Accès aux « bêtises » et au bureau (implémentés côté Rust). */
export interface DesktopServices {
  icons(): Promise<DesktopIcon[]>;
  moveIcon(index: number, x: number, y: number): Promise<void>;
  nudgeWindow(id: number, edge: 'left' | 'right', dx: number): Promise<number>;
  poke(x: number, y: number): Promise<boolean>;
}

/** Ce que le compagnon porte dans ses bras. */
export type Carried = { kind: 'icon'; icon: DesktopIcon } | { kind: 'toy'; toy: Toy };

export interface CompanionServices {
  desktop: DesktopServices;
  world: World;
  toys: ToyBox;
  stats: CompanionStats;
  particles: Particles;
  sfx: Sfx;
  say(text: string, seconds?: number): void;
  onDragStateChanged(dragging: boolean): void;
  onDoubleClick(): void;
  requestWake(): void;
  /** A franchi un bord relié à l'écran d'un autre joueur. */
  onCross?(companion: Companion, side: import('../engine/World').Side): void;
}

export interface CursorState {
  x: number;
  y: number;
  near: boolean;
  /** Vitesse en px CSS/s, lissée. */
  speed: number;
  at: number;
}

const DRAG_THRESHOLD = 6;
const MAX_THROW_SPEED = 1600;
/** Distance de survol (px) à accumuler pour qu'un passage de souris soit une caresse. */
const PET_DISTANCE = 140;
/** Secousse : distance parcourue et changements de direction sur une fenêtre glissante. */
const SHAKE_WINDOW_MS = 1200;
const SHAKE_DISTANCE = 3200;
const SHAKE_REVERSALS = 5;
/** Une icône portée suit le compagnon à 10 Hz (chaque déplacement est un appel système). */
const ICON_FOLLOW_MS = 100;

/** Réflexes (bug, faim, épuisement) réévalués deux fois par seconde. */
const REFLEX_INTERVAL = 0.5;
/**
 * Actions vers un objet : si le compagnon doit sauter ou se laisser tomber pour
 * l'atteindre, il reprend la même action après l'atterrissage.
 */
const RESUMABLE = new Set(['eat', 'play_ball', 'train', 'code', 'chase_bug']);

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;

/**
 * Le compagnon : corps physique, animations du pack, jauges et IA. Il expose des
 * primitives simples (marcher, sauter, animer, parler) utilisées par les états
 * définis dans `ai/behaviors.ts`, et choisis par l'IA utilitaire.
 */
export class Companion implements LoopSystem {
  readonly pack: CompanionPack;
  readonly world: World;
  readonly toys: ToyBox;
  readonly stats: CompanionStats;
  readonly body: Body;
  readonly animator: Animator;
  readonly fsm: StateMachine<Companion>;
  readonly ai: UtilityAI<Companion>;
  readonly traits: Record<Trait, number>;
  readonly cursor: CursorState = { x: 0, y: 0, near: false, speed: 0, at: 0 };

  behaviors: BehaviorToggles;
  facing: 1 | -1 = 1;
  menuOpen = false;
  /** Dernière caresse détectée (ms) : l'état `pet` dure tant qu'on caresse. */
  petActiveUntil = 0;
  /** Cible horizontale pendant la mise en place d'un combat. */
  fightTargetX: number | null = null;
  /** Position du compagnon d'un ami en visite (null s'il n'y en a pas). */
  friend: (() => { x: number; y: number; name: string }) | null = null;
  /** Objet porté (icône du bureau ou fichier) : suit ses mains. */
  carrying: Carried | null = null;
  /** Fichier reçu par glisser-déposer, en attente d'être étudié. */
  pendingFile: { name: string; iconIndex: number | null } | null = null;
  /** Secoué trop fort pendant le glisser : il sera malade en se posant. */
  private sickPending = false;
  private shaken = false;
  /** Lancé (par la souris ou en arrivant d'un autre écran) : il peut franchir un bord relié. */
  private thrown = false;
  /** Parti explorer l'écran d'un voisin (promenade) : il peut franchir un bord relié. */
  exploring = false;
  private lastIconMove = 0;

  private readonly services: CompanionServices;
  private readonly layer: SpriteLayer;
  private readonly shadow: HTMLDivElement;
  private profile: ProfileParams;
  private readonly recentActions = new Map<string, number>();
  private needsTimer = 0;
  private resume: string | null = null;
  private reflexTimer = 0;
  private drawnCell = '';
  private lastShadow = '';

  private pressed: { x: number; y: number } | null = null;
  private dragging = false;
  private badge: HTMLDivElement | null = null;
  /** Parti sur l'écran d'un autre joueur : ni simulé, ni affiché ici. */
  away = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private dragSamples: Array<{ t: number; x: number; y: number }> = [];
  private petDistance = 0;
  private lastPointer: { x: number; y: number; t: number } | null = null;

  constructor(
    stage: HTMLElement,
    pack: CompanionPack,
    services: CompanionServices,
    settings: { behaviors: BehaviorToggles; profile: ProfileParams },
    options: {
      /** Arrivée depuis l'écran d'un autre joueur : position et vitesse d'entrée. */
      spawn?: { x: number; y: number; vx: number; vy: number; facing: 1 | -1 };
      /** Badge affiché sous un compagnon visiteur (nom de son propriétaire). */
      label?: { text: string; color: string };
    } = {},
  ) {
    this.pack = pack;
    this.services = services;
    this.world = services.world;
    this.toys = services.toys;
    this.stats = services.stats;
    this.behaviors = settings.behaviors;
    this.profile = settings.profile;

    const w = pack.manifest.personalityWeights;
    this.traits = {
      playful: w['playful'] ?? 1,
      lazy: w['lazy'] ?? 1,
      curious: w['curious'] ?? 1,
      social: w['social'] ?? 1,
      brave: w['brave'] ?? 1,
      glutton: w['glutton'] ?? 1,
      mischievous: w['mischievous'] ?? 1,
    };

    const { frameWidth, frameHeight, scale = 3 } = pack.manifest.sprite;
    this.shadow = document.createElement('div');
    this.shadow.className = 'shadow';
    stage.append(this.shadow);
    this.layer = new SpriteLayer(stage, frameWidth, frameHeight, scale);
    this.layer.canvas.classList.add('companion');
    this.world.setHeadroom(this.layer.displayHeight);

    const s = this.layer.scale;
    this.body = new Body(0, 0, (pack.manifest.hitbox.width * s) / 2, frameHeight * s);
    this.animator = new Animator(pack.animations, 'fall', (e, anim) => this.onAnimEvent(e, anim));

    if (options.spawn) {
      // Arrivée par un bord relié : il garde sa vitesse et sa direction.
      this.body.x = options.spawn.x;
      this.body.y = options.spawn.y;
      this.body.launch(options.spawn.vx, options.spawn.vy);
      this.thrown = true;
      this.facing = options.spawn.facing;
      this.recentActions.set('arrived', performance.now());
    } else {
      // Apparition : tombe du haut de l'écran principal, au centre.
      const floor = this.world.floors[0];
      this.body.x = floor ? (floor.x1 + floor.x2) / 2 : window.innerWidth / 2;
      this.body.y = this.world.bounds.top + this.layer.displayHeight + 20;
    }
    if (options.label) {
      this.badge = document.createElement('div');
      this.badge.className = 'visitor-badge';
      this.badge.textContent = options.label.text;
      this.badge.style.setProperty('--player', options.label.color);
      stage.append(this.badge);
    }

    this.ai = new UtilityAI(createConsiderations());
    this.fsm = new StateMachine<Companion>(this, createStates(), 'fall', () => this.decide());
    this.fsm.start();
    this.bindPointer();
  }

  // --- Primitives utilisées par les comportements ---------------------------------

  /** Hauteur affichée du compagnon (unité de distance des comportements). */
  get h(): number {
    return this.layer.displayHeight;
  }

  get halfW(): number {
    return this.body.halfWidth;
  }

  /** Taille à l'écran d'un pixel du sprite (px CSS). */
  /** L'image doit-elle être retournée ? (le dessin d'origine regarde vers `sprite.facing`) */
  private get mirrored(): boolean {
    const drawnLeft = this.pack.manifest.sprite.facing === 'left';
    return (this.facing === -1) !== drawnLeft;
  }

  get px(): number {
    return this.layer.scale;
  }

  /** Message du prochain coucou (apparition, retour à l'écran). */
  greeting: string | null = null;

  /** Fait un coucou dès que possible (tout de suite s'il est posé et disponible). */
  greet(text: string): void {
    this.greeting = text;
    if (this.body.grounded && this.fsm.interrupt('greet', 22)) this.wakeLoop();
  }

  get state(): string {
    return this.fsm.name;
  }

  anim(name: string, restart = false): void {
    this.animator.play(name, restart);
  }

  holdAnim(name: string, frame: number): void {
    this.animator.hold(name, frame);
  }

  /** L'animation non bouclée lancée est terminée (ou a enchaîné sur une autre). */
  animDone(name: string): boolean {
    return this.animator.name !== name || this.animator.isFinished;
  }

  /** Marche/course pilotée dans une direction ; `speed` en multiples de la marche. */
  walk(dir: 1 | -1, speed: number, dt: number): StepResult {
    this.facing = dir;
    this.body.driven = true;
    this.body.vx = dir * this.h * 0.9 * speed;
    return this.body.step(this.world, dt);
  }

  /** Reste sur place (suit sa plateforme, friction). */
  stand(dt: number): StepResult {
    this.body.driven = false;
    return this.body.step(this.world, dt);
  }

  stop(): void {
    this.body.driven = false;
    this.body.vx = 0;
  }

  face(x: number): void {
    if (Math.abs(x - this.body.x) > 4) this.facing = x > this.body.x ? 1 : -1;
  }

  say(text: string, seconds = 3): void {
    this.services.say(text, seconds);
  }

  emit(kind: ParticleKind, force = false): void {
    const top = this.body.y - this.h;
    this.services.particles.emit(kind, this.body.x + this.facing * this.halfW * 0.4, top, force);
  }

  /** Particule à une position précise (onde de clic, etc.). */
  emitAt(kind: ParticleKind, x: number, y: number): void {
    this.services.particles.emit(kind, x, y, true);
  }

  sfx(name: SfxName): void {
    this.services.sfx.play(name);
  }

  /** Vitesse initiale d'un saut vers (x, y), ou null si hors de portée. */
  planJump(x: number, y: number): { vx: number; vy: number } | null {
    const rise = this.body.y - y;
    if (rise > this.h * 6 || Math.abs(x - this.body.x) > this.h * 7) return null;
    return ballisticVelocity(this.body.x, this.body.y, x, y, this.h * 0.5, this.h * 12);
  }

  /** Mémorise qu'une action vient d'avoir lieu (pour éviter les répétitions). */
  mark(action: string): void {
    this.recentActions.set(action, performance.now());
  }

  /** L'action a-t-elle eu lieu dans les `seconds` dernières secondes ? */
  recent(action: string, seconds: number): boolean {
    const at = this.recentActions.get(action);
    return at !== undefined && performance.now() - at < seconds * 1000;
  }

  cursorDistance(): number {
    return Math.hypot(this.cursor.x - this.body.x, this.cursor.y - (this.body.y - this.h / 2));
  }

  wakeLoop(): void {
    this.services.requestWake();
  }

  get desktop(): DesktopServices {
    return this.services.desktop;
  }

  /** Position des mains quand il porte quelque chose devant lui (px CSS). */
  handsPoint(): { x: number; y: number } {
    return { x: this.body.x + this.facing * this.px * 1, y: this.body.y - this.h * 0.36 };
  }

  /** Commence à porter un objet (icône ou jouet). */
  carry(item: Carried): void {
    if (item.kind === 'toy') item.toy.held = true;
    this.carrying = item;
    this.lastIconMove = 0;
  }

  /**
   * Dépose l'objet porté. Une icône est posée au sol devant lui ; un jouet retrouve
   * sa physique. Renvoie l'objet déposé.
   */
  drop(): Carried | null {
    const item = this.carrying;
    this.carrying = null;
    if (!item) return null;
    if (item.kind === 'toy') {
      item.toy.held = false;
      item.toy.body.launch(this.facing * 60, -120);
    } else {
      const { icon } = item;
      const x = this.body.x + this.facing * (this.halfW + icon.w / 2) - icon.w / 2;
      const y = this.body.y - icon.h - 2;
      icon.x = x;
      icon.y = y;
      this.desktop.moveIcon(icon.index, x, y).catch(() => undefined);
    }
    return item;
  }

  /** Un fichier le survole : il tend les bras (une fois par survol). */
  expectFile(): void {
    if (this.recent('expect_file', 4) || this.fsm.current.airborne) return;
    this.mark('expect_file');
    this.facing = 1;
    this.anim('carry_idle');
    this.say(pick(['Oh ? Donne !', 'C’est pour moi ?', 'Un cadeau ? 👀']), 2);
    this.wakeLoop();
  }

  /** Fichier lâché sur lui depuis l'explorateur. */
  receiveFile(name: string, iconIndex: number | null): void {
    this.pendingFile = { name, iconIndex };
    if (this.fsm.interrupt('study_file', 26)) this.wakeLoop();
  }

  // --- Entrées externes -------------------------------------------------------------

  setBehaviors(behaviors: BehaviorToggles): void {
    this.behaviors = behaviors;
  }

  setProfile(profile: ProfileParams): void {
    this.profile = profile;
    this.lastShadow = '';
  }

  /** Position du curseur reçue de Rust (seulement quand il est proche). */
  onCursor(x: number, y: number, near: boolean): void {
    const now = performance.now();
    const dt = (now - this.cursor.at) / 1000;
    const instant = dt > 0 && dt < 0.5 ? Math.hypot(x - this.cursor.x, y - this.cursor.y) / dt : 0;
    this.cursor.speed = this.cursor.speed * 0.5 + instant * 0.5;
    Object.assign(this.cursor, { x, y, near, at: now });

    // Un mouvement brusque tout près : il sursaute.
    if (
      near &&
      this.behaviors.mouseInteractions &&
      this.cursor.speed > 2600 &&
      this.cursorDistance() < this.h * 1.8 &&
      !this.recent('scared', 8)
    ) {
      if (this.fsm.interrupt('scared', 25)) this.wakeLoop();
    }
  }

  /** Nouveau relevé des fenêtres : suit la fenêtre porteuse ou tombe. */
  onWorldChanged(): void {
    if (this.fsm.current.airborne) return;
    if (this.body.reattach(this.world)) {
      this.fsm.go('fall');
      this.wakeLoop();
    }
  }

  openMenu(open: boolean): void {
    this.menuOpen = open;
    if (open) this.fsm.interrupt('menu', 55);
    else if (this.fsm.name === 'menu') this.fsm.go('idle', { duration: 1 });
  }

  /** Bubble anchor (haut de la tête), en px CSS. */
  bubbleAnchor(): { x: number; y: number } {
    const { feet, bubble } = this.pack.manifest.anchorPoints;
    const s = this.layer.scale;
    return { x: this.body.x + (bubble.x - feet.x) * s * (this.mirrored ? -1 : 1), y: this.body.y + (bubble.y - feet.y) * s };
  }

  hitRect(): HitRect | null {
    if (this.away) return null;
    const { frameWidth: fw } = this.pack.manifest.sprite;
    const s = this.layer.scale;
    const hb = this.pack.manifest.hitbox;
    const feet = this.pack.manifest.anchorPoints.feet;
    const flip = this.mirrored;
    const left = this.body.x - (flip ? fw - feet.x : feet.x) * s;
    const top = this.body.y - feet.y * s;
    const hx = flip ? fw - hb.x - hb.width : hb.x;
    // Hitbox publiée à ~10 Hz : élargie de la distance parcourue en 150 ms.
    const moving = !this.dragging;
    const padX = moving ? Math.abs(this.body.vx) * 0.15 : 0;
    const padY = moving ? Math.abs(this.body.vy) * 0.15 : 0;
    return {
      x: left + hx * s - padX,
      y: top + hb.y * s - padY,
      w: hb.width * s + padX * 2,
      h: hb.height * s + padY * 2,
    };
  }

  // --- Boucle -------------------------------------------------------------------

  update(dt: number): void {
    if (this.away) return;
    if (this.thrown && this.body.grounded) this.thrown = false;
    this.body.crossLinks = this.thrown || this.exploring;
    this.animator.update(dt);

    this.needsTimer += dt;
    if (this.needsTimer >= 1) {
      this.stats.tick(this.needsTimer, this.fsm.name === 'sleep');
      this.needsTimer = 0;
    }

    this.reflexTimer += dt;
    if (this.reflexTimer >= REFLEX_INTERVAL) {
      this.reflexTimer = 0;
      this.reflexes();
    }

    if (!this.fsm.current.airborne && !this.body.grounded && !this.dragging) {
      if (RESUMABLE.has(this.fsm.name)) this.resume = this.fsm.name;
      this.fsm.go('fall');
    }
    const before = this.fsm.name;
    this.fsm.update(dt);
    // Un saut lancé par une action vers un objet : on la reprendra après l'atterrissage.
    if (before !== this.fsm.name && this.fsm.name === 'jump' && RESUMABLE.has(before)) this.resume = before;

    // Franchissement d'un bord relié : il part chez le joueur voisin.
    if (!this.dragging && this.fsm.name !== 'fight' && this.services.onCross) {
      const side = this.world.exitSide(this.body);
      if (side) this.services.onCross(this, side);
    }
  }

  /** Lancé comme à la souris : il vole, et peut franchir un bord relié. */
  fling(vx: number, vy: number): void {
    this.body.ground = null;
    this.body.launch(vx, vy);
    this.thrown = true;
    this.fsm.go('fall');
    this.wakeLoop();
  }

  /** Secoué récemment : il aura la tête qui tourne en atterrissant (transmis d'écran en écran). */
  get queasy(): boolean {
    return this.sickPending || this.shaken || this.fsm.name === 'dizzy';
  }

  /** Il atterrira étourdi (secoué juste avant de changer d'écran). */
  makeQueasy(): void {
    this.sickPending = true;
    this.shaken = false;
    this.wakeLoop();
  }

  /** Part sur l'écran d'un autre joueur (masqué et figé ici). */
  goAway(): void {
    if (this.carrying) this.drop();
    // Son état (étourdi…) part avec lui : il ne le retrouvera pas à son retour.
    this.sickPending = false;
    this.shaken = false;
    this.away = true;
    this.menuOpen = false;
    this.layer.canvas.style.display = 'none';
    this.shadow.style.display = 'none';
    this.lastShadow = '';
    if (this.badge) this.badge.style.display = 'none';
  }

  /** Revient sur cet écran à une position et une vitesse données. */
  comeBack(spawn: { x: number; y: number; vx: number; vy: number; facing: 1 | -1; queasy?: boolean }): void {
    this.away = false;
    this.layer.canvas.style.display = '';
    if (this.badge) this.badge.style.display = '';
    this.body.x = spawn.x;
    this.body.y = spawn.y;
    this.body.launch(spawn.vx, spawn.vy);
    this.facing = spawn.facing;
    this.mark('arrived');
    this.thrown = true;
    if (spawn.queasy) this.sickPending = true;
    this.fsm.go('fall');
    this.wakeLoop();
  }

  /** Retire définitivement ce compagnon de l'écran (visiteur reparti). */
  destroy(): void {
    this.away = true;
    if (this.carrying) this.drop();
    this.layer.destroy();
    this.shadow.remove();
    this.badge?.remove();
  }

  render(): void {
    if (this.away) return;
    const { frameWidth: fw, frameHeight: fh } = this.pack.manifest.sprite;
    const { col, row } = this.animator.cell;
    const flip = this.mirrored;
    const key = `${col},${row},${flip ? 1 : 0}`;
    if (key !== this.drawnCell) {
      this.layer.drawFrame(this.pack.image, col * fw, row * fh, fw, fh, flip);
      this.drawnCell = key;
    }
    const s = this.layer.scale;
    const feet = this.pack.manifest.anchorPoints.feet;
    this.layer.setPosition(this.body.x - (flip ? fw - feet.x : feet.x) * s, this.body.y - feet.y * s);
    this.renderCarried();
    this.renderShadow();
    if (this.badge) {
      this.badge.style.transform = `translate3d(${Math.round(this.body.x)}px, ${Math.round(this.body.y + 4)}px, 0) translate(-50%, 0)`;
    }
  }

  activity(): Activity {
    if (this.away) return 'dormant';
    return this.dragging ? 'active' : this.fsm.current.activity;
  }

  // --- Décisions ------------------------------------------------------------------

  private decide(): { to: string; params?: unknown } {
    if (this.menuOpen) return { to: 'menu' };
    if (this.sickPending) {
      this.sickPending = false;
      return { to: 'dizzy' };
    }
    if (this.pendingFile) return { to: 'study_file' };
    if (this.greeting) return { to: 'greet' };
    if (this.resume) {
      const action = this.resume;
      this.resume = null;
      return { to: action };
    }
    const d = this.ai.choose(this);
    this.mark(d.action);
    return { to: d.action, params: d.params };
  }

  /** Réactions prioritaires, indépendantes du choix en cours. */
  private reflexes(): void {
    const n = this.stats.needs;
    if (n.energy < 8 && this.fsm.interrupt('sleep', 12)) return;
    if (this.toys.has('bug') && this.fsm.interrupt('chase_bug', 14)) return;
    if (n.hunger < 40 && this.toys.nearestFood(this.body.x) && this.fsm.interrupt('eat', 13)) return;
  }

  private onAnimEvent(event: AnimEvent, animation: string): void {
    this.fsm.current.onAnimEvent?.(this, event);
    switch (event.type) {
      case 'sound': {
        const clip = event.id ? this.pack.sounds[event.id] : undefined;
        if (clip) this.services.sfx.playClip(clip);
        return;
      }
      case 'particle':
      case 'emote': {
        if (!event.id || !isParticleKind(event.id)) return;
        const at = event.anchor ? this.anchorAt(event.anchor) : null;
        if (!at) return this.emit(event.id, event.type === 'emote');
        const off = event.offset ?? { x: 0, y: 0 };
        this.services.particles.emit(event.id, at.x + off.x * this.px * (this.mirrored ? -1 : 1), at.y + off.y * this.px, event.type === 'emote');
        return;
      }
      case 'footstep':
        if (animation === 'run' && Math.random() < 0.35) this.services.particles.emit('dust', this.body.x, this.body.y - 4);
        return;
      default:
    }
  }

  /** Position écran d'un point d'attache du pack (px CSS), ou null s'il n'existe pas. */
  anchorAt(name: string): { x: number; y: number } | null {
    const p = this.pack.manifest.anchorPoints[name];
    if (!p) return null;
    const { feet } = this.pack.manifest.anchorPoints;
    const s = this.layer.scale;
    return { x: this.body.x + (p.x - feet.x) * s * (this.mirrored ? -1 : 1), y: this.body.y + (p.y - feet.y) * s };
  }

  private renderCarried(): void {
    const item = this.carrying;
    if (!item) return;
    const hands = this.handsPoint();
    if (item.kind === 'toy') {
      const b = item.toy.body;
      b.x = hands.x;
      b.y = hands.y + b.height * 0.55;
      b.vx = 0;
      b.vy = 0;
      return;
    }
    // L'icône est dessinée par l'explorateur, derrière l'overlay : il la tient devant lui.
    const now = performance.now();
    if (now - this.lastIconMove < ICON_FOLLOW_MS) return;
    this.lastIconMove = now;
    const { icon } = item;
    icon.x = hands.x - icon.w / 2;
    icon.y = hands.y - icon.h * 0.6;
    this.desktop.moveIcon(icon.index, icon.x, icon.y).catch(() => {
      // Organisation automatique, explorateur redémarré… : il lâche l'icône.
      if (this.carrying === item) this.carrying = null;
    });
  }

  // --- Ombre portée (profil Haute qualité) ---------------------------------------

  private renderShadow(): void {
    let css = 'none';
    if (this.profile.shadows && !this.dragging) {
      const below = this.world.surfaceBelow(this.body.x, this.body.y);
      if (below) {
        const k = Math.max(0.25, 1 - (below.y - this.body.y) / 400);
        const w = this.halfW * 1.6 * k;
        css = `translate3d(${Math.round(this.body.x - w / 2)}px, ${Math.round(below.y - 4)}px, 0)|${Math.round(w)}|${k.toFixed(2)}`;
      }
    }
    if (css === this.lastShadow) return;
    this.lastShadow = css;
    if (css === 'none') {
      this.shadow.style.display = 'none';
      return;
    }
    const [transform, width, opacity] = css.split('|') as [string, string, string];
    this.shadow.style.display = 'block';
    this.shadow.style.transform = transform;
    this.shadow.style.width = `${width}px`;
    this.shadow.style.opacity = opacity;
  }

  // --- Secousse ----------------------------------------------------------------------

  private shakeSamples: Array<{ t: number; x: number; y: number }> = [];

  /**
   * Secouer = parcourir beaucoup de distance en changeant souvent de direction. Un
   * simple lancer rapide (une seule direction) ne compte pas.
   */
  private trackShake(t: number, x: number, y: number): void {
    const s = this.shakeSamples;
    s.push({ t, x, y });
    while (s.length > 0 && t - s[0]!.t > SHAKE_WINDOW_MS) s.shift();
    if (this.shaken || s.length < 6) return;
    let distance = 0;
    let reversals = 0;
    let lastDirX = 0;
    let lastDirY = 0;
    for (let i = 1; i < s.length; i++) {
      const dx = s[i]!.x - s[i - 1]!.x;
      const dy = s[i]!.y - s[i - 1]!.y;
      distance += Math.hypot(dx, dy);
      const dirX = Math.abs(dx) > 4 ? Math.sign(dx) : 0;
      const dirY = Math.abs(dy) > 4 ? Math.sign(dy) : 0;
      if (dirX !== 0 && lastDirX !== 0 && dirX !== lastDirX) reversals++;
      if (dirY !== 0 && lastDirY !== 0 && dirY !== lastDirY) reversals++;
      if (dirX !== 0) lastDirX = dirX;
      if (dirY !== 0) lastDirY = dirY;
    }
    if (distance > SHAKE_DISTANCE && reversals >= SHAKE_REVERSALS) {
      this.shaken = true;
      this.emit('sweat', true);
      this.say(pick(['Arrêêête !', 'Ça tourne…', 'Wouaaah !']), 1.5);
    }
  }

  // --- Souris : glisser, lancer, caresser, double-clic ------------------------------

  private bindPointer(): void {
    const el = this.layer.canvas;

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      this.pressed = { x: e.clientX, y: e.clientY };
      this.dragOffsetX = this.body.x - e.clientX;
      this.dragOffsetY = this.body.y - e.clientY;
      this.dragSamples = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }];
      this.services.onDragStateChanged(true);
    });

    el.addEventListener('pointermove', (e) => {
      if (this.pressed) {
        if (!this.dragging && Math.hypot(e.clientX - this.pressed.x, e.clientY - this.pressed.y) > DRAG_THRESHOLD) {
          this.dragging = true;
          el.classList.add('dragging');
          this.body.ground = null;
          this.body.vx = 0;
          this.body.vy = 0;
          this.resume = null;
          if (this.carrying) this.drop();
          this.shakeSamples = [];
          this.fsm.go('dragged');
          this.wakeLoop();
        }
        if (this.dragging) {
          const b = this.world.bounds;
          this.body.x = Math.min(Math.max(e.clientX + this.dragOffsetX, b.left + this.halfW), b.right - this.halfW);
          this.body.y = Math.min(Math.max(e.clientY + this.dragOffsetY, b.top + this.body.height), b.bottom);
          this.dragSamples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
          if (this.dragSamples.length > 6) this.dragSamples.shift();
          this.trackShake(e.timeStamp, e.clientX, e.clientY);
        }
        return;
      }
      // Survol sans bouton : un va-et-vient de la souris est une caresse.
      if (!this.behaviors.mouseInteractions) return;
      const last = this.lastPointer;
      this.lastPointer = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      if (!last || e.timeStamp - last.t > 400) {
        this.petDistance = 0;
        return;
      }
      this.petDistance += Math.hypot(e.clientX - last.x, e.clientY - last.y);
      if (this.petDistance > PET_DISTANCE) {
        this.petActiveUntil = performance.now() + 900;
        if (this.fsm.name !== 'pet' && this.fsm.interrupt('pet', 20)) this.wakeLoop();
      }
    });

    el.addEventListener('pointerleave', () => {
      this.petDistance = 0;
      this.lastPointer = null;
    });

    const release = (e: PointerEvent): void => {
      if (!this.pressed) return;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      this.pressed = null;
      if (this.dragging) {
        this.dragging = false;
        el.classList.remove('dragging');
        const first = this.dragSamples[0];
        const last = this.dragSamples[this.dragSamples.length - 1];
        const span = first && last ? (last.t - first.t) / 1000 : 0;
        const clamp = (v: number): number => Math.max(-MAX_THROW_SPEED, Math.min(MAX_THROW_SPEED, v));
        const vx = first && last && span > 0.01 ? clamp((last.x - first.x) / span) : 0;
        const vy = first && last && span > 0.01 ? clamp((last.y - first.y) / span) : 0;
        this.body.launch(vx, vy);
        this.thrown = true;
        this.stats.interact();
        if (this.shaken) {
          this.sickPending = true;
          this.shaken = false;
        }
        this.shakeSamples = [];
        this.fsm.go('fall');
      } else if (this.fsm.name === 'sleep') {
        // Un clic réveille en douceur.
        this.fsm.go('yawn');
      }
      this.services.onDragStateChanged(false);
      this.wakeLoop();
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('dblclick', () => this.services.onDoubleClick());
  }
}
