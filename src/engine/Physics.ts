import type { Segment, World } from './World';

/** Unités : px CSS et secondes. */
export const GRAVITY = 2200;
const TERMINAL_VELOCITY = 1800;
const GROUND_FRICTION = 10; // décroissance exponentielle de vx au sol (1/s)
const AIR_DRAG = 0.4;
const WALL_RESTITUTION = 0.45;
/** Au-delà de cette vitesse d'impact, on rebondit au lieu de se poser. */
const BOUNCE_THRESHOLD = 950;
const BOUNCE_RESTITUTION = 0.3;
/** En dessous du monde (vide entre deux écrans) : on réapparaît. */
const OUT_OF_WORLD_MARGIN = 400;

/** Réglages physiques propres à un corps (la balle rebondit et roule, le robot non). */
export interface BodyOptions {
  groundFriction?: number;
  bounceThreshold?: number;
  bounceRestitution?: number;
  wallRestitution?: number;
}

export interface StepResult {
  landed: boolean;
  bounced: boolean;
  impactSpeed: number;
  /** -1 mur gauche, 1 mur droit, 0 aucun. */
  hitWall: -1 | 0 | 1;
  lostGround: boolean;
  respawned: boolean;
}

/**
 * Corps physique du compagnon, repéré par ses pieds (ancre `feet` du manifeste).
 * Quand il se tient sur une fenêtre, il mémorise sa position relative pour la suivre
 * si l'utilisateur la déplace.
 */
export class Body {
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  ground: Segment | null = null;
  /** true : le contrôleur impose vx (marche) ; false : friction au sol. */
  driven = false;
  /**
   * Peut franchir un bord relié (lancé, ou parti explorer). Sinon les bords reliés font
   * office de murs : un jouet poussé ou un compagnon qui court ne part pas par accident.
   */
  crossLinks = true;
  private windowOffsetX = 0;
  readonly halfWidth: number;
  readonly height: number;
  private readonly friction: number;
  private readonly bounceThreshold: number;
  private readonly bounceRestitution: number;
  private readonly wallRestitution: number;

  constructor(x: number, y: number, halfWidth: number, height: number, options: BodyOptions = {}) {
    this.x = x;
    this.y = y;
    this.halfWidth = halfWidth;
    this.height = height;
    this.friction = options.groundFriction ?? GROUND_FRICTION;
    this.bounceThreshold = options.bounceThreshold ?? BOUNCE_THRESHOLD;
    this.bounceRestitution = options.bounceRestitution ?? BOUNCE_RESTITUTION;
    this.wallRestitution = options.wallRestitution ?? WALL_RESTITUTION;
  }

  get grounded(): boolean {
    return this.ground !== null;
  }

  get onWindow(): boolean {
    return this.ground?.windowId != null;
  }

  launch(vx: number, vy: number): void {
    this.ground = null;
    this.vx = vx;
    this.vy = vy;
  }

  placeOn(seg: Segment, x: number, world: World): void {
    this.x = x;
    this.y = seg.y;
    this.vy = 0;
    this.attach(seg, world);
  }

  private attach(seg: Segment, world: World): void {
    this.ground = seg;
    // Écart au bord gauche de la fenêtre porteuse, pour la suivre quand elle bouge.
    const win = seg.windowId === null ? undefined : world.window(seg.windowId);
    this.windowOffsetX = win ? this.x - win.rect.x : 0;
  }

  /**
   * Après un nouveau relevé des fenêtres : suit la fenêtre qui porte le compagnon,
   * ou le fait tomber si elle a disparu, été réduite ou recouverte.
   * Renvoie true si le support a été perdu.
   */
  reattach(world: World): boolean {
    const ground = this.ground;
    if (!ground) return false;

    if (ground.windowId === null) {
      const floor = world.floorAt(this.x);
      if (floor) {
        this.y = floor.y;
        this.ground = floor;
        return false;
      }
      this.ground = null;
      return true;
    }

    const win = world.window(ground.windowId);
    if (!win) {
      this.ground = null;
      return true;
    }
    const nx = win.rect.x + this.windowOffsetX;
    const seg = world.supportAt(nx, win.rect.y, win.id);
    if (!seg) {
      this.ground = null;
      return true;
    }
    this.x = nx;
    this.y = seg.y;
    this.ground = seg;
    return false;
  }

