/**
 * Moteur de combat déterministe (module pur, sans dépendance).
 *
 * Les deux joueurs simulent le même combat chacun de leur côté : même graine, mêmes
 * statistiques, mêmes choix échangés à chaque tour (lockstep). Aucune position ni
 * aucun résultat ne transite sur le réseau, seulement les choix — impossible de
 * désynchroniser ou de tricher sur l'issue d'un coup.
 *
 * Les statistiques entraînées (Force, Agilité, Endurance, Technique) sont multipliées
 * par le coefficient d'état du compagnon : affamé, épuisé ou malheureux, il frappe moins
 * fort, rate plus souvent et s'essouffle plus vite ; en pleine forme, il a un bonus de moral.
 */

export interface FighterStats {
  name: string;
  strength: number;
  agility: number;
  endurance: number;
  technique: number;
  /** Coefficient d'état (0,4 à 1,15), cf. CompanionStats.condition(). */
  condition: number;
  /** Énergie (0–100) : en dessous de 30, chaque action coûte plus de souffle. */
  energy: number;
}

export interface FighterState {
  hp: number;
  maxHp: number;
  stamina: number;
}

/** `auto` : le compagnon décide seul (combat semi-automatique). */
export type Choice = 'auto' | 'attack' | 'heavy' | 'guard';
export type Action = 'attack' | 'heavy' | 'guard' | 'rest';
export type Outcome = 'hit' | 'crit' | 'miss' | 'blocked' | 'guard' | 'rest';

export interface ActionEvent {
  actor: 0 | 1;
  action: Action;
  outcome: Outcome;
  damage: number;
}

export interface CombatState {
  turn: number;
  fighters: [FighterState, FighterState];
  winner: 0 | 1 | null;
}

export const MAX_TURNS = 40;
const STAMINA_MAX = 100;
const COST: Record<'attack' | 'heavy', number> = { attack: 18, heavy: 32 };
const REGEN = 12;
const REGEN_RESTING = 30;

/** Générateur pseudo-aléatoire 32 bits (mulberry32) : identique sur toutes les machines. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

export function maxHp(s: FighterStats): number {
  return Math.round((60 + s.endurance * 4) * (0.85 + 0.15 * s.condition));
}

export function createCombat(a: FighterStats, b: FighterStats): CombatState {
  const fighter = (s: FighterStats): FighterState => ({ hp: maxHp(s), maxHp: maxHp(s), stamina: STAMINA_MAX });
  return { turn: 0, fighters: [fighter(a), fighter(b)], winner: null };
}

function cost(action: 'attack' | 'heavy', s: FighterStats): number {
  return COST[action] * (s.energy < 30 ? 1.4 : 1) * (s.condition < 0.75 ? 1.15 : 1);
}

/** Décision automatique, déterministe (même tirage des deux côtés). */
function decide(choice: Choice, self: FighterState, foe: FighterState, s: FighterStats, rnd: () => number): Action {
  let action: Action;
  if (choice !== 'auto') {
    action = choice;
  } else if (self.stamina < cost('attack', s)) {
    action = 'rest';
  } else if (self.stamina < 35 && rnd() < 0.5) {
    action = 'guard';
  } else if (foe.hp <= foe.maxHp * 0.25 || rnd() < 0.3) {
    action = self.stamina >= cost('heavy', s) ? 'heavy' : 'attack';
  } else {
    action = 'attack';
  }
  // À bout de souffle : il doit reprendre sa respiration.
  if ((action === 'attack' || action === 'heavy') && self.stamina < cost(action, s)) action = 'rest';
  return action;
}

/**
 * Joue un tour : chacun agit (le plus agile d'abord). Modifie `state` et renvoie les
 * événements à animer. `seed` est la graine partagée du combat.
 */
export function playTurn(
  state: CombatState,
  stats: readonly [FighterStats, FighterStats],
  choices: readonly [Choice, Choice],
  seed: number,
): ActionEvent[] {
  if (state.winner !== null) return [];
  state.turn++;
  const rnd = mulberry32((seed ^ Math.imul(state.turn, 0x9e3779b9)) >>> 0);
  const [A, B] = state.fighters;
  const actions: [Action, Action] = [
    decide(choices[0], A, B, stats[0], rnd),
    decide(choices[1], B, A, stats[1], rnd),
  ];
  const order: Array<0 | 1> = stats[0].agility >= stats[1].agility ? [0, 1] : [1, 0];
  const events: ActionEvent[] = [];

  for (const actor of order) {
    const target = actor === 0 ? 1 : 0;
    const self = state.fighters[actor];
    const foe = state.fighters[target];
    const s = stats[actor];
    const d = stats[target];
    const action = actions[actor];

    if (action === 'rest' || action === 'guard') {
      self.stamina = clamp(self.stamina + REGEN_RESTING, 0, STAMINA_MAX);
      events.push({ actor, action, outcome: action === 'rest' ? 'rest' : 'guard', damage: 0 });
      continue;
    }

    self.stamina = clamp(self.stamina - cost(action, s), 0, STAMINA_MAX);
    const heavy = action === 'heavy';
    const guarding = actions[target] === 'guard';
    const hitChance =
      clamp(0.88 + (s.agility - d.agility) * 0.012 - (heavy ? 0.15 : 0) - (guarding ? 0.05 : 0), 0.35, 0.97) *
      (s.condition < 0.75 ? 0.85 : 1);
    if (rnd() > hitChance) {
      events.push({ actor, action, outcome: 'miss', damage: 0 });
      continue;
    }
    const crit = rnd() < 0.04 + s.technique * 0.005 + (heavy ? 0.04 : 0);
    let damage = (4 + s.strength * 1.5) * (heavy ? 1.7 : 1) * s.condition * (0.85 + rnd() * 0.3);
    if (crit) damage *= 1.6;
    damage -= d.endurance * 0.35;
    if (guarding) damage *= 0.45;
    damage = Math.max(1, Math.round(damage));
    foe.hp = Math.max(0, foe.hp - damage);
    events.push({ actor, action, outcome: guarding ? 'blocked' : crit ? 'crit' : 'hit', damage });
    if (foe.hp === 0) {
      state.winner = actor;
      break;
    }
  }

  for (const f of state.fighters) f.stamina = clamp(f.stamina + REGEN, 0, STAMINA_MAX);

  if (state.winner === null && state.turn >= MAX_TURNS) {
    // Limite de tours : le plus en forme (proportion de PV) l'emporte.
    const ratio = (f: FighterState): number => f.hp / f.maxHp;
    state.winner = ratio(A) >= ratio(B) ? 0 : 1;
  }
  return events;
}

/** Simulation complète en mode automatique (tests, équilibrage). */
export function simulate(a: FighterStats, b: FighterStats, seed: number): CombatState {
  const state = createCombat(a, b);
  while (state.winner === null) playTurn(state, [a, b], ['auto', 'auto'], seed);
  return state;
}
