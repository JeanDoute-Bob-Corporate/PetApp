/**
 * Comportements du compagnon : les états de la machine à états et leurs scores pour
 * l'IA utilitaire. Les états utilisent les primitives de `Companion` (marcher, sauter,
 * animer, parler) et n'ont pas accès au DOM.
 */
import type { Companion } from '../entities/Companion';
import { FOODS, STAT_LABELS, type StatKey } from '../entities/CompanionStats';
import type { Toy } from '../entities/Toy';
import type { DesktopIcon } from '../platform/bridge';
import { GRAVITY } from '../engine/Physics';
import type { Segment } from '../engine/World';
import type { Consideration } from './UtilityAI';
import type { Next, State, StateFactory } from './StateMachine';

type C = Companion;
type Jump = { vx: number; vy: number };

const rand = (min: number, max: number): number => min + Math.random() * (max - min);
const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;

/** Priorités d'interruption (cf. StateMachine.interrupt). */
const P = { normal: 0, sleep: 12, eat: 13, bug: 14, pet: 20, scared: 25, celebrate: 30, wall: 40, system: 50 } as const;

// --- Déplacements -------------------------------------------------------------------

type Approach = 'arrived' | 'moving' | 'fell' | 'blocked';

/** Marche (ou court) jusqu'à `x` sur la surface courante. */
function approach(c: C, x: number, dt: number, speed = 1): Approach {
  const dx = x - c.body.x;
  if (Math.abs(dx) <= 6) {
    c.stop();
    return 'arrived';
  }
  const res = c.walk(dx > 0 ? 1 : -1, speed, dt);
  if (res.lostGround) return 'fell';
  if (res.hitWall !== 0) return 'blocked';
  if (Math.sign(x - c.body.x) !== Math.sign(dx)) {
    c.body.x = x;
    c.stop();
    return 'arrived';
  }
  return 'moving';
}

type Reach = 'arrived' | 'moving' | 'unreachable' | Next;

/**
 * Rejoint un point éventuellement situé sur une autre surface : marche, descend en
 * se laissant tomber du bord, ou saute s'il est plus haut et à portée.
 */
function reach(c: C, x: number, y: number, dt: number, speed = 1): Reach {
  const dy = y - c.body.y;
  if (Math.abs(dy) < 10) {
    const r = approach(c, x, dt, speed);
    return r === 'arrived' ? 'arrived' : r === 'blocked' ? 'unreachable' : 'moving';
  }
  if (dy > 0) {
    // Plus bas : rejoindre le bord le plus proche de la plateforme et se laisser tomber.
    const seg = c.body.ground;
    let tx = x;
    if (seg && x >= seg.x1 - c.halfW && x <= seg.x2 + c.halfW) {
      tx = x - seg.x1 < seg.x2 - x ? seg.x1 - c.halfW * 1.2 : seg.x2 + c.halfW * 1.2;
    }
    const r = approach(c, tx, dt, speed);
    return r === 'blocked' || r === 'arrived' ? 'unreachable' : 'moving';
  }
  const v = c.planJump(x, y);
  return v ? { to: 'jump', params: v } : 'unreachable';
}

/** Position à côté d'un objet, du côté où se trouve déjà le compagnon. */
function besideX(c: C, toy: Toy, gap = 0.9): number {
  const side = c.body.x < toy.x ? -1 : 1;
  const x = toy.x + side * (toy.halfWidth + c.halfW * gap);
  const b = c.world.bounds;
  if (x - c.halfW < b.left || x + c.halfW > b.right) return toy.x - side * (toy.halfWidth + c.halfW * gap);
  return x;
}

/** Choisit le haut d'une fenêtre atteignable et calcule le saut. */
function findWindowJump(c: C): Jump | null {
  const h = c.h;
  const { x, y } = c.body;
  const candidates: Array<{ seg: Segment; tx: number; weight: number }> = [];
  for (const seg of c.world.platforms) {
    if (seg === c.body.ground || seg.x2 - seg.x1 < c.halfW * 3) continue;
    const rise = y - seg.y;
    if (rise < h * 0.4 || rise > h * 6) continue;
    const tx = Math.min(Math.max(x + rand(-h, h), seg.x1 + c.halfW), seg.x2 - c.halfW);
    const dx = Math.abs(tx - x);
    if (dx > h * 7) continue;
    candidates.push({ seg, tx, weight: 1 / (1 + dx / 300 + rise / 600) });
  }
  if (candidates.length === 0) return null;
  let r = Math.random() * candidates.reduce((s, cd) => s + cd.weight, 0);
  const choice = candidates.find((cd) => (r -= cd.weight) <= 0) ?? candidates[0]!;
  return c.planJump(choice.tx, choice.seg.y);
}

interface Wall {
  /** Abscisse du mur lui-même (bord de l'écran ou côté de la fenêtre). */
  edgeX: number;
  /** Direction du mur depuis le compagnon. */
  dir: 1 | -1;
  windowId: number | null;
  /** Côté de la fenêtre (pour suivre ses déplacements). */
  side: 'left' | 'right';
  /** Haut du mur : haut de l'écran ou de la fenêtre. */
  topY: number;
}

/** Murs proches : bords de l'écran et côtés des fenêtres qui touchent le sol. */
function findWall(c: C, windowsOnly: boolean): Wall | null {
  const floor = c.body.ground;
  if (!floor || floor.windowId !== null) return null;
  const walls: Wall[] = [];
  const y = c.body.y;
  if (!windowsOnly) {
    const topY = c.world.monitorTopAt(c.body.x);
    walls.push({ edgeX: floor.x1, dir: -1, windowId: null, side: 'left', topY });
    walls.push({ edgeX: floor.x2, dir: 1, windowId: null, side: 'right', topY });
  }
  for (const w of c.world.windowList()) {
    const bottom = w.rect.y + w.rect.h;
    if (bottom < y - 4 || w.rect.y > y - c.h * 1.5 || w.maximized) continue;
    walls.push({ edgeX: w.rect.x, dir: 1, windowId: w.id, side: 'left', topY: w.rect.y });
    walls.push({ edgeX: w.rect.x + w.rect.w, dir: -1, windowId: w.id, side: 'right', topY: w.rect.y });
  }
  const usable = walls.filter((w) => {
    const x = standX(c, w);
    // Tolérance : contre un bord d'écran, il se tient à 0,9 demi-largeur du bord.
    return x >= floor.x1 + c.halfW * 0.8 && x <= floor.x2 - c.halfW * 0.8;
  });
  const near = usable.filter((w) => Math.abs(standX(c, w) - c.body.x) < c.h * 7);
  return near.length > 0 ? pick(near) : null;
}

/** Met à jour la position d'un mur de fenêtre (elle a pu bouger) ; false si disparue. */
function refreshWall(c: C, wall: Wall): boolean {
  if (wall.windowId === null) return true;
  const w = c.world.window(wall.windowId);
  if (!w) return false;
  wall.topY = w.rect.y;
  wall.edgeX = wall.side === 'left' ? w.rect.x : w.rect.x + w.rect.w;
  return true;
}

/** Où se tenir au sol, face au mur. */
function standX(c: C, wall: Wall): number {
  return wall.edgeX - wall.dir * c.halfW * 0.9;
}