  step(world: World, dt: number): StepResult {
    const result: StepResult = {
      landed: false,
      bounced: false,
      impactSpeed: 0,
      hitWall: 0,
      lostGround: false,
      respawned: false,
    };

    if (this.ground) {
      if (!this.driven) this.vx *= Math.exp(-this.friction * dt);
      if (Math.abs(this.vx) < 1 && !this.driven) this.vx = 0;
      this.x += this.vx * dt;
      result.hitWall = this.clampWalls(world, false);
      const seg = world.supportAt(this.x, this.y, this.ground.windowId) ?? world.supportAt(this.x, this.y);
      if (seg) {
        this.attach(seg, world);
      } else {
        this.ground = null;
        this.vy = 0;
        result.lostGround = true;
      }
      return result;
    }

    // En l'air.
    this.vy = Math.min(this.vy + GRAVITY * dt, TERMINAL_VELOCITY);
    this.vx *= Math.exp(-AIR_DRAG * dt);
    const prevY = this.y;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    result.hitWall = this.clampWalls(world, true);

    // Plafond (haut du bureau virtuel), sauf s'il est relié à l'écran d'un autre joueur.
    if (!(this.crossLinks && world.links.has('top')) && this.y - this.height < world.bounds.top) {
      this.y = world.bounds.top + this.height;
      this.vy = Math.abs(this.vy) * 0.2;
    }

    if (this.vy >= 0) {
      const seg = world.landing(this.x, prevY, this.y);
      if (seg) {
        result.impactSpeed = this.vy;
        if (this.vy > this.bounceThreshold) {
          this.y = seg.y;
          this.vy = -this.vy * this.bounceRestitution;
          this.vx *= 0.6;
          result.bounced = true;
        } else {
          this.y = seg.y;
          this.vy = 0;
          this.vx *= 0.3;
          this.attach(seg, world);
          result.landed = true;
        }
      }
    }

    if (this.y > world.bounds.bottom + OUT_OF_WORLD_MARGIN && !(this.crossLinks && world.links.has('bottom'))) {
      this.respawn(world);
      result.respawned = true;
      result.landed = true;
    }
    return result;
  }

  respawn(world: World): void {
    const floor = world.floors[0];
    if (!floor) return;
    this.vx = 0;
    this.vy = 0;
    this.placeOn(floor, (floor.x1 + floor.x2) / 2, world);
  }

  private clampWalls(world: World, airborne: boolean): -1 | 0 | 1 {
    // Un bord relié laisse passer (le corps part chez le voisin).
    const min = this.crossLinks && world.links.has('left') ? -Infinity : world.bounds.left + this.halfWidth;
    const max = this.crossLinks && world.links.has('right') ? Infinity : world.bounds.right - this.halfWidth;
    if (this.x < min) {
      this.x = min;
      this.vx = airborne ? Math.abs(this.vx) * this.wallRestitution : -this.vx * this.wallRestitution;
      return -1;
    }
    if (this.x > max) {
      this.x = max;
      this.vx = airborne ? -Math.abs(this.vx) * this.wallRestitution : -this.vx * this.wallRestitution;
      return 1;
    }
    return 0;
  }
}

/**
 * Vitesse initiale d'un saut balistique de (x0, y0) vers (x1, y1), avec un apex
 * `clearance` px au-dessus du point le plus haut. Renvoie null si irréalisable.
 */
export function ballisticVelocity(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  clearance: number,
  maxVx: number,
): { vx: number; vy: number } | null {
  const apexY = Math.min(y0, y1) - clearance;
  const rise = y0 - apexY;
  const drop = y1 - apexY;
  if (rise <= 0 || drop <= 0) return null;
  const vy = -Math.sqrt(2 * GRAVITY * rise);
  const time = Math.sqrt((2 * rise) / GRAVITY) + Math.sqrt((2 * drop) / GRAVITY);
  const vx = (x1 - x0) / time;
  return Math.abs(vx) <= maxVx ? { vx, vy } : null;
}
