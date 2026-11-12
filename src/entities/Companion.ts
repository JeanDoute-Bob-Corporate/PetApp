import { Animator } from '../engine/Animator';
import type { Activity, LoopSystem } from '../engine/GameLoop';
import type { AnimEvent, CompanionPack } from '../engine/pack';
import { ballisticVelocity, Body, GRAVITY } from '../engine/Physics';
import { SpriteLayer } from '../engine/SpriteLayer';
import type { Segment, World } from '../engine/World';
import type { BehaviorToggles, HitRect, ProfileParams } from '../platform/bridge';

export interface CompanionHooks {
  onHitboxChanged(rect: HitRect): void;
  onDragStateChanged(dragging: boolean): void;
  onDoubleClick(): void;
  onAnimEvent(event: AnimEvent, animation: string): void;
  requestWake(): void;
}

/**
 * Modes de déplacement. C'est un contrôleur provisoire : l'étape 3 le remplacera par
 * la machine à états complète pilotée par l'IA utilitaire (besoins, personnalité).
 */
type Mode = 'idle' | 'walk' | 'prejump' | 'air' | 'land' | 'sit' | 'dragged';

const PREJUMP_TIME = 0.14;
const LAND_TIME = 0.14;
/** Anticipation d'atterrissage : on plie les jambes ~90 ms avant le contact. */
const LANDING_ANTICIPATION = 0.09;
const MAX_THROW_SPEED = 1600;

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class Companion implements LoopSystem {
  private readonly pack: CompanionPack;
  private readonly world: World;
  private readonly hooks: CompanionHooks;
  private readonly layer: SpriteLayer;
  private readonly shadow: HTMLDivElement;
  private readonly animator: Animator;
  private readonly body: Body;

  private behaviors: BehaviorToggles;
  private profile: ProfileParams;

  private mode: Mode = 'air';
  private modeTime = 0;
  private modeDuration = 0;
  private facing: 1 | -1 = 1;
  private pendingJump: { vx: number; vy: number } | null = null;

  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private dragSamples: Array<{ t: number; x: number; y: number }> = [];

  private drawnCell = '';
  private lastShadow = '';

  constructor(
    stage: HTMLElement,
    pack: CompanionPack,
    world: World,
    settings: { behaviors: BehaviorToggles; profile: ProfileParams },
    hooks: CompanionHooks,
  ) {
    this.pack = pack;
    this.world = world;
    this.hooks = hooks;
    this.behaviors = settings.behaviors;
    this.profile = settings.profile;

    const { frameWidth, frameHeight, scale = 3 } = pack.manifest.sprite;
    this.shadow = document.createElement('div');
    this.shadow.className = 'shadow';
    stage.append(this.shadow);
    this.layer = new SpriteLayer(stage, frameWidth, frameHeight, scale);
    world.setHeadroom(this.layer.displayHeight);

    const s = this.layer.scale;
    const hb = pack.manifest.hitbox;
    this.body = new Body(0, 0, (hb.width * s) / 2, frameHeight * s);
    this.animator = new Animator(pack.animations, 'fall', (e, anim) => hooks.onAnimEvent(e, anim));

    // Apparition : tombe du haut de l'écran principal, au centre.
    const floor = world.floors[0];
    this.body.x = floor ? (floor.x1 + floor.x2) / 2 : window.innerWidth / 2;
    this.body.y = world.bounds.top + this.layer.displayHeight + 20;
    this.enter('air');

    this.bindPointer();
  }

  /** Point d'attache des bulles, en px CSS. */
  bubbleAnchor(): { x: number; y: number } {
    const { feet, bubble } = this.pack.manifest.anchorPoints;
    const s = this.layer.scale;
    return { x: this.body.x + (bubble.x - feet.x) * s * this.facing, y: this.body.y + (bubble.y - feet.y) * s };
  }

  setBehaviors(behaviors: BehaviorToggles): void {
    this.behaviors = behaviors;
  }

  setProfile(profile: ProfileParams): void {
    this.profile = profile;
    this.lastShadow = '';
  }

  /** Nouveau relevé des fenêtres : suit la fenêtre porteuse ou tombe. */
  onWorldChanged(): void {
    if (this.mode === 'dragged') return;
    if (this.body.reattach(this.world) && this.mode !== 'air' && this.mode !== 'prejump') {
      this.enter('air');
      this.hooks.requestWake();
    }
  }

  // --- Boucle -------------------------------------------------------------------

  update(dt: number): void {
    this.modeTime += dt;
    this.animator.update(dt);

    switch (this.mode) {
      case 'dragged':
        return;

      case 'prejump':
        if (this.modeTime >= PREJUMP_TIME) {
          const jump = this.pendingJump;
          this.pendingJump = null;
          if (jump) this.body.launch(jump.vx, jump.vy);
          this.enter('air');
          this.animator.play('jump', true, 1);
        }
        return;

      case 'air': {
        const res = this.body.step(this.world, dt);
        if (Math.abs(this.body.vx) > 20) this.facing = this.body.vx > 0 ? 1 : -1;
        if (res.landed) {
          this.enter('land');
          return;
        }
        if (res.bounced) this.animator.play('jump', true, 2);
        this.updateAirAnimation();
        return;
      }

      case 'land':
        this.body.step(this.world, dt);
        if (this.modeTime >= LAND_TIME) this.decide();
        return;

      case 'walk': {
        const speed = this.layer.displayHeight * 0.9;
        this.body.driven = true;
        this.body.vx = this.facing * speed;
        // Bord d'une fenêtre : demi-tour ou on se laisse tomber.
        const ahead = this.body.x + this.facing * this.body.halfWidth * 0.6;
        if (this.body.onWindow && !this.world.supportAt(ahead, this.body.y) && Math.random() < 0.6) {
          this.facing = this.facing === 1 ? -1 : 1;
        }
        const res = this.body.step(this.world, dt);
        if (res.hitWall !== 0) this.facing = res.hitWall === 1 ? -1 : 1;
        if (res.lostGround) {
          this.body.driven = false;
          this.enter('air');
          return;
        }
        if (this.modeTime >= this.modeDuration) this.decide();
        return;
      }

      case 'idle':
      case 'sit': {
        const res = this.body.step(this.world, dt);
        if (res.lostGround) {
          this.enter('air');
          return;
        }
        if (this.modeTime >= this.modeDuration) this.decide();
        return;
      }
    }
  }

  render(): void {
    const { frameWidth: fw, frameHeight: fh } = this.pack.manifest.sprite;
    const { col, row } = this.animator.cell;
    const flip = this.facing === -1;
    const key = `${col},${row},${flip ? 1 : 0}`;
    if (key !== this.drawnCell) {
      this.layer.drawFrame(this.pack.image, col * fw, row * fh, fw, fh, flip);
      this.drawnCell = key;
    }

    const s = this.layer.scale;
    const feet = this.pack.manifest.anchorPoints.feet;
    const feetX = flip ? fw - feet.x : feet.x;
    const left = this.body.x - feetX * s;
    const top = this.body.y - feet.y * s;
    this.layer.setPosition(left, top);

    // La hitbox n'est publiée qu'à ~10 Hz : en mouvement, on l'élargit de la distance
    // parcourue en 150 ms pour que le survol reste détecté entre deux envois.
    const hb = this.pack.manifest.hitbox;
    const hx = flip ? fw - hb.x - hb.width : hb.x;
    const padX = this.mode === 'dragged' ? 0 : Math.abs(this.body.vx) * 0.15;
    const padY = this.mode === 'dragged' ? 0 : Math.abs(this.body.vy) * 0.15;
    this.hooks.onHitboxChanged({
      x: left + hx * s - padX,
      y: top + hb.y * s - padY,
      w: hb.width * s + padX * 2,
      h: hb.height * s + padY * 2,
    });

    this.renderShadow();
  }

  activity(): Activity {
    return this.mode === 'idle' || this.mode === 'sit' ? 'idle' : 'active';
  }

  // --- Décisions (provisoires, remplacées par l'IA à l'étape 3) -----------------

  private decide(): void {
    this.body.driven = false;
    const onWindow = this.body.onWindow;
    const windowsAllowed = this.behaviors.sitOnWindows;
    const r = Math.random();

    if (onWindow) {
      if (windowsAllowed && r < 0.45) return this.enter('sit', rand(10, 25));
      if (r < 0.6) return this.startWalk();
      if (r < 0.75) return this.hopDown();
      if (windowsAllowed && r < 0.85 && this.tryJumpToWindow()) return;
      return this.enter('idle', rand(4, 10));
    }

    if (windowsAllowed && r < 0.3 && this.tryJumpToWindow()) return;
    if (r < 0.6) return this.startWalk();
    this.enter('idle', rand(5, 12));
  }

  private startWalk(): void {
    if (Math.random() < 0.5) this.facing = this.facing === 1 ? -1 : 1;
    this.enter('walk', rand(1.5, 4.5));
  }

  /** Cherche le haut d'une fenêtre atteignable et prépare un saut balistique. */
  private tryJumpToWindow(): boolean {
    const h = this.layer.displayHeight;
    const maxRise = h * 6;
    const maxDx = h * 7;
    const half = this.body.halfWidth;
    const { x, y } = this.body;

    const candidates: Array<{ seg: Segment; tx: number; weight: number }> = [];
    for (const seg of this.world.platforms) {
      if (seg === this.body.ground || seg.x2 - seg.x1 < half * 3) continue;
      const rise = y - seg.y;
      if (rise < h * 0.4 || rise > maxRise) continue;
      const tx = Math.min(Math.max(x + rand(-h, h), seg.x1 + half), seg.x2 - half);
      const dx = Math.abs(tx - x);
      if (dx > maxDx) continue;
      candidates.push({ seg, tx, weight: 1 / (1 + dx / 300 + rise / 600) });
    }
    if (candidates.length === 0) return false;

    let pick = Math.random() * candidates.reduce((sum, c) => sum + c.weight, 0);
    const choice = candidates.find((c) => (pick -= c.weight) <= 0) ?? candidates[0]!;
    const v = ballisticVelocity(x, y, choice.tx, choice.seg.y, h * 0.5, h * 12);
    if (!v) return false;

    this.facing = v.vx >= 0 ? 1 : -1;
    this.pendingJump = v;
    this.enter('prejump');
    return true;
  }

  private hopDown(): void {
    const h = this.layer.displayHeight;
    this.pendingJump = { vx: this.facing * h * 2, vy: -Math.sqrt(2 * GRAVITY * h * 0.5) };
    this.enter('prejump');
  }

  private enter(mode: Mode, duration = 0): void {
    this.mode = mode;
    this.modeTime = 0;
    this.modeDuration = duration;
    switch (mode) {
      case 'idle':
        this.animator.play('idle');
        break;
      case 'walk':
        this.animator.play('walk');
        break;
      case 'sit':
        this.animator.play('sit_window');
        break;
      case 'prejump':
      case 'land':
        this.animator.hold('jump', 0);
        break;
      case 'air':
        this.body.driven = false;
        this.updateAirAnimation();
        break;
      case 'dragged':
        this.animator.play('dragged');
        break;
    }
    this.hooks.requestWake();
  }

  private updateAirAnimation(): void {
    if (this.body.vy < 0) {
      if (this.animator.name !== 'jump') this.animator.play('jump', true, 2);
      return;
    }
    const below = this.world.surfaceBelow(this.body.x, this.body.y);
    const timeToImpact = below && this.body.vy > 0 ? (below.y - this.body.y) / this.body.vy : Infinity;
    if (timeToImpact < LANDING_ANTICIPATION) {
      this.animator.hold('jump', 0);
    } else if (this.animator.name !== 'fall' && (this.animator.name !== 'jump' || this.animator.isFinished)) {
      this.animator.play('fall');
    }
  }

  // --- Ombre portée (profil Haute qualité) ---------------------------------------

  private renderShadow(): void {
    let css = 'none';
    if (this.profile.shadows && this.mode !== 'dragged') {
      const below = this.world.surfaceBelow(this.body.x, this.body.y);
      if (below) {
        const height = below.y - this.body.y;
        const k = Math.max(0.25, 1 - height / 400);
        const w = this.body.halfWidth * 1.6 * k;
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

  // --- Souris ---------------------------------------------------------------------

  private bindPointer(): void {
    const el = this.layer.canvas;

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      this.dragOffsetX = this.body.x - e.clientX;
      this.dragOffsetY = this.body.y - e.clientY;
      this.dragSamples = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }];
      this.body.ground = null;
      this.body.vx = 0;
      this.body.vy = 0;
      this.enter('dragged');
      this.hooks.onDragStateChanged(true);
    });

    el.addEventListener('pointermove', (e) => {
      if (this.mode !== 'dragged') return;
      const b = this.world.bounds;
      this.body.x = Math.min(Math.max(e.clientX + this.dragOffsetX, b.left + this.body.halfWidth), b.right - this.body.halfWidth);
      this.body.y = Math.min(Math.max(e.clientY + this.dragOffsetY, b.top + this.body.height), b.bottom);
      this.dragSamples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
      if (this.dragSamples.length > 6) this.dragSamples.shift();
    });

    const release = (e: PointerEvent): void => {
      if (this.mode !== 'dragged') return;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      el.classList.remove('dragging');
      // Lancer : vitesse moyenne des derniers mouvements de la souris.
      const first = this.dragSamples[0];
      const last = this.dragSamples[this.dragSamples.length - 1];
      const span = first && last ? (last.t - first.t) / 1000 : 0;
      const clamp = (v: number): number => Math.max(-MAX_THROW_SPEED, Math.min(MAX_THROW_SPEED, v));
      const vx = first && last && span > 0.01 ? clamp((last.x - first.x) / span) : 0;
      const vy = first && last && span > 0.01 ? clamp((last.y - first.y) / span) : 0;
      this.body.launch(vx, vy);
      this.enter('air');
      this.hooks.onDragStateChanged(false);
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);

    el.addEventListener('dblclick', () => this.hooks.onDoubleClick());
  }
}