/**
 * Où se placer agrippé : le sprite de profil a ses mains au bord de sa case
 * (dernière colonne pour un mur à droite, retourné pour un mur à gauche).
 */
function gripX(c: C, wall: Wall): number {
  const { sprite, anchorPoints } = c.pack.manifest;
  return wall.edgeX - wall.dir * (sprite.frameWidth - 1 - anchorPoints.feet.x) * c.px;
}

/** Minutes depuis la dernière interaction (caresse, jeu, repas, glisser…). */
function idleMinutes(c: C): number {
  return (Date.now() - c.stats.data.lastInteractionAt) / 60_000;
}

/**
 * Humeur à faire des bêtises : malheureux et délaissé depuis un moment. Une seule
 * bêtise toutes les 2 minutes au plus.
 */
function grumpyEnough(c: C): boolean {
  return c.stats.needs.happiness < 35 && idleMinutes(c) > 15 && !c.recent('mischief', 120);
}

/** Super-saut cartoon dont le sommet passe par (x, y) ; null si le point est trop bas. */
function apexJump(c: C, x: number, y: number): Jump | null {
  const rise = c.body.y - c.h * 0.4 - y;
  if (rise < c.h * 0.3) return null;
  const vy = -Math.sqrt(2 * GRAVITY * rise);
  const tUp = -vy / GRAVITY;
  const vx = Math.max(-c.h * 15, Math.min(c.h * 15, (x - c.body.x) / tUp));
  return { vx, vy };
}

// --- Petits utilitaires d'état -------------------------------------------------------

/** Entraîne une stat ; renvoie une célébration si un palier est franchi. */
function train(c: C, stat: StatKey, seconds: number, talent: number): Next | undefined {
  const r = c.stats.train(stat, seconds, talent);
  return r.levelUp !== null ? { to: 'celebrate', params: { label: STAT_LABELS[stat], value: r.levelUp } } : undefined;
}

/** Animation unique puis fin de l'état (bâillement, étirement, trébuchement…). */
function oneShot(name: string, extra?: (c: C) => void): StateFactory<C> {
  return () => ({
    activity: 'idle',
    enter(c) {
      c.stop();
      c.anim(name, true);
      extra?.(c);
    },
    update(c, dt): Next | void {
      c.stand(dt);
      if (c.animDone(name) || c.fsm.time > 4) return 'done';
    },
  });
}

const CODE_QUIPS = [
  'git commit -m "wip"',
  'Ça marche sur ma machine.',
  'console.log("ici ?")',
  '// TODO : refactoriser',
  'Encore un point-virgule…',
  'npm install… ⏳',
  'Qui a écrit ça ? Ah, moi.',
];

// --- États --------------------------------------------------------------------------

export function createStates(): Record<string, StateFactory<C>> {
  return {
    // Système : chute, saut, atterrissage, prise à la souris, menu ouvert.
    fall: (): State<C> => ({
      activity: 'active',
      airborne: true,
      priority: P.system,
      enter(c) {
        c.body.driven = false;
      },
      update(c, dt): Next | void {
        const res = c.body.step(c.world, dt);
        if (Math.abs(c.body.vx) > 20) c.facing = c.body.vx > 0 ? 1 : -1;
        if (res.landed) return { to: 'land', params: res.impactSpeed };
        if (res.bounced) c.animator.play('jump', true, 2);
        if (c.body.vy < 0) {
          if (c.animator.name !== 'jump') c.animator.play('jump', true, 2);
          return;
        }
        // Anticipation : jambes pliées ~90 ms avant le contact.
        const below = c.world.surfaceBelow(c.body.x, c.body.y);
        const tti = below && c.body.vy > 0 ? (below.y - c.body.y) / c.body.vy : Infinity;
        if (tti < 0.09) c.holdAnim('jump', 0);
        else if (c.animator.name !== 'fall' && (c.animator.name !== 'jump' || c.animator.isFinished)) c.anim('fall');
      },
    }),

    land: (impact): State<C> => ({
      activity: 'active',
      priority: P.system,
      enter(c) {
        c.holdAnim('jump', 0);
        if (typeof impact === 'number' && impact > 500) {
          c.sfx('land');
          c.emit('dust');
        }
      },
      update(c, dt): Next | void {
        c.stand(dt);
        if (c.fsm.time >= 0.14) return 'done';
      },
    }),

    jump: (params): State<C> => {
      const v = params as Jump;
      return {
        activity: 'active',
        priority: P.system,
        enter(c) {
          c.stop();
          c.holdAnim('jump', 0);
          if (Math.abs(v.vx) > 1) c.facing = v.vx > 0 ? 1 : -1;
        },
        update(c, dt): Next | void {
          c.stand(dt);
          if (c.fsm.time < 0.14) return;
          c.body.launch(v.vx, v.vy);
          c.animator.play('jump', true, 1);
          c.sfx('jump');
          return { to: 'fall' };
        },
      };
    },

    dragged: (): State<C> => ({
      activity: 'active',
      airborne: true,
      priority: 100,
      enter(c) {
        c.anim('dragged');
        c.emit('sweat');
      },
      update() {},
    }),

    menu: (): State<C> => ({
      activity: 'idle',
      priority: 55,
      enter(c) {
        c.stop();
        c.anim('idle');
      },
      update(c, dt): Next | void {
        c.stand(dt);
        if (!c.menuOpen) return 'done';
      },
    }),

    // Repos et micro-animations.
    idle: (params): State<C> => {
      const duration = (params as { duration?: number } | undefined)?.duration ?? rand(3, 8);
      return {
        activity: 'idle',
        enter(c) {
          c.stop();
          c.anim('idle');
        },
        update(c, dt): Next | void {
          c.stand(dt);
          if (c.behaviors.mouseInteractions && c.cursor.near) c.face(c.cursor.x);
          if (c.fsm.time > duration) return 'done';
        },
      };
    },

    yawn: oneShot('yawn'),
    stretch: oneShot('stretch'),
    trip: oneShot('trip', (c) => {
      c.emit('dust');
      c.say(pick(['Oups !', 'Aïe…', 'Qui a mis ça là ?']), 2);
    }),
    scared: (): State<C> => ({
      activity: 'active',
      priority: P.scared,
      enter(c) {
        c.stop();
        c.face(c.cursor.x);
        c.anim('scared', true);
        c.emit('alert', true);
        c.sfx('scared');
        c.mark('scared');
      },
      update(c, dt): Next | void {
        c.stand(dt);
        if (c.animDone('scared') || c.fsm.time > 2) return 'done';
      },
    }),

    look: (): State<C> => {
      const duration = rand(3, 5);
      return {
        activity: 'idle',
        enter(c) {
          c.stop();
          c.anim('look');
        },
        update(c, dt): Next | void {
          c.stand(dt);
          if (c.fsm.time > duration) return 'done';
        },
      };
    },

    sulk: (): State<C> => {
      const duration = rand(6, 10);
      return {
        activity: 'idle',
        enter(c) {
          c.stop();
          c.anim('sulk');
          c.emit('anger', true);
          c.say(pick(['…', 'Tu m’as oublié ?', 'Hmpf.', 'Personne ne joue avec moi…']), 3);
        },
        update(c, dt): Next | void {
          c.stand(dt);
          if (c.fsm.time > duration) return 'done';
        },
      };
    },

    beg: (): State<C> => ({
      activity: 'idle',
      enter(c) {
        c.stop();
        c.anim('sulk');
        c.emit('food', true);
        c.say(pick(['J’ai faim… 🍖', 'Il reste des croquettes ?', 'Mon ventre gargouille.']), 3.5);
      },
      update(c, dt): Next | void {
        c.stand(dt);
        if (c.fsm.time > 4) return 'done';
      },
    }),

    sleep: (): State<C> => ({
      activity: 'idle',
      priority: P.sleep,
      enter(c) {
        c.stop();
        c.anim('sleep');
        if (c.stats.needs.energy < 20) c.say('Bonne nuit… 💤', 2.5);
      },
      update(c, dt): Next | void {
        c.stand(dt);
        const e = c.stats.needs.energy;
        if (e >= 98 || (c.fsm.time > 600 && e > 60)) return { to: 'stretch' };
      },
    }),

    celebrate: (params): State<C> => {
      const p = params as { label: string; value: number };
      return {
        activity: 'idle',
        priority: P.celebrate,
        enter(c) {
          c.stop();
          c.anim('victory', true);
          c.emit('star', true);
          c.sfx('levelup');
          c.say(`${p.label} ${p.value} ! ⬆️`, 2.5);
        },
        update(c, dt): Next | void {
          c.stand(dt);
          if (c.fsm.time > 2.2) return 'done';
        },
      };
    },

    pet: (): State<C> => {
      let timer = 0;
      return {
        activity: 'idle',
        priority: P.pet,
        enter(c) {
          c.stop();
          c.anim('pet');
          c.stats.interact();
        },
        update(c, dt): Next | void {
          c.stand(dt);
          if (performance.now() > c.petActiveUntil) return c.fsm.time > 0.6 ? 'done' : undefined;
          timer += dt;
          if (timer >= 1.2) {
            timer = 0;
            c.stats.pet();
            c.emit('heart', true);
            c.sfx('pet');
          }
        },
      };
    },

    // Secoué trop fort : tournis, puis il vomit.
    dizzy: (): State<C> => ({
      activity: 'idle',
      priority: P.celebrate,
      enter(c) {
        c.stop();
        c.anim('dizzy');
        c.emit('sweat', true);
        c.say(pick(['Je vais être malade…', 'Tout tourne…', 'Plus jamais ça…']), 2);
      },
      update(c, dt): Next | void {
        c.stand(dt);
        if (c.fsm.time > 2.2) return { to: 'vomit' };
      },
    }),

    vomit: (): State<C> => ({
      activity: 'idle',
      priority: P.celebrate,
      enter(c) {
        c.stop();
        c.facing = Math.random() < 0.5 ? 1 : -1;
        c.anim('vomit', true);
        c.emit('sick', true);
        c.stats.vomit();
      },
      update(c, dt): Next | void {
        c.stand(dt);
        if (c.animDone('vomit') || c.fsm.time > 3) {
          c.say(pick(['Beurk… 🤢', 'Je crois que ça va mieux…', 'Merci bien…']), 2.5);
          return 'done';
        }
      },
    }),

    // Mécontent : bras croisés, il tape du pied.
    grumpy: (): State<C> => {
      const duration = rand(6, 10);
      return {
        activity: 'idle',
        enter(c) {
          c.stop();
          c.anim('grumpy');
          c.emit('anger', true);
          c.say(pick(['Hmpf !', 'Je boude.', 'Pfff…', 'Tu ne t’occupes jamais de moi !']), 3);
        },
        update(c, dt): Next | void {
          c.stand(dt);
          if (c.fsm.time > duration) return 'done';
        },
      };
    },

    // Bêtise : il tire ou repousse le côté d'une fenêtre.
    tug_window: (): State<C> => {
      let wall: Wall | null = null;
      let working = false;
      let pending = false;
      let moved = 0;
      let lastStep = 0;
      /** true : il tire vers lui (la fenêtre s'élargit) ; false : il pousse (elle rétrécit). */
      const pulling = Math.random() < 0.5;
      const goal = rand(120, 240);
      return {
        activity: 'active',
        enter(c) {
          wall = findWall(c, true);
          c.anim('walk');
        },
        update(c, dt): Next | void {
          if (!wall || !refreshWall(c, wall) || wall.windowId === null) return 'done';
          if (!working) {
            const r = approach(c, standX(c, wall), dt);
            if (r === 'fell' || (r === 'moving' && c.fsm.time > 10)) return 'done';
            if (r === 'moving') return;
            working = true;
            lastStep = c.fsm.time;
            c.facing = wall.dir;
            c.anim(pulling ? 'pull' : 'push');
            c.say(pulling ? pick(['Plus grand !', 'Hissez !', 'Allez, viens !']) : pick(['Ferme-toi !', 'Pousse-toi de là !', 'Trop large !']), 2);
            return;
          }
          c.body.x = standX(c, wall);
          c.stand(dt);
          if (moved >= goal || c.fsm.time > 15) return 'done';
          if (pending || c.fsm.time - lastStep < 0.12) return;
          // Le côté de la fenêtre suit ses mains : vers lui s'il tire, vers l'intérieur s'il pousse.
          const away = -wall.dir;
          const dx = (pulling ? away : -away) * 8;
          pending = true;
          lastStep = c.fsm.time;
          const id = wall.windowId;
          c.desktop
            .nudgeWindow(id, wall.side, dx)
            .then((applied) => {
              moved += Math.abs(applied);
              if (applied === 0) moved = goal; // limite atteinte ou refus
            })
            .catch(() => (moved = goal))
            .finally(() => (pending = false));
        },
      };
    },

    // Bêtise : il chipe une icône du bureau et la dépose ailleurs.
    steal_icon: (): State<C> => {
      let phase: 'fetch' | 'approach' | 'crouch' | 'air' | 'carry' | 'done' = 'fetch';
      let icon: DesktopIcon | null = null;
      let target = 0;
      let failed = false;
      return {
        activity: 'active',
        airborne: true,
        priority: P.wall,
        enter(c) {
          c.stop();
          c.anim('look');
          const floor = c.body.ground;
          c.desktop
            .icons()
            .then((icons) => {
              // Icônes au-dessus de l'écran courant, atteignables d'un super-saut.
              const candidates = icons.filter(
                (i) => floor && i.x + i.w / 2 > floor.x1 + c.h && i.x + i.w / 2 < floor.x2 - c.h && i.y + i.h < c.body.y - c.h * 0.5,
              );
              icon = candidates.length > 0 ? pick(candidates) : null;
              if (!icon) failed = true;
            })
            .catch(() => (failed = true));
        },
        update(c, dt): Next | void {
          if (failed) {
            c.mark('steal_icon_failed');
            return c.body.grounded ? 'done' : { to: 'fall' };
          }
          switch (phase) {
            case 'fetch':
              c.stand(dt);
              if (icon) phase = 'approach';
              else if (c.fsm.time > 3) return 'done';
              return;
            case 'approach': {
              const i = icon!;
              const cx = i.x + i.w / 2;
              if (Math.abs(cx - c.body.x) > c.h * 3) {
                c.anim('run');
                const r = approach(c, cx - Math.sign(cx - c.body.x) * c.h * 2.5, dt, 1.8);
                if (r === 'fell') return { to: 'fall' };
                if (r === 'moving') return;
              }
              c.face(cx);
              c.holdAnim('jump', 0);
              c.say(pick(['Hop, celle-là !', 'Je t’emprunte ça…', 'Hihi.']), 1.5);
              phase = 'crouch';
              target = c.fsm.time + 0.18;
              return;
            }
            case 'crouch': {
              c.stand(dt);
              if (c.fsm.time < target) return;
              const i = icon!;
              const jump = apexJump(c, i.x + i.w / 2, i.y + i.h / 2);
              if (!jump) return 'done';
              c.body.launch(jump.vx, jump.vy);
              c.animator.play('jump', true, 1);
              c.sfx('jump');
              phase = 'air';
              return;
            }
            case 'air': {
              const res = c.body.step(c.world, dt);
              if (!c.carrying && c.body.vy >= 0 && icon) {
                // Au sommet du saut : il attrape l'icône.
                c.carry({ kind: 'icon', icon });
                c.anim('carry_idle');
                c.sfx('pop');
              }
              if (!res.landed) return;
              if (!c.carrying) return 'done';
              const floor = c.body.ground;
              const span = floor ? floor.x2 - floor.x1 : 0;
              const dest = floor ? floor.x1 + c.h + Math.random() * Math.max(0, span - c.h * 2) : c.body.x;
              target = Math.abs(dest - c.body.x) < c.h * 2 ? c.body.x + (c.body.x > dest ? -1 : 1) * c.h * 3 : dest;
              phase = 'carry';
              c.anim('carry');
              return;
            }
            case 'carry': {
              const r = approach(c, target, dt, 1);
              if (r === 'moving' && c.fsm.time < 25) return;
              if (r === 'fell') {
                c.drop();
                return { to: 'fall' };
              }
              c.stop();
              c.drop();
              c.anim('carry_idle');
              c.say(pick(['Voilà, c’est mieux ici !', 'Range ta chambre !', 'Hop, déménagée !']), 2.5);
              c.emit('sparkle', true);
              phase = 'done';
              target = c.fsm.time + 1;
              return;
            }
            case 'done':
              c.stand(dt);
              if (c.fsm.time > target) return 'done';
              return;
          }
        },
        exit(c) {
          if (c.carrying?.kind === 'icon') c.drop();
        },
      };
    },

    // Bêtise : il « clique » sur l'écran avec son index.
    poke_screen: (): State<C> => ({
      activity: 'idle',
      enter(c) {
        c.stop();
        c.anim('poke', true);
      },
      update(c, dt): Next | void {
        c.stand(dt);
        if (c.animDone('poke') || c.fsm.time > 3) return 'done';
      },
      onAnimEvent(c, event) {
        if (event.type !== 'hit') return;
        const x = c.body.x + c.facing * c.h * 0.48;
        const y = c.body.y - c.h * 0.15;
        c.emitAt('ripple', x, y);
        c.sfx('pop');
        c.desktop.poke(x, y).catch(() => false);
        c.say(pick(['Clic !', 'Oups, j’ai cliqué.', 'Qu’est-ce que ça fait ça ?']), 1.8);
      },
    }),

    // Fichier glissé sur lui : il l'étudie puis le range ailleurs.
    study_file: (): State<C> => {
      let phase: 'grab' | 'study' | 'carry' | 'drop' = 'grab';
      let target = 0;
      let until = 0;
      return {
        activity: 'idle',
        priority: 26,
        enter(c) {
          c.stop();
          const file = c.pendingFile;
          c.pendingFile = null;
          if (!file) return;
          c.stats.interact();
          c.say(`Oh, un fichier ! 📄\n${file.name.length > 28 ? `${file.name.slice(0, 26)}…` : file.name}`, 3);
          const index = file.iconIndex;
          if (index !== null) {
            // Fichier du bureau : il porte sa vraie icône.
            c.desktop
              .icons()
              .then((icons) => {
                const icon = icons.find((i) => i.index === index);
                if (icon && phase !== 'drop') c.carry({ kind: 'icon', icon });
              })
              .catch(() => undefined);
          } else {
            const toy = c.toys.spawn('file', c.body.x, c.body.y - c.h * 0.4);
            toy.label = file.name;
            c.carry({ kind: 'toy', toy });
          }
          c.anim('carry_idle');
          phase = 'study';
          until = 2.5;
        },
        update(c, dt): Next | void {
          if (phase === 'grab') return 'done';
          c.stand(dt);
          if (phase === 'study') {
            const next = train(c, 'technique', dt * 1.5, c.traits.curious);
            if (next) return next;
            if (c.fsm.time < until) return;
            const floor = c.body.ground;
            const span = floor ? floor.x2 - floor.x1 : 0;
            target = floor ? floor.x1 + c.h + Math.random() * Math.max(0, span - c.h * 2) : c.body.x;
            if (Math.abs(target - c.body.x) < c.h * 2) target = c.body.x + (Math.random() < 0.5 ? -1 : 1) * c.h * 3;
            phase = 'carry';
            c.anim('carry');
            c.say(pick(['Je sais où le ranger !', 'Intéressant…', 'Hmm, du code ?']), 2);
            return;
          }
          if (phase === 'carry') {
            const r = approach(c, target, dt);
            if (r === 'moving' && c.fsm.time < 20) return;
            const dropped = c.drop();
            if (dropped?.kind === 'toy') {
              const toy = dropped.toy;
              window.setTimeout(() => toy.squash(), 2500);
            }
            c.emit('sparkle', true);
            c.say('Rangé ! ✨', 1.5);
            phase = 'drop';
            until = c.fsm.time + 0.8;
            c.anim('idle');
            return;
          }
          if (c.fsm.time > until) return 'done';
        },
        exit(c) {
          if (c.carrying) c.drop();
        },
      };
    },

    // Lance une note en boule de papier dans la direction visée.
    throw: (params): State<C> => {
      const p = params as { vx: number; vy: number; text: string };
      let thrown = false;
      return {
        activity: 'active',
        priority: 26,
        enter(c) {
          c.stop();
          c.facing = p.vx >= 0 ? 1 : -1;
          c.anim('throw', true);
        },
        update(c, dt): Next | void {
          c.stand(dt);
          if ((c.animDone('throw') && thrown) || c.fsm.time > 3) return 'done';
        },
        onAnimEvent(c, event) {
          if (event.type !== 'hit' || thrown) return;
          thrown = true;
          const note = c.toys.spawn('note', c.body.x + c.facing * c.halfW, c.body.y - c.h * 0.75);
          note.text = p.text;
          note.body.crossLinks = true; // une note lancée peut partir chez le voisin
          note.kick(p.vx, p.vy);
          c.sfx('kick');
          c.stats.interact();
        },
      };
    },

    // Combat : position et animations pilotées par le metteur en scène.
    fight: (): State<C> => ({
      activity: 'active',
      priority: 60,
      airborne: true,
      enter(c) {
        c.stop();
        c.anim('run');
      },
      update(c, dt): Next | void {
        if (!c.body.grounded) {
          // Tombé d'une plateforme en rejoignant l'arène : il retombe et continue.
          c.body.step(c.world, dt);
          return;
        }
        const target = c.fightTargetX;
        if (target === null) {
          c.stand(dt);
          return;
        }
        const r = approach(c, target, dt, 1.8);
        if (r !== 'moving') c.fightTargetX = null;
      },
    }),

    // Un ami est en visite : il va le voir et lui fait signe.
    with_friend: (): State<C> => {
      let greeted = false;
      const duration = rand(4, 8);
      return {
        activity: 'idle',
        enter(c) {
          c.anim('walk');
        },
        update(c, dt): Next | void {
          const friend = c.friend?.();
          if (!friend) return 'done';
          const side = c.body.x < friend.x ? -1 : 1;
          const spot = friend.x + side * c.h * 1.3;
          if (!greeted) {
            const r = approach(c, spot, dt);
            if (r === 'fell' || (r === 'moving' && c.fsm.time > 8)) return 'done';
            if (r === 'moving') return;
            greeted = true;
            c.face(friend.x);
            c.anim(Math.random() < 0.5 ? 'wave' : 'look');
            c.say(pick(['Salut ' + friend.name + ' ! 👋', '😄', 'On fait la course ?', '🎵', '❤️']), 2.5);
            return;
          }
          c.stand(dt);
          c.face(friend.x);
          if (c.fsm.time > duration) return 'done';
        },
      };
    },

    // Coucou à l'apparition (démarrage, retour à l'écran).
    greet: (): State<C> => ({
      activity: 'idle',
      priority: 22,
      enter(c) {
        c.stop();
        if (c.behaviors.mouseInteractions && c.cursor.near) c.face(c.cursor.x);
        else c.facing = 1;
        c.anim('wave');
        c.emit('note');
        if (c.greeting) c.say(c.greeting, 4);
        c.greeting = null;
      },
      update(c, dt): Next | void {
        c.stand(dt);
        if (c.fsm.time > 2.8) return 'done';
      },
    }),

    // En manque d'attention : il fait coucou pour qu'on s'occupe de lui.
    seek_attention: (): State<C> => {
      const duration = rand(3.5, 5);
      return {
        activity: 'idle',
        enter(c) {
          c.stop();
          if (c.cursor.near) c.face(c.cursor.x);
          c.anim('wave');
          c.emit('alert', true);
          c.say(pick(['Coucou ! 👋', 'Hé ho ! Tu joues avec moi ?', 'Psst… je suis là !', 'Tu m’as pas vu ? 👋']), 3.5);
        },
        update(c, dt): Next | void {
          c.stand(dt);
          if (c.cursor.near) c.face(c.cursor.x);
          if (c.fsm.time > duration) return 'done';
        },
      };
    },

    // Déplacements autonomes.
    wander: (params): State<C> => {
      const run = (params as { run?: boolean } | undefined)?.run ?? false;
      const duration = rand(2, 4);
      let dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
      /** Il part explorer l'écran d'un voisin (sinon les bords reliés font office de murs). */
      // Pas d'exploration juste après être arrivé d'un autre écran (pas d'allers-retours).
      let explore = Math.random() < 0.16;
      return {
        activity: 'active',
        enter(c) {
          c.anim(run ? 'run' : 'walk');
          if (c.recent('arrived', 60)) explore = false;
          c.exploring = explore && c.world.links.size > 0;
          if (explore && c.world.links.size > 0) {
            const b = c.world.bounds;
            if (c.world.links.has('left') && !c.world.links.has('right')) dir = -1;
            else if (c.world.links.has('right') && !c.world.links.has('left')) dir = 1;
            else if (c.world.links.has('left')) dir = c.body.x - b.left < b.right - c.body.x ? -1 : 1;
          }
        },
        update(c, dt): Next | void {
          if (!explore) {
            const b = c.world.bounds;
            const nearLeft = c.world.links.has('left') && c.body.x - c.halfW <= b.left;
            const nearRight = c.world.links.has('right') && c.body.x + c.halfW >= b.right;
            if (nearLeft) dir = 1;
            if (nearRight) dir = -1;
          }
          if (c.body.onWindow) {
            const ahead = c.body.x + dir * c.halfW * 0.6;
            if (!c.world.supportAt(ahead, c.body.y) && Math.random() < 0.6) dir = dir === 1 ? -1 : 1;
          }
          const res = c.walk(dir, run ? 2.2 : 1, dt);
          if (res.hitWall !== 0) dir = res.hitWall === 1 ? -1 : 1;
          if (res.lostGround) return;
          if (run) {
            c.stats.spend('run', dt);
            const next = train(c, 'endurance', dt * 0.5, c.traits.brave);
            if (next) return next;
          }
          if (Math.random() < dt * (run ? 0.06 : 0.015)) return { to: 'trip' };
          if (c.fsm.time > (explore ? duration * 4 : duration)) return 'done';
        },
        exit(c) {
          c.exploring = false;
        },
      };
    },

    go_window: (params): State<C> => ({
      activity: 'active',
      update(): Next | void {
        const jump = params as Jump | null | undefined;
        return jump ? { to: 'jump', params: jump } : 'done';
      },
    }),

    hop_down: (): State<C> => ({
      activity: 'active',
      update(c, dt): Next | void {
        const seg = c.body.ground;
        if (!seg || seg.windowId === null) return 'done';
        const left = c.body.x - seg.x1 < seg.x2 - c.body.x;
        const target = left ? seg.x1 - c.halfW * 1.2 : seg.x2 + c.halfW * 1.2;
        c.anim('walk');
        const r = approach(c, target, dt, 1.3);
        if (r === 'blocked' || r === 'arrived' || c.fsm.time > 6) return 'done';
      },
    }),

    sit: (): State<C> => {
      const duration = rand(10, 25);
      return {
        activity: 'idle',
        enter(c) {
          c.stop();
          c.anim('sit_window');
        },
        update(c, dt): Next | void {
          c.stand(dt);
          if (c.behaviors.mouseInteractions && c.cursor.near) c.face(c.cursor.x);
          if (c.fsm.time > duration || !c.body.onWindow) return 'done';
        },
      };
    },

    climb: (): State<C> => {
      let wall: Wall | null = null;
      let phase: 'go' | 'climb' | 'pause' | 'edge' | 'ceiling' = 'go';
      let phaseEnd = 0;
      /** Bord d'écran : hauteur où il s'arrête (le haut de l'écran = plafond). */
      let stopY = 0;
      let ceilingDir: 1 | -1 = 1;
      let ceilingLeft = 0;
      const letGo = (c: C, vx: number, vy: number): void => c.body.launch(vx, vy);
      return {
        activity: 'active',
        airborne: true,
        priority: P.wall,
        enter(c) {
          wall = findWall(c, false);
          c.anim('walk');
          if (wall && wall.windowId === null) {
            // Deux fois sur trois jusqu'en haut (puis le plafond), sinon à mi-hauteur.
            const full = Math.random() < 0.66;
            stopY = full ? wall.topY : rand(wall.topY + c.h * 2, c.body.y - c.h * 2.5);
          }
        },
        update(c, dt): Next | void {
          if (!wall) return 'done';
          if (!refreshWall(c, wall)) {
            letGo(c, 0, 0);
            return { to: 'fall' };
          }
          // Des pieds jusqu'aux mains levées (sprite de profil) : ~70 % de la case.
          const handOffset = c.pack.manifest.sprite.frameHeight * 0.69 * c.px;

          switch (phase) {
            case 'go': {
              const r = approach(c, standX(c, wall), dt);
              if (r === 'fell') return { to: 'fall' };
              if (r === 'blocked' && Math.abs(c.body.x - standX(c, wall)) > 8) return 'done';
              if (r === 'moving') return c.fsm.time > 10 ? 'done' : undefined;
              phase = 'climb';
              c.body.ground = null;
              c.body.vx = 0;
              c.body.vy = 0;
              c.facing = wall.dir;
              c.anim('climb');
              return;
            }

            case 'climb': {
              c.body.x = gripX(c, wall);
              c.body.y -= c.h * 0.8 * dt;
              c.stats.spend('run', dt * 0.5);
              const next = train(c, 'endurance', dt * 0.4, c.traits.brave) ?? train(c, 'strength', dt * 0.2, 1);
              if (next) {
                letGo(c, -wall.dir * 120, -200);
                return next;
              }
              const hands = c.body.y - handOffset;
              if (wall.windowId !== null) {
                if (hands > wall.topY) return;
                // Arrivé au bord de la fenêtre : il s'y accroche puis se hisse.
                phase = 'edge';
                phaseEnd = c.fsm.time + rand(0.5, 1.1);
                c.body.y = wall.topY + c.h * 0.75;
                c.anim('grab_edge');
                return;
              }
              const toTop = stopY <= wall.topY + 1;
              // Jusqu'en haut : on s'arrête quand la tête touche le bord (rien ne sort de l'écran).
              if (toTop ? c.body.y - c.h > wall.topY : hands > stopY) return;
              if (toTop) {
                if (Math.random() < 0.7) {
                  // En haut de l'écran : il passe au plafond, façon Tarzan.
                  phase = 'ceiling';
                  ceilingDir = wall.dir === 1 ? -1 : 1;
                  ceilingLeft = rand(c.h * 2, c.h * 7);
                  c.body.x = wall.edgeX - wall.dir * (c.halfW + 4 * c.px);
                  c.body.y = wall.topY + c.h;
                  c.facing = ceilingDir;
                  c.anim('hang_ceiling');
                  c.say(pick(['Moi Tarzan !', 'Wheee !', 'Je vois tout d’ici !']), 2);
                  return;
                }
                c.body.y = wall.topY + c.h;
              }
              phase = 'pause';
              phaseEnd = c.fsm.time + rand(1, 2.5);
              c.anim('wall_hang');
              return;
            }

            case 'pause':
              // Agrippé au mur, il souffle un peu… puis saute en arrière.
              c.body.x = gripX(c, wall);
              if (c.fsm.time < phaseEnd) return;
              c.say(pick(['Wheee !', 'Hop !', 'Attention en dessous !']), 1.5);
              c.facing = wall.dir === 1 ? -1 : 1;
              letGo(c, -wall.dir * 260, -380);
              return { to: 'fall' };

            case 'edge': {
              c.body.y = wall.topY + c.h * 0.75;
              if (c.fsm.time < phaseEnd) return;
              const w = wall.windowId !== null ? c.world.window(wall.windowId) : undefined;
              const px = w ? (wall.side === 'left' ? w.rect.x + c.halfW * 1.2 : w.rect.x + w.rect.w - c.halfW * 1.2) : 0;
              const seg = w ? c.world.supportAt(px, w.rect.y, w.id) : null;
              if (seg) {
                c.body.placeOn(seg, px, c.world);
                c.facing = wall.dir;
                return { to: 'land', params: 0 };
              }
              letGo(c, -wall.dir * 60, 0);
              return { to: 'fall' };
            }

            case 'ceiling': {
              // Une main après l'autre sous le haut de l'écran.
              const step = c.h * 0.6 * dt;
              const b = c.world.bounds;
              c.body.x += ceilingDir * step;
              c.body.y = wall.topY + c.h;
              ceilingLeft -= step;
              c.stats.spend('run', dt * 0.4);
              const next = train(c, 'strength', dt * 0.3, c.traits.brave);
              if (next) {
                letGo(c, 0, 0);
                return next;
              }
              const atEdge = c.body.x - c.halfW <= b.left || c.body.x + c.halfW >= b.right;
              if (ceilingLeft > 0 && !atEdge) return;
              c.say(pick(['Wheee !', 'Banzaï !', 'Et hop !']), 1.5);
              letGo(c, ceilingDir * 120, 0);
              return { to: 'fall' };
            }
          }
        },
      };
    },

    push: (): State<C> => {
      let wall: Wall | null = null;
      let pushing = false;
      let saidAt = -1;
      const duration = rand(3, 5);
      return {
        activity: 'active',
        enter(c) {
          wall = findWall(c, true);
          c.anim('walk');
        },
        update(c, dt): Next | void {
          if (!wall || !refreshWall(c, wall)) return 'done';
          const x = standX(c, wall);
          if (!pushing) {
            const r = approach(c, x, dt);
            if (r === 'fell' || (r === 'moving' && c.fsm.time > 10)) return 'done';
            if (r === 'moving') return;
            pushing = true;
            saidAt = c.fsm.time;
            c.facing = wall.dir;
            c.anim('push');
            return;
          }
          c.body.x = x;
          c.stand(dt);
          if (saidAt >= 0 && c.fsm.time - saidAt > 1) {
            c.say(pick(['Hnnngh !', 'Elle ne bouge pas…', 'Pousse-toi !']), 2);
            saidAt = -1;
          }
          if (c.fsm.time > duration + 2) return 'done';
        },
      };
    },

    // Soins et jouets.
    eat: (): State<C> => {
      let target: Toy | undefined;
      let eating = false;
      return {
        activity: 'active',
        priority: P.eat,
        enter(c) {
          target = c.toys.nearestFood(c.body.x);
          c.anim('walk');
        },
        update(c, dt): Next | void {
          if (!target || target.removed || (!eating && !target.isEdible)) return 'done';
          if (!eating) {
            if (target.isDragging || !target.body.grounded) {
              c.stand(dt);
              return c.fsm.time > 25 ? 'done' : undefined;
            }
            const r = reach(c, besideX(c, target, 0.5), target.y, dt, 1.4);
            if (r === 'unreachable' || c.fsm.time > 25) return 'done';
            if (r !== 'arrived') return r === 'moving' ? undefined : r;
            eating = true;
            c.face(target.x);
            c.anim('eat', true);
            c.sfx('eat');
            return;
          }
          c.stand(dt);
          if (!c.animDone('eat')) return;
          const food = target.consume();
          if (food) {
            c.stats.feed(food);
            c.emit('heart', true);
            c.say(`Miam ! ${FOODS[food].label} 😋`, 2);
          }
          return 'done';
        },
      };
    },

    play_ball: (): State<C> => {
      let kicks = 0;
      let kicking = false;
      const maxKicks = Math.round(rand(3, 6));
      return {
        activity: 'active',
        enter(c) {
          c.anim('run');
          c.stats.interact();
        },
        update(c, dt): Next | void {
          const ball = c.toys.find('ball');
          if (!ball || c.stats.needs.energy < 12 || c.fsm.time > 35) return 'done';
          if (kicking) {
            c.stand(dt);
            if (c.animDone('attack_light')) {
              kicking = false;
              c.anim('run');
              if (kicks >= maxKicks) return { to: 'celebrate', params: { label: 'Partie de balle ⚽', value: kicks } };
            }
            return;
          }
          if (ball.isDragging) {
            c.stand(dt);
            return;
          }
          const close = Math.abs(ball.x - c.body.x) < c.halfW + ball.halfWidth + 8 && Math.abs(ball.y - c.body.y) < c.h * 0.5;
          if (close) {
            kicking = true;
            c.face(ball.x);
            c.anim('attack_light', true);
            return;
          }
          const r = reach(c, ball.x, ball.y, dt, 1.8);
          if (r === 'unreachable') return 'done';
          if (typeof r === 'object' || r === 'done') return r;
          c.anim('run');
        },
        onAnimEvent(c, event) {
          if (event.type !== 'hit' || !kicking) return;
          const ball = c.toys.find('ball');
          if (!ball) return;
          ball.kick(c.facing * rand(280, 620), -rand(300, 700));
          kicks++;
          c.sfx('kick');
          c.stats.addHappiness(4);
          c.stats.spend('play', 2);
          c.stats.interact();
          c.stats.train('agility', 2, c.traits.playful);
        },
      };
    },

    train: (): State<C> => {
      let training = false;
      let start = 0;
      const duration = rand(15, 25);
      return {
        activity: 'active',
        enter(c) {
          c.anim('walk');
        },
        update(c, dt): Next | void {
          const bag = c.toys.find('bag');
          if (!bag) return 'done';
          if (!training) {
            if (!bag.body.grounded || bag.isDragging) {
              c.stand(dt);
              return c.fsm.time > 20 ? 'done' : undefined;
            }
            const r = reach(c, besideX(c, bag), bag.y, dt, 1.4);
            if (r === 'unreachable' || c.fsm.time > 20) return 'done';
            if (r !== 'arrived') return r === 'moving' ? undefined : r;
            training = true;
            start = c.fsm.time;
            c.face(bag.x);
            c.anim('train');
            return;
          }
          c.stand(dt);
          c.face(bag.x);
          c.stats.spend('train', dt);
          const next = train(c, 'strength', dt, c.traits.brave);
          if (next) return next;
          const tired = c.stats.needs.energy < 15;
          if (c.fsm.time - start > duration || tired) {
            c.stats.countTraining();
            if (tired) {
              c.emit('sweat', true);
              c.say('Ouf… je suis vidé.', 2);
            }
            return 'done';
          }
        },
        onAnimEvent(c, event) {
          if (!training || event.type !== 'particle' || event.id !== 'impact') return;
          const bag = c.toys.find('bag');
          bag?.hit(c.facing);
          c.sfx('hit');
          // La particule d'impact vient de l'événement de l'animation « train ».
        },
      };
    },

    code: (): State<C> => {
      let coding = false;
      let start = 0;
      let nextQuip = rand(4, 9);
      const duration = rand(20, 35);
      return {
        activity: 'idle',
        enter(c) {
          c.anim('walk');
        },
        update(c, dt): Next | void {
          const term = c.toys.find('terminal');
          if (!term) return 'done';
          if (!coding) {
            if (!term.body.grounded || term.isDragging) {
              c.stand(dt);
              return c.fsm.time > 20 ? 'done' : undefined;
            }
            const r = reach(c, besideX(c, term, 0.7), term.y, dt, 1.2);
            if (r === 'unreachable' || c.fsm.time > 20) return 'done';
            if (r !== 'arrived') return r === 'moving' ? undefined : r;
            coding = true;
            start = c.fsm.time;
            c.face(term.x);
            c.anim('type');
            return;
          }
          c.stand(dt);
          c.stats.spend('code', dt);
          c.stats.addHappiness(0.03 * dt * c.traits.curious);
          const next = train(c, 'technique', dt, c.traits.curious);
          if (next) return next;
          if (c.fsm.time - start > nextQuip) {
            nextQuip += rand(8, 14);
            c.say(pick(CODE_QUIPS), 2.5);
          }
          if (c.fsm.time - start > duration || c.stats.needs.energy < 15) {
            c.stats.countTraining();
            return 'done';
          }
        },
      };
    },

    chase_bug: (): State<C> => {
      let pouncing = false;
      return {
        activity: 'active',
        priority: P.bug,
        enter(c) {
          c.anim('run');
          if (!c.recent('bug_spotted', 60)) {
            c.mark('bug_spotted');
            c.say(pick(['Un bug ! 🐛', 'Je l’ai vu bouger !', 'Pas en prod !']), 2);
            c.emit('alert', true);
          }
        },
        update(c, dt): Next | void {
          const bug = c.toys.find('bug');
          if (!bug) return 'done';
          if (pouncing) {
            c.stand(dt);
            if (c.animDone('attack_light')) return 'done';
            return;
          }
          if (c.fsm.time > 25) {
            c.say('Il m’a échappé…', 2);
            return 'done';
          }
          const close = Math.abs(bug.x - c.body.x) < c.halfW + bug.halfWidth && Math.abs(bug.y - c.body.y) < c.h * 0.4;
          if (close) {
            pouncing = true;
            c.face(bug.x);
            c.anim('attack_light', true);
            return;
          }
          const r = reach(c, bug.x, bug.y, dt, 2);
          if (r === 'unreachable') return c.fsm.time > 3 ? 'done' : undefined;
          if (typeof r === 'object') return r;
          c.anim('run');
        },
        onAnimEvent(c, event) {
          if (!pouncing || event.type !== 'hit') return;
          const bug = c.toys.find('bug');
          if (!bug) return;
          bug.squash();
          c.stats.countBug();
          c.stats.addHappiness(8);
          c.stats.interact();
          c.stats.train('technique', 4, c.traits.mischievous);
          c.stats.train('agility', 2, 1);
          c.sfx('squash');
          c.emit('sparkle', true);
          c.say(pick(['Bug corrigé ! ✨', 'Ticket fermé.', 'Et un de moins !']), 2);
        },
      };
    },

    chase_cursor: (): State<C> => ({
      activity: 'active',
      enter(c) {
        c.anim('run');
        c.emit('note');
      },
      update(c, dt): Next | void {
        if (!c.cursor.near || c.fsm.time > 7 || c.stats.needs.energy < 15) return 'done';
        const dx = c.cursor.x - c.body.x;
        const above = c.body.y - c.cursor.y;
        if (Math.abs(dx) < c.h * 0.8 && above > c.h * 1.3 && above < c.h * 4 && !c.recent('cursor_jump', 1.5)) {
          c.mark('cursor_jump');
          const vy = -Math.sqrt(2 * GRAVITY * Math.max(c.h * 0.5, above - c.h * 0.6));
          return { to: 'jump', params: { vx: dx * 2, vy } };
        }
        if (Math.abs(dx) > c.halfW) {
          c.anim('run');
          c.walk(dx > 0 ? 1 : -1, 2, dt);
          c.stats.spend('run', dt);
          return train(c, 'agility', dt * 0.4, c.traits.playful);
        }
        c.anim('idle');
        c.stand(dt);
      },
    }),
  };
}

// --- Scores de l'IA utilitaire ----------------------------------------------------

export function createConsiderations(): Consideration<C>[] {
  return [
    {
      action: 'sleep',
      score: (c) => {
        const e = c.stats.needs.energy;
        return (e < 15 ? 3 : e < 35 ? 1.6 * (1 - e / 100) : e < 55 ? 0.12 : 0) * c.traits.lazy;
      },
    },
    {
      action: 'eat',
      score: (c) => {
        if (!c.toys.nearestFood(c.body.x)) return 0;
        const h = c.stats.needs.hunger;
        return h > 92 ? 0 : (1 - h / 100) * 2.2 * c.traits.glutton + (h < 30 ? 1.5 : 0);
      },
    },
    {
      action: 'beg',
      score: (c) => (!c.toys.nearestFood(c.body.x) && c.stats.needs.hunger < 30 && !c.recent('beg', 90) ? 0.9 : 0),
    },
    {
      action: 'play_ball',
      score: (c) => {
        const n = c.stats.needs;
        if (!c.toys.has('ball') || n.energy < 20 || c.recent('play_ball', 20)) return 0;
        return (0.3 + (1 - n.happiness / 100) * 0.6) * c.traits.playful;
      },
    },
    {
      action: 'train',
      score: (c) => {
        const n = c.stats.needs;
        if (!c.toys.has('bag') || n.energy < 35 || n.hunger < 25 || c.recent('train', 30)) return 0;
        return 0.5 * c.traits.brave * (n.energy / 100);
      },
    },
    {
      action: 'code',
      score: (c) =>
        c.toys.has('terminal') && c.stats.needs.energy > 25 && !c.recent('code', 30) ? 0.45 * c.traits.curious : 0,
    },
    { action: 'chase_bug', score: (c) => (c.toys.has('bug') ? 2.5 * c.traits.mischievous : 0) },
    {
      action: 'chase_cursor',
      score: (c) =>
        c.behaviors.mouseInteractions && c.cursor.near && c.stats.needs.energy > 30 && !c.recent('chase_cursor', 25)
          ? 0.35 * c.traits.playful
          : 0,
    },
    {
      // Un compagnon de bureau passe surtout du temps posé : chaque pas coûte une
      // recomposition de l'overlay, l'immobilité ne coûte rien (cf. ARCHITECTURE §6).
      action: 'wander',
      score: (c) => (c.recent('wander', 12) ? 0.12 : 0.3) * c.traits.curious,
      params: (c) => ({ run: c.stats.needs.energy > 60 && Math.random() < 0.25 }),
    },
    {
      action: 'go_window',
      score: (c) =>
        c.behaviors.sitOnWindows && c.world.platforms.length > 0 && !c.recent('go_window', 30)
          ? (c.body.onWindow ? 0.1 : 0.4) * c.traits.curious
          : 0,
      params: (c) => findWindowJump(c),
    },
    { action: 'sit', score: (c) => (c.behaviors.sitOnWindows && c.body.onWindow ? 0.8 * c.traits.lazy : 0) },
    { action: 'hop_down', score: (c) => (c.body.onWindow ? 0.3 : 0) },
    {
      action: 'climb',
      score: (c) =>
        c.behaviors.climbWindows && !c.body.onWindow && c.stats.needs.energy > 40 && !c.recent('climb', 40)
          ? 0.22 * c.traits.brave
          : 0,
    },
    {
      action: 'push',
      score: (c) =>
        c.behaviors.climbWindows && !c.body.onWindow && !c.recent('push', 60) ? 0.12 * c.traits.mischievous : 0,
    },
    { action: 'idle', score: (c) => 0.3 + 0.35 * c.traits.lazy, params: () => ({ duration: rand(5, 14) }) },
    { action: 'yawn', score: (c) => (c.stats.needs.energy < 55 && !c.recent('yawn', 40) ? 0.3 * c.traits.lazy : 0) },
    { action: 'stretch', score: (c) => (!c.recent('stretch', 60) ? 0.12 : 0) },
    { action: 'look', score: (c) => (!c.recent('look', 20) ? 0.3 * c.traits.curious : 0) },
    {
      // Pas d'interaction depuis 10 min et bonheur en baisse : il nous fait signe.
      action: 'seek_attention',
      score: (c) => {
        const idleMin = (Date.now() - c.stats.data.lastInteractionAt) / 60_000;
        if (idleMin < 10 || c.stats.needs.happiness > 55 || c.recent('seek_attention', 90)) return 0;
        return (c.stats.needs.happiness < 35 ? 1.6 : 1.1) * c.traits.social;
      },
    },
    {
      action: 'with_friend',
      score: (c) => (c.friend && !c.recent('with_friend', 15) ? 1.0 * c.traits.social : 0),
    },
    {
      action: 'grumpy',
      score: (c) => (c.stats.needs.happiness < 40 && idleMinutes(c) > 15 && !c.recent('grumpy', 90) ? 1.1 : 0),
    },
    {
      action: 'tug_window',
      score: (c) =>
        c.behaviors.mischiefWindows && grumpyEnough(c) && !c.body.onWindow && !c.recent('tug_window', 300)
          ? 0.9 * c.traits.mischievous
          : 0,
    },
    {
      action: 'steal_icon',
      score: (c) =>
        c.behaviors.mischiefIcons &&
        grumpyEnough(c) &&
        !c.body.onWindow &&
        !c.recent('steal_icon', 300) &&
        !c.recent('steal_icon_failed', 900)
          ? 0.9 * c.traits.mischievous
          : 0,
    },
    {
      action: 'poke_screen',
      score: (c) =>
        c.behaviors.mischiefClicks && grumpyEnough(c) && !c.recent('poke_screen', 180) ? 0.7 * c.traits.mischievous : 0,
    },
    {
      action: 'sulk',
      score: (c) => (c.stats.needs.happiness < 30 && c.stats.isNeglected() && !c.recent('sulk', 60) ? 1.2 : 0),
    },
  ];
}

/** Libellés lisibles des états, pour la fiche du compagnon. */
export const STATE_LABELS: Record<string, string> = {
  fall: 'tombe',
  land: 'atterrit',
  jump: 'saute',
  dragged: 'est porté',
  menu: 'vous écoute',
  idle: 'se repose',
  yawn: 'bâille',
  stretch: 's’étire',
  trip: 'a trébuché',
  scared: 'a eu peur',
  look: 'regarde autour',
  sulk: 'boude',
  beg: 'réclame à manger',
  sleep: 'dort',
  celebrate: 'fête un progrès',
  pet: 'se fait caresser',
  wander: 'se promène',
  go_window: 'vise une fenêtre',
  hop_down: 'redescend',
  sit: 'est assis sur une fenêtre',
  climb: 'grimpe',
  greet: 'dit bonjour',
  fight: 'combat !',
  with_friend: 'discute avec son ami',
  dizzy: 'a le tournis',
  vomit: 'est malade',
  grumpy: 'est mécontent',
  tug_window: 'tire sur une fenêtre',
  steal_icon: 'chipe une icône',
  poke_screen: 'clique sur l’écran',
  study_file: 'étudie un fichier',
  throw: 'lance une note',
  seek_attention: 'réclame de l’attention',
  push: 'pousse une fenêtre',
  eat: 'mange',
  play_ball: 'joue à la balle',
  train: 's’entraîne au sac de frappe',
  code: 'code sur son terminal',
  chase_bug: 'chasse un bug',
  chase_cursor: 'joue avec la souris',
};
